import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, authedQuery as signedInQuery } from "./middleware";
import { assertPlanFeature } from "./lib/plan-guard";
import { ensureSchema } from "./lib/migrate";
import {
  getCollection,
  insertDoc,
  findById,
  updateById,
  hasMongoConfigured,
} from "./queries/connection";
import { isAuthDisabled } from "./lib/dev-mode";
import { Collections } from "@db/mongo/collections";
import type {
  BankAccountDoc,
  ContractDoc,
  EstimateDoc,
  ExpenseDoc,
  InvoiceDoc,
  LedgerAccountDoc,
  PaymentDoc,
  VendorBillDoc,
} from "@db/mongo/types";
import { orgFilter, requireOrganizationId } from "./lib/tenant";
import { assertPermission } from "./lib/permissions";
import { invoiceBalanceDue, invoiceTotal, isInvoiceOutstanding } from "@/lib/invoice-store";

const authedQuery = signedInQuery.use(async ({ ctx, next }) => {
  if (ctx.user) await assertPlanFeature(ctx.user, "finance");
  return next();
});

function useMock() {
  return isAuthDisabled() || !hasMongoConfigured();
}

function assertFinanceAccess(user: { role?: string | null; permissions?: string[] }) {
  assertPermission(user as { role: string; permissions?: string[] }, "invoices.manage");
}

function toIso(doc: { createdAt: Date; updatedAt: Date } & Record<string, unknown>) {
  return {
    ...doc,
    createdAt:
      doc.createdAt instanceof Date ? doc.createdAt.toISOString() : String(doc.createdAt),
    updatedAt:
      doc.updatedAt instanceof Date ? doc.updatedAt.toISOString() : String(doc.updatedAt),
  };
}

const lineItemSchema = z.object({
  id: z.string(),
  itemDetails: z.string(),
  quantity: z.number(),
  rate: z.number(),
  discountPercent: z.number(),
  taxPercent: z.number(),
});

const bankInput = z.object({
  name: z.string().min(1),
  bankName: z.string().min(1),
  accountNumber: z.string().default(""),
  accountType: z.enum(["current", "savings", "cash", "other"]),
  currency: z.string().default("INR"),
  openingBalance: z.number().default(0),
  currentBalance: z.number().default(0),
  ifscOrSwift: z.string().default(""),
  branch: z.string().default(""),
  isActive: z.boolean().default(true),
  notes: z.string().default(""),
});

const ledgerInput = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(["asset", "liability", "equity", "income", "expense"]),
  description: z.string().default(""),
  isActive: z.boolean().default(true),
});

const estimateInput = z.object({
  estimateNumber: z.string().min(1),
  customerId: z.number().nullable(),
  customerName: z.string().min(1),
  estimateDate: z.string(),
  validUntil: z.string().default(""),
  currency: z.string().default("INR"),
  items: z.array(lineItemSchema).default([]),
  notes: z.string().default(""),
  taxPercent: z.number().default(0),
  adjustment: z.number().default(0),
  status: z.enum(["draft", "sent", "accepted", "declined", "converted"]).default("draft"),
});

const paymentInput = z.object({
  invoiceId: z.number().nullable(),
  customerId: z.number().nullable(),
  customerName: z.string().default(""),
  amount: z.number().positive(),
  paymentDate: z.string(),
  method: z.enum(["bank_transfer", "upi", "cash", "cheque", "card", "other"]),
  bankAccountId: z.number().nullable(),
  reference: z.string().default(""),
  notes: z.string().default(""),
});

const expenseInput = z.object({
  expenseDate: z.string(),
  vendorName: z.string().min(1),
  category: z.string().default("General"),
  ledgerAccountId: z.number().nullable(),
  amount: z.number().positive(),
  taxAmount: z.number().default(0),
  currency: z.string().default("INR"),
  paymentMethod: z.enum(["bank_transfer", "upi", "cash", "cheque", "card", "other"]),
  bankAccountId: z.number().nullable(),
  status: z.enum(["draft", "recorded"]).default("recorded"),
  notes: z.string().default(""),
});

const contractInput = z.object({
  customerId: z.number().nullable(),
  customerName: z.string().min(1),
  title: z.string().min(1),
  startDate: z.string(),
  endDate: z.string().default(""),
  value: z.number().default(0),
  currency: z.string().default("INR"),
  billingTerms: z.string().default(""),
  status: z.enum(["draft", "active", "expired", "cancelled"]).default("draft"),
  notes: z.string().default(""),
});

const vendorBillInput = z.object({
  vendorName: z.string().min(1),
  billNumber: z.string().min(1),
  billDate: z.string(),
  dueDate: z.string().default(""),
  amount: z.number().positive(),
  currency: z.string().default("INR"),
  category: z.string().default("General"),
  status: z.enum(["open", "paid", "void"]).default("open"),
  paidAt: z.string().nullable().default(null),
  notes: z.string().default(""),
});

const DEFAULT_LEDGER: Array<Omit<LedgerAccountDoc, "id" | "organizationId" | "createdBy" | "createdAt" | "updatedAt">> = [
  { code: "1000", name: "Cash", type: "asset", description: "Petty cash on hand", isSystem: true, isActive: true },
  { code: "1010", name: "Bank Accounts", type: "asset", description: "Operating bank accounts", isSystem: true, isActive: true },
  { code: "1100", name: "Accounts Receivable", type: "asset", description: "Amounts owed by customers", isSystem: true, isActive: true },
  { code: "2000", name: "Accounts Payable", type: "liability", description: "Amounts owed to vendors", isSystem: true, isActive: true },
  { code: "3000", name: "Owner Equity", type: "equity", description: "Owner capital", isSystem: true, isActive: true },
  { code: "4000", name: "Sales Revenue", type: "income", description: "Income from invoices", isSystem: true, isActive: true },
  { code: "5000", name: "Cost of Services", type: "expense", description: "Direct delivery costs", isSystem: true, isActive: true },
  { code: "5100", name: "Salaries & Wages", type: "expense", description: "Payroll expenses", isSystem: true, isActive: true },
  { code: "5200", name: "Software & Tools", type: "expense", description: "SaaS and tools", isSystem: true, isActive: true },
  { code: "5300", name: "Marketing", type: "expense", description: "Ads and promotions", isSystem: true, isActive: true },
  { code: "5400", name: "Office Expenses", type: "expense", description: "Rent, utilities, supplies", isSystem: true, isActive: true },
  { code: "5500", name: "Travel & Meals", type: "expense", description: "Travel and client meals", isSystem: true, isActive: true },
  { code: "5900", name: "Other Expenses", type: "expense", description: "Miscellaneous expenses", isSystem: true, isActive: true },
];

const mockBanks: BankAccountDoc[] = [];
const mockLedgers: LedgerAccountDoc[] = [];
const mockEstimates: EstimateDoc[] = [];
const mockPayments: PaymentDoc[] = [];
const mockExpenses: ExpenseDoc[] = [];
const mockContracts: ContractDoc[] = [];
const mockVendorBills: VendorBillDoc[] = [];
let mockId = 1;

function estimateTotal(est: Pick<EstimateDoc, "items" | "taxPercent" | "adjustment">) {
  const sub = est.items.reduce((sum, item) => {
    const base = item.quantity * item.rate;
    return sum + Math.max(0, base * (1 - (item.discountPercent || 0) / 100));
  }, 0);
  const tax = (sub * (est.taxPercent || 0)) / 100;
  return Math.max(0, sub + tax + (est.adjustment || 0));
}

async function ensureDefaultLedgers(organizationId: number, userId: number) {
  const col = await getCollection<LedgerAccountDoc>(Collections.ledgerAccounts);
  const count = await col.countDocuments({ organizationId });
  if (count > 0) return;
  const now = new Date();
  for (const row of DEFAULT_LEDGER) {
    await insertDoc<LedgerAccountDoc>(Collections.ledgerAccounts, {
      organizationId,
      ...row,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    });
  }
}

function crudList<T extends { organizationId: number; createdAt: Date }>(
  mock: T[],
  organizationId: number,
) {
  return mock
    .filter((d) => d.organizationId === organizationId)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map((d) => toIso(d as T & { createdAt: Date; updatedAt: Date }));
}

export const financeRouter = createRouter({
  // ——— Bank accounts ———
  bankAccounts: createRouter({
    list: authedQuery.query(async ({ ctx }) => {
      assertFinanceAccess(ctx.user);
      const organizationId = ctx.user.organizationId ?? 1;
      if (useMock()) return crudList(mockBanks, organizationId);
      await ensureSchema();
      const col = await getCollection<BankAccountDoc>(Collections.bankAccounts);
      const docs = await col.find(orgFilter(ctx.user)).sort({ createdAt: -1 }).toArray();
      return docs.map(toIso);
    }),
    create: authedQuery.input(bankInput).mutation(async ({ ctx, input }) => {
      assertFinanceAccess(ctx.user);
      const now = new Date();
      const organizationId = requireOrganizationId(ctx.user);
      if (useMock()) {
        const doc: BankAccountDoc = {
          id: mockId++,
          organizationId,
          ...input,
          createdBy: ctx.user.id,
          createdAt: now,
          updatedAt: now,
        };
        mockBanks.unshift(doc);
        return toIso(doc);
      }
      await ensureSchema();
      const doc = await insertDoc<BankAccountDoc>(Collections.bankAccounts, {
        organizationId,
        ...input,
        createdBy: ctx.user.id,
        createdAt: now,
        updatedAt: now,
      });
      return toIso(doc);
    }),
    update: authedQuery.input(bankInput.extend({ id: z.number() })).mutation(async ({ ctx, input }) => {
      assertFinanceAccess(ctx.user);
      const { id, ...data } = input;
      const now = new Date();
      if (useMock()) {
        const idx = mockBanks.findIndex((b) => b.id === id);
        if (idx < 0) throw new TRPCError({ code: "NOT_FOUND", message: "Bank account not found" });
        mockBanks[idx] = { ...mockBanks[idx], ...data, updatedAt: now };
        return toIso(mockBanks[idx]);
      }
      await ensureSchema();
      const existing = await findById<BankAccountDoc>(Collections.bankAccounts, id);
      if (!existing || existing.organizationId !== requireOrganizationId(ctx.user)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Bank account not found" });
      }
      const updated = await updateById<BankAccountDoc>(Collections.bankAccounts, id, {
        ...data,
        updatedAt: now,
      });
      return updated ? toIso(updated) : null;
    }),
    delete: authedQuery.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
      assertFinanceAccess(ctx.user);
      if (useMock()) {
        const idx = mockBanks.findIndex((b) => b.id === input.id);
        if (idx >= 0) mockBanks.splice(idx, 1);
        return { success: true };
      }
      await ensureSchema();
      const existing = await findById<BankAccountDoc>(Collections.bankAccounts, input.id);
      if (!existing || existing.organizationId !== requireOrganizationId(ctx.user)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Bank account not found" });
      }
      const col = await getCollection<BankAccountDoc>(Collections.bankAccounts);
      await col.deleteOne({ id: input.id });
      return { success: true };
    }),
  }),

  // ——— Chart of accounts ———
  ledgerAccounts: createRouter({
    list: authedQuery.query(async ({ ctx }) => {
      assertFinanceAccess(ctx.user);
      const organizationId = requireOrganizationId(ctx.user);
      if (useMock()) {
        if (!mockLedgers.some((l) => l.organizationId === organizationId)) {
          const now = new Date();
          for (const row of DEFAULT_LEDGER) {
            mockLedgers.push({
              id: mockId++,
              organizationId,
              ...row,
              createdBy: ctx.user.id,
              createdAt: now,
              updatedAt: now,
            });
          }
        }
        return crudList(mockLedgers, organizationId).sort((a, b) =>
          String(a.code).localeCompare(String(b.code)),
        );
      }
      await ensureSchema();
      await ensureDefaultLedgers(organizationId, ctx.user.id);
      const col = await getCollection<LedgerAccountDoc>(Collections.ledgerAccounts);
      const docs = await col.find(orgFilter(ctx.user)).sort({ code: 1 }).toArray();
      return docs.map(toIso);
    }),
    create: authedQuery.input(ledgerInput).mutation(async ({ ctx, input }) => {
      assertFinanceAccess(ctx.user);
      const now = new Date();
      const organizationId = requireOrganizationId(ctx.user);
      if (useMock()) {
        const doc: LedgerAccountDoc = {
          id: mockId++,
          organizationId,
          ...input,
          isSystem: false,
          createdBy: ctx.user.id,
          createdAt: now,
          updatedAt: now,
        };
        mockLedgers.push(doc);
        return toIso(doc);
      }
      await ensureSchema();
      const doc = await insertDoc<LedgerAccountDoc>(Collections.ledgerAccounts, {
        organizationId,
        ...input,
        isSystem: false,
        createdBy: ctx.user.id,
        createdAt: now,
        updatedAt: now,
      });
      return toIso(doc);
    }),
    update: authedQuery.input(ledgerInput.extend({ id: z.number() })).mutation(async ({ ctx, input }) => {
      assertFinanceAccess(ctx.user);
      const { id, ...data } = input;
      const now = new Date();
      if (useMock()) {
        const idx = mockLedgers.findIndex((l) => l.id === id);
        if (idx < 0) throw new TRPCError({ code: "NOT_FOUND", message: "Account not found" });
        mockLedgers[idx] = { ...mockLedgers[idx], ...data, updatedAt: now };
        return toIso(mockLedgers[idx]);
      }
      await ensureSchema();
      const existing = await findById<LedgerAccountDoc>(Collections.ledgerAccounts, id);
      if (!existing || existing.organizationId !== requireOrganizationId(ctx.user)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Account not found" });
      }
      const updated = await updateById<LedgerAccountDoc>(Collections.ledgerAccounts, id, {
        ...data,
        updatedAt: now,
      });
      return updated ? toIso(updated) : null;
    }),
    delete: authedQuery.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
      assertFinanceAccess(ctx.user);
      if (useMock()) {
        const idx = mockLedgers.findIndex((l) => l.id === input.id);
        if (idx >= 0) {
          if (mockLedgers[idx].isSystem) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "System accounts cannot be deleted" });
          }
          mockLedgers.splice(idx, 1);
        }
        return { success: true };
      }
      await ensureSchema();
      const existing = await findById<LedgerAccountDoc>(Collections.ledgerAccounts, input.id);
      if (!existing || existing.organizationId !== requireOrganizationId(ctx.user)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Account not found" });
      }
      if (existing.isSystem) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "System accounts cannot be deleted" });
      }
      const col = await getCollection<LedgerAccountDoc>(Collections.ledgerAccounts);
      await col.deleteOne({ id: input.id });
      return { success: true };
    }),
  }),

  // ——— Estimates ———
  estimates: createRouter({
    list: authedQuery.query(async ({ ctx }) => {
      assertFinanceAccess(ctx.user);
      if (useMock()) return crudList(mockEstimates, ctx.user.organizationId ?? 1);
      await ensureSchema();
      const col = await getCollection<EstimateDoc>(Collections.estimates);
      const docs = await col.find(orgFilter(ctx.user)).sort({ createdAt: -1 }).toArray();
      return docs.map((d) => ({ ...toIso(d), total: estimateTotal(d) }));
    }),
    create: authedQuery.input(estimateInput).mutation(async ({ ctx, input }) => {
      assertFinanceAccess(ctx.user);
      const now = new Date();
      const organizationId = requireOrganizationId(ctx.user);
      const payload = { ...input, convertedInvoiceId: null as number | null };
      if (useMock()) {
        const doc: EstimateDoc = {
          id: mockId++,
          organizationId,
          ...payload,
          createdBy: ctx.user.id,
          createdAt: now,
          updatedAt: now,
        };
        mockEstimates.unshift(doc);
        return { ...toIso(doc), total: estimateTotal(doc) };
      }
      await ensureSchema();
      const doc = await insertDoc<EstimateDoc>(Collections.estimates, {
        organizationId,
        ...payload,
        createdBy: ctx.user.id,
        createdAt: now,
        updatedAt: now,
      });
      return { ...toIso(doc), total: estimateTotal(doc) };
    }),
    update: authedQuery.input(estimateInput.extend({ id: z.number() })).mutation(async ({ ctx, input }) => {
      assertFinanceAccess(ctx.user);
      const { id, ...data } = input;
      const now = new Date();
      if (useMock()) {
        const idx = mockEstimates.findIndex((e) => e.id === id);
        if (idx < 0) throw new TRPCError({ code: "NOT_FOUND", message: "Estimate not found" });
        mockEstimates[idx] = { ...mockEstimates[idx], ...data, updatedAt: now };
        return { ...toIso(mockEstimates[idx]), total: estimateTotal(mockEstimates[idx]) };
      }
      await ensureSchema();
      const existing = await findById<EstimateDoc>(Collections.estimates, id);
      if (!existing || existing.organizationId !== requireOrganizationId(ctx.user)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Estimate not found" });
      }
      const updated = await updateById<EstimateDoc>(Collections.estimates, id, {
        ...data,
        updatedAt: now,
      });
      return updated ? { ...toIso(updated), total: estimateTotal(updated) } : null;
    }),
    delete: authedQuery.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
      assertFinanceAccess(ctx.user);
      if (useMock()) {
        const idx = mockEstimates.findIndex((e) => e.id === input.id);
        if (idx >= 0) mockEstimates.splice(idx, 1);
        return { success: true };
      }
      await ensureSchema();
      const existing = await findById<EstimateDoc>(Collections.estimates, input.id);
      if (!existing || existing.organizationId !== requireOrganizationId(ctx.user)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Estimate not found" });
      }
      const col = await getCollection<EstimateDoc>(Collections.estimates);
      await col.deleteOne({ id: input.id });
      return { success: true };
    }),
  }),

  // ——— Payments ———
  payments: createRouter({
    list: authedQuery.query(async ({ ctx }) => {
      assertFinanceAccess(ctx.user);
      if (useMock()) return crudList(mockPayments, ctx.user.organizationId ?? 1);
      await ensureSchema();
      const col = await getCollection<PaymentDoc>(Collections.payments);
      const docs = await col.find(orgFilter(ctx.user)).sort({ paymentDate: -1 }).toArray();
      return docs.map(toIso);
    }),
    create: authedQuery.input(paymentInput).mutation(async ({ ctx, input }) => {
      assertFinanceAccess(ctx.user);
      const now = new Date();
      const organizationId = requireOrganizationId(ctx.user);
      if (useMock()) {
        const doc: PaymentDoc = {
          id: mockId++,
          organizationId,
          ...input,
          createdBy: ctx.user.id,
          createdAt: now,
          updatedAt: now,
        };
        mockPayments.unshift(doc);
        return toIso(doc);
      }
      await ensureSchema();
      const doc = await insertDoc<PaymentDoc>(Collections.payments, {
        organizationId,
        ...input,
        createdBy: ctx.user.id,
        createdAt: now,
        updatedAt: now,
      });
      if (input.invoiceId != null) {
        const inv = await findById<InvoiceDoc>(Collections.invoices, input.invoiceId);
        if (inv && inv.organizationId === organizationId) {
          const total = invoiceTotal(inv);
          if (input.amount >= total * 0.99) {
            await updateById<InvoiceDoc>(Collections.invoices, inv.id, {
              status: "paid",
              updatedAt: now,
            });
          }
        }
      }
      if (input.bankAccountId != null) {
        const bank = await findById<BankAccountDoc>(Collections.bankAccounts, input.bankAccountId);
        if (bank && bank.organizationId === organizationId) {
          await updateById<BankAccountDoc>(Collections.bankAccounts, bank.id, {
            currentBalance: bank.currentBalance + input.amount,
            updatedAt: now,
          });
        }
      }
      return toIso(doc);
    }),
    update: authedQuery.input(paymentInput.extend({ id: z.number() })).mutation(async ({ ctx, input }) => {
      assertFinanceAccess(ctx.user);
      const { id, ...data } = input;
      const now = new Date();
      if (useMock()) {
        const idx = mockPayments.findIndex((p) => p.id === id);
        if (idx < 0) throw new TRPCError({ code: "NOT_FOUND", message: "Payment not found" });
        mockPayments[idx] = { ...mockPayments[idx], ...data, updatedAt: now };
        return toIso(mockPayments[idx]);
      }
      await ensureSchema();
      const existing = await findById<PaymentDoc>(Collections.payments, id);
      if (!existing || existing.organizationId !== requireOrganizationId(ctx.user)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Payment not found" });
      }
      const updated = await updateById<PaymentDoc>(Collections.payments, id, {
        ...data,
        updatedAt: now,
      });
      return updated ? toIso(updated) : null;
    }),
    delete: authedQuery.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
      assertFinanceAccess(ctx.user);
      if (useMock()) {
        const idx = mockPayments.findIndex((p) => p.id === input.id);
        if (idx >= 0) mockPayments.splice(idx, 1);
        return { success: true };
      }
      await ensureSchema();
      const existing = await findById<PaymentDoc>(Collections.payments, input.id);
      if (!existing || existing.organizationId !== requireOrganizationId(ctx.user)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Payment not found" });
      }
      const col = await getCollection<PaymentDoc>(Collections.payments);
      await col.deleteOne({ id: input.id });
      return { success: true };
    }),
  }),

  // ——— Expenses ———
  expenses: createRouter({
    list: authedQuery.query(async ({ ctx }) => {
      assertFinanceAccess(ctx.user);
      if (useMock()) return crudList(mockExpenses, ctx.user.organizationId ?? 1);
      await ensureSchema();
      const col = await getCollection<ExpenseDoc>(Collections.expenses);
      const docs = await col.find(orgFilter(ctx.user)).sort({ expenseDate: -1 }).toArray();
      return docs.map(toIso);
    }),
    create: authedQuery.input(expenseInput).mutation(async ({ ctx, input }) => {
      assertFinanceAccess(ctx.user);
      const now = new Date();
      const organizationId = requireOrganizationId(ctx.user);
      if (useMock()) {
        const doc: ExpenseDoc = {
          id: mockId++,
          organizationId,
          ...input,
          createdBy: ctx.user.id,
          createdAt: now,
          updatedAt: now,
        };
        mockExpenses.unshift(doc);
        return toIso(doc);
      }
      await ensureSchema();
      const doc = await insertDoc<ExpenseDoc>(Collections.expenses, {
        organizationId,
        ...input,
        createdBy: ctx.user.id,
        createdAt: now,
        updatedAt: now,
      });
      if (input.status === "recorded" && input.bankAccountId != null) {
        const bank = await findById<BankAccountDoc>(Collections.bankAccounts, input.bankAccountId);
        if (bank && bank.organizationId === organizationId) {
          await updateById<BankAccountDoc>(Collections.bankAccounts, bank.id, {
            currentBalance: bank.currentBalance - (input.amount + input.taxAmount),
            updatedAt: now,
          });
        }
      }
      return toIso(doc);
    }),
    update: authedQuery.input(expenseInput.extend({ id: z.number() })).mutation(async ({ ctx, input }) => {
      assertFinanceAccess(ctx.user);
      const { id, ...data } = input;
      const now = new Date();
      if (useMock()) {
        const idx = mockExpenses.findIndex((e) => e.id === id);
        if (idx < 0) throw new TRPCError({ code: "NOT_FOUND", message: "Expense not found" });
        mockExpenses[idx] = { ...mockExpenses[idx], ...data, updatedAt: now };
        return toIso(mockExpenses[idx]);
      }
      await ensureSchema();
      const existing = await findById<ExpenseDoc>(Collections.expenses, id);
      if (!existing || existing.organizationId !== requireOrganizationId(ctx.user)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Expense not found" });
      }
      const updated = await updateById<ExpenseDoc>(Collections.expenses, id, {
        ...data,
        updatedAt: now,
      });
      return updated ? toIso(updated) : null;
    }),
    delete: authedQuery.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
      assertFinanceAccess(ctx.user);
      if (useMock()) {
        const idx = mockExpenses.findIndex((e) => e.id === input.id);
        if (idx >= 0) mockExpenses.splice(idx, 1);
        return { success: true };
      }
      await ensureSchema();
      const existing = await findById<ExpenseDoc>(Collections.expenses, input.id);
      if (!existing || existing.organizationId !== requireOrganizationId(ctx.user)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Expense not found" });
      }
      const col = await getCollection<ExpenseDoc>(Collections.expenses);
      await col.deleteOne({ id: input.id });
      return { success: true };
    }),
  }),

  // ——— Contracts ———
  contracts: createRouter({
    list: authedQuery.query(async ({ ctx }) => {
      assertFinanceAccess(ctx.user);
      if (useMock()) return crudList(mockContracts, ctx.user.organizationId ?? 1);
      await ensureSchema();
      const col = await getCollection<ContractDoc>(Collections.contracts);
      const docs = await col.find(orgFilter(ctx.user)).sort({ createdAt: -1 }).toArray();
      return docs.map(toIso);
    }),
    create: authedQuery.input(contractInput).mutation(async ({ ctx, input }) => {
      assertFinanceAccess(ctx.user);
      const now = new Date();
      const organizationId = requireOrganizationId(ctx.user);
      if (useMock()) {
        const doc: ContractDoc = {
          id: mockId++,
          organizationId,
          ...input,
          createdBy: ctx.user.id,
          createdAt: now,
          updatedAt: now,
        };
        mockContracts.unshift(doc);
        return toIso(doc);
      }
      await ensureSchema();
      const doc = await insertDoc<ContractDoc>(Collections.contracts, {
        organizationId,
        ...input,
        createdBy: ctx.user.id,
        createdAt: now,
        updatedAt: now,
      });
      return toIso(doc);
    }),
    update: authedQuery.input(contractInput.extend({ id: z.number() })).mutation(async ({ ctx, input }) => {
      assertFinanceAccess(ctx.user);
      const { id, ...data } = input;
      const now = new Date();
      if (useMock()) {
        const idx = mockContracts.findIndex((c) => c.id === id);
        if (idx < 0) throw new TRPCError({ code: "NOT_FOUND", message: "Contract not found" });
        mockContracts[idx] = { ...mockContracts[idx], ...data, updatedAt: now };
        return toIso(mockContracts[idx]);
      }
      await ensureSchema();
      const existing = await findById<ContractDoc>(Collections.contracts, id);
      if (!existing || existing.organizationId !== requireOrganizationId(ctx.user)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Contract not found" });
      }
      const updated = await updateById<ContractDoc>(Collections.contracts, id, {
        ...data,
        updatedAt: now,
      });
      return updated ? toIso(updated) : null;
    }),
    delete: authedQuery.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
      assertFinanceAccess(ctx.user);
      if (useMock()) {
        const idx = mockContracts.findIndex((c) => c.id === input.id);
        if (idx >= 0) mockContracts.splice(idx, 1);
        return { success: true };
      }
      await ensureSchema();
      const existing = await findById<ContractDoc>(Collections.contracts, input.id);
      if (!existing || existing.organizationId !== requireOrganizationId(ctx.user)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Contract not found" });
      }
      const col = await getCollection<ContractDoc>(Collections.contracts);
      await col.deleteOne({ id: input.id });
      return { success: true };
    }),
  }),

  // ——— Vendor bills (AP) ———
  vendorBills: createRouter({
    list: authedQuery.query(async ({ ctx }) => {
      assertFinanceAccess(ctx.user);
      if (useMock()) return crudList(mockVendorBills, ctx.user.organizationId ?? 1);
      await ensureSchema();
      const col = await getCollection<VendorBillDoc>(Collections.vendorBills);
      const docs = await col.find(orgFilter(ctx.user)).sort({ dueDate: 1 }).toArray();
      return docs.map(toIso);
    }),
    create: authedQuery.input(vendorBillInput).mutation(async ({ ctx, input }) => {
      assertFinanceAccess(ctx.user);
      const now = new Date();
      const organizationId = requireOrganizationId(ctx.user);
      if (useMock()) {
        const doc: VendorBillDoc = {
          id: mockId++,
          organizationId,
          ...input,
          createdBy: ctx.user.id,
          createdAt: now,
          updatedAt: now,
        };
        mockVendorBills.unshift(doc);
        return toIso(doc);
      }
      await ensureSchema();
      const doc = await insertDoc<VendorBillDoc>(Collections.vendorBills, {
        organizationId,
        ...input,
        createdBy: ctx.user.id,
        createdAt: now,
        updatedAt: now,
      });
      return toIso(doc);
    }),
    update: authedQuery.input(vendorBillInput.extend({ id: z.number() })).mutation(async ({ ctx, input }) => {
      assertFinanceAccess(ctx.user);
      const { id, ...data } = input;
      const now = new Date();
      if (useMock()) {
        const idx = mockVendorBills.findIndex((b) => b.id === id);
        if (idx < 0) throw new TRPCError({ code: "NOT_FOUND", message: "Bill not found" });
        mockVendorBills[idx] = { ...mockVendorBills[idx], ...data, updatedAt: now };
        return toIso(mockVendorBills[idx]);
      }
      await ensureSchema();
      const existing = await findById<VendorBillDoc>(Collections.vendorBills, id);
      if (!existing || existing.organizationId !== requireOrganizationId(ctx.user)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Bill not found" });
      }
      const updated = await updateById<VendorBillDoc>(Collections.vendorBills, id, {
        ...data,
        updatedAt: now,
      });
      return updated ? toIso(updated) : null;
    }),
    delete: authedQuery.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
      assertFinanceAccess(ctx.user);
      if (useMock()) {
        const idx = mockVendorBills.findIndex((b) => b.id === input.id);
        if (idx >= 0) mockVendorBills.splice(idx, 1);
        return { success: true };
      }
      await ensureSchema();
      const existing = await findById<VendorBillDoc>(Collections.vendorBills, input.id);
      if (!existing || existing.organizationId !== requireOrganizationId(ctx.user)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Bill not found" });
      }
      const col = await getCollection<VendorBillDoc>(Collections.vendorBills);
      await col.deleteOne({ id: input.id });
      return { success: true };
    }),
  }),

  // ——— Reports ———
  reports: createRouter({
    summary: authedQuery.query(async ({ ctx }) => {
      assertFinanceAccess(ctx.user);
      await ensureSchema();
      const tenant = orgFilter(ctx.user);
      const [invoices, expenses, payments, banks, bills] = await Promise.all([
        useMock()
          ? Promise.resolve([] as InvoiceDoc[])
          : (await getCollection<InvoiceDoc>(Collections.invoices)).find(tenant).toArray(),
        useMock()
          ? Promise.resolve(mockExpenses.filter((e) => e.organizationId === (ctx.user.organizationId ?? 1)))
          : (await getCollection<ExpenseDoc>(Collections.expenses)).find(tenant).toArray(),
        useMock()
          ? Promise.resolve(mockPayments.filter((p) => p.organizationId === (ctx.user.organizationId ?? 1)))
          : (await getCollection<PaymentDoc>(Collections.payments)).find(tenant).toArray(),
        useMock()
          ? Promise.resolve(mockBanks.filter((b) => b.organizationId === (ctx.user.organizationId ?? 1)))
          : (await getCollection<BankAccountDoc>(Collections.bankAccounts)).find(tenant).toArray(),
        useMock()
          ? Promise.resolve(mockVendorBills.filter((b) => b.organizationId === (ctx.user.organizationId ?? 1)))
          : (await getCollection<VendorBillDoc>(Collections.vendorBills)).find(tenant).toArray(),
      ]);

      const income = invoices
        .filter((i) => i.status !== "draft")
        .reduce((s, i) => s + invoiceTotal(i), 0);
      const received = payments.reduce((s, p) => s + p.amount, 0);
      const expenseTotal = expenses
        .filter((e) => e.status === "recorded")
        .reduce((s, e) => s + e.amount + e.taxAmount, 0);
      const ar = invoices
        .filter((i) => isInvoiceOutstanding(i.status))
        .reduce((s, i) => s + invoiceBalanceDue(i), 0);
      const ap = bills.filter((b) => b.status === "open").reduce((s, b) => s + b.amount, 0);
      const cash = banks.reduce((s, b) => s + b.currentBalance, 0);
      const taxCollected = invoices.reduce((s, i) => {
        const sub = i.items.reduce(
          (sum, item) => sum + item.quantity * item.rate * (1 - (item.discountPercent || 0) / 100),
          0,
        );
        return s + (sub * (i.taxPercent || 0)) / 100;
      }, 0);

      const expensesByCategory = new Map<string, number>();
      for (const e of expenses.filter((x) => x.status === "recorded")) {
        expensesByCategory.set(
          e.category || "General",
          (expensesByCategory.get(e.category || "General") ?? 0) + e.amount + e.taxAmount,
        );
      }

      return {
        income: Math.round(income),
        received: Math.round(received),
        expenses: Math.round(expenseTotal),
        netProfit: Math.round(received - expenseTotal),
        accountsReceivable: Math.round(ar),
        accountsPayable: Math.round(ap),
        cashInBank: Math.round(cash),
        taxCollected: Math.round(taxCollected),
        expenseBreakdown: [...expensesByCategory.entries()].map(([name, amount]) => ({
          name,
          amount: Math.round(amount),
        })),
        bankAccounts: banks.map((b) => ({
          id: b.id,
          name: b.name,
          bankName: b.bankName,
          balance: b.currentBalance,
          currency: b.currency,
        })),
      };
    }),
  }),
});
