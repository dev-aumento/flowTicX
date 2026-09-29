import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, authedQuery } from "./middleware";
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
  CustomerDoc,
  InvoiceDoc,
  ProjectDoc,
  SafeUser,
  TaskDoc,
  TimeEntryDoc,
  UserDoc,
} from "@db/mongo/types";
import { orgFilter, belongsToUserOrg, requireOrganizationId } from "./lib/tenant";
import {
  assertCanMutateInvoices,
  canAccessOrgInvoices,
  clientVisibleInvoiceStatusFilter,
  customerIdsForClientPortal,
  isClientPortalInvoiceViewer,
} from "./lib/client-invoices";
import { queueInvoiceClientNotification } from "./lib/notify-invoice-clients";
import { invoicePeriodBounds, invoiceTotal, normalizeHsnSac, resolveInvoicePayment, timeEntrySecondsInRange } from "@/lib/invoice-store";
import { staffTimerMatchesExcludedRoles } from "@/lib/department-options";
import * as mock from "./lib/mock-store";

const lineItemSchema = z.object({
  id: z.string(),
  itemDetails: z.string(),
  quantity: z.number(),
  rate: z.number(),
  discountPercent: z.number(),
  taxPercent: z.number(),
});

const invoiceInputSchema = z.object({
  invoiceNumber: z.string().min(1),
  orderNumber: z.string(),
  customerId: z.number(),
  customerName: z.string().min(1),
  invoiceDate: z.string(),
  periodStart: z.string().optional().default(""),
  periodEnd: z.string().optional().default(""),
  terms: z.string(),
  dueDate: z.string(),
  salesperson: z.string(),
  hsnSac: z
    .string()
    .max(20)
    .optional()
    .default("")
    .transform((value) => normalizeHsnSac(value)),
  items: z.array(lineItemSchema).min(1),
  customerNotes: z.string(),
  shippingCharges: z.number(),
  taxMode: z.enum(["tds", "tcs", "none"]),
  taxPercent: z.number(),
  adjustment: z.number(),
  roundOff: z.boolean(),
  currency: z.string().min(3).max(3).optional().default("INR"),
  status: z.enum(["draft", "pending", "sent", "partial", "paid"]),
  amountPaid: z.number().nonnegative().optional().default(0),
  projectId: z.number().int().positive().nullable().optional(),
  excludeDepartments: z.array(z.string()).optional().default([]),
  autoInvoiceType: z.enum(["task", "project"]).nullable().optional(),
});

const mockInvoices: InvoiceDoc[] = [];
let mockNextId = 1;

function useMock() {
  return isAuthDisabled() || !hasMongoConfigured();
}

async function assertCanViewInvoice(user: SafeUser, invoice: InvoiceDoc) {
  if (canAccessOrgInvoices(user) && invoice.organizationId === requireOrganizationId(user)) {
    return;
  }
  if (!(await isClientPortalInvoiceViewer(user))) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You do not have permission to view invoices",
    });
  }
  const customerIds = await customerIdsForClientPortal(user);
  if (!customerIds.includes(invoice.customerId) || invoice.status === "draft") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You do not have permission to view this invoice",
    });
  }
}

async function invoiceListFilter(user: SafeUser) {
  const tenant = orgFilter(user);
  const clientPortal = await isClientPortalInvoiceViewer(user);
  if (canAccessOrgInvoices(user) && !clientPortal) return tenant;

  if (!clientPortal && !canAccessOrgInvoices(user)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You do not have permission to view invoices",
    });
  }

  const customerIds = await customerIdsForClientPortal(user);
  const billed =
    customerIds.length > 0
      ? { customerId: { $in: customerIds }, ...clientVisibleInvoiceStatusFilter() }
      : null;

  if (clientPortal && billed) {
    if (canAccessOrgInvoices(user)) {
      return { $or: [tenant, billed] };
    }
    return billed;
  }

  if (canAccessOrgInvoices(user)) return tenant;
  return null;
}

function matchesInvoiceFilter(inv: InvoiceDoc, filter: Record<string, unknown> | null): boolean {
  if (!filter) return false;
  if (Array.isArray(filter.$or)) {
    return filter.$or.some((part) =>
      matchesInvoiceFilter(inv, part as Record<string, unknown>),
    );
  }
  if (filter.organizationId != null && inv.organizationId !== filter.organizationId) {
    return false;
  }
  const customerIn = (filter.customerId as { $in?: number[] } | undefined)?.$in;
  if (customerIn && !customerIn.includes(inv.customerId)) return false;
  const statusNe = (filter.status as { $ne?: string } | undefined)?.$ne;
  if (statusNe && inv.status === statusNe) return false;
  return true;
}

function toClient(doc: InvoiceDoc) {
  return {
    ...doc,
    hsnSac: doc.hsnSac ?? "",
    createdAt:
      doc.createdAt instanceof Date ? doc.createdAt.toISOString() : String(doc.createdAt),
    updatedAt:
      doc.updatedAt instanceof Date ? doc.updatedAt.toISOString() : String(doc.updatedAt),
  };
}

function toInvoiceCustomer(doc: CustomerDoc | null | undefined) {
  if (!doc) return null;
  return {
    displayName: doc.displayName,
    companyName: doc.companyName,
    currency: doc.currency,
    billingAddress1: doc.billingAddress1,
    billingAddress2: doc.billingAddress2,
    billingCity: doc.billingCity,
    billingState: doc.billingState,
    billingZip: doc.billingZip,
    billingCountry: doc.billingCountry,
    gstNumber: doc.gstNumber,
  };
}

function withResolvedPayment<T extends z.infer<typeof invoiceInputSchema>>(input: T) {
  const payment = resolveInvoicePayment({
    status: input.status,
    amountPaid: input.amountPaid,
    total: invoiceTotal(input),
  });
  return { ...input, ...payment };
}

async function loadInvoiceCustomer(invoice: InvoiceDoc) {
  if (useMock()) return null;
  const customer = await findById<CustomerDoc>(Collections.customers, invoice.customerId);
  if (!customer || customer.organizationId !== invoice.organizationId) return null;
  return toInvoiceCustomer(customer);
}

export const invoiceRouter = createRouter({
  list: authedQuery.query(async ({ ctx }) => {
    if (useMock()) {
      const filter = await invoiceListFilter(ctx.user);
      if (!filter) return [];
      return mockInvoices.filter((inv) => matchesInvoiceFilter(inv, filter)).map(toClient);
    }

    await ensureSchema();
    const filter = await invoiceListFilter(ctx.user);
    if (!filter) return [];
    const col = await getCollection<InvoiceDoc>(Collections.invoices);
    const docs = await col.find(filter).sort({ createdAt: -1 }).toArray();
    return docs.map(toClient);
  }),

  get: authedQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      if (useMock()) {
        const doc = mockInvoices.find((inv) => inv.id === input.id);
        if (!doc) return null;
        await assertCanViewInvoice(ctx.user, doc);
        return { ...toClient(doc), customer: null };
      }

      await ensureSchema();
      const doc = await findById<InvoiceDoc>(Collections.invoices, input.id);
      if (!doc) return null;
      await assertCanViewInvoice(ctx.user, doc);
      return { ...toClient(doc), customer: await loadInvoiceCustomer(doc) };
    }),

  create: authedQuery
    .input(invoiceInputSchema)
    .mutation(async ({ ctx, input }) => {
      await assertPlanFeature(ctx.user, "invoices");
      assertCanMutateInvoices(ctx.user);
      const now = new Date();
      const organizationId = requireOrganizationId(ctx.user);
      const data = withResolvedPayment(input);

      if (useMock()) {
        const doc: InvoiceDoc = {
          id: mockNextId++,
          organizationId,
          ...data,
          createdBy: ctx.user.id,
          createdAt: now,
          updatedAt: now,
        };
        mockInvoices.unshift(doc);
        queueInvoiceClientNotification({ invoice: doc, actorId: ctx.user.id });
        return toClient(doc);
      }

      await ensureSchema();
      const doc = await insertDoc<InvoiceDoc>(Collections.invoices, {
        organizationId,
        ...data,
        createdBy: ctx.user.id,
        createdAt: now,
        updatedAt: now,
      });
      queueInvoiceClientNotification({ invoice: doc, actorId: ctx.user.id });
      return toClient(doc);
    }),

  update: authedQuery
    .input(invoiceInputSchema.extend({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      assertCanMutateInvoices(ctx.user);
      const { id, ...inputData } = input;
      const data = withResolvedPayment(inputData);
      const now = new Date();

      if (useMock()) {
        const idx = mockInvoices.findIndex(
          (inv) =>
            inv.id === id && inv.organizationId === (ctx.user.organizationId ?? 1),
        );
        if (idx < 0) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Invoice not found" });
        }
        const existingMock = mockInvoices[idx]!;
        mockInvoices[idx] = {
          ...existingMock,
          ...data,
          updatedAt: now,
        };
        const updatedMock = mockInvoices[idx]!;
        queueInvoiceClientNotification({
          invoice: updatedMock,
          actorId: ctx.user.id,
          previousStatus: existingMock.status,
          previousAmountPaid: existingMock.amountPaid ?? 0,
        });
        return toClient(updatedMock);
      }

      await ensureSchema();
      const existing = await findById<InvoiceDoc>(Collections.invoices, id);
      if (!existing || existing.organizationId !== requireOrganizationId(ctx.user)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Invoice not found" });
      }

      await updateById<InvoiceDoc>(Collections.invoices, id, {
        ...data,
        updatedAt: now,
      });
      const updated = await findById<InvoiceDoc>(Collections.invoices, id);
      if (updated) {
        queueInvoiceClientNotification({
          invoice: updated,
          actorId: ctx.user.id,
          previousStatus: existing.status,
          previousAmountPaid: existing.amountPaid ?? 0,
        });
      }
      return toClient(updated!);
    }),

  delete: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      assertCanMutateInvoices(ctx.user);
      const organizationId = requireOrganizationId(ctx.user);

      if (useMock()) {
        const idx = mockInvoices.findIndex(
          (inv) => inv.id === input.id && inv.organizationId === organizationId,
        );
        if (idx < 0) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Invoice not found" });
        }
        mockInvoices.splice(idx, 1);
        return { success: true };
      }

      await ensureSchema();
      const existing = await findById<InvoiceDoc>(Collections.invoices, input.id);
      if (!existing || existing.organizationId !== organizationId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Invoice not found" });
      }

      const col = await getCollection<InvoiceDoc>(Collections.invoices);
      await col.deleteOne({ id: input.id, organizationId });
      return { success: true };
    }),

  importLegacy: authedQuery
    .input(
      z.object({
        invoices: z.array(
          invoiceInputSchema.extend({
            legacyId: z.string().optional(),
            createdAt: z.string().optional(),
            /** Legacy localStorage used string customer ids. */
            legacyCustomerId: z.union([z.string(), z.number()]).optional(),
          }),
        ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertCanMutateInvoices(ctx.user);
      if (input.invoices.length === 0) return { imported: 0 };

      const organizationId = requireOrganizationId(ctx.user);
      let imported = 0;

      if (useMock()) {
        for (const item of input.invoices) {
          const { legacyId: _l, legacyCustomerId: _c, createdAt, ...data } = item;
          const exists = mockInvoices.some(
            (inv) =>
              inv.organizationId === organizationId &&
              inv.invoiceNumber === data.invoiceNumber,
          );
          if (exists) continue;
          const now = createdAt ? new Date(createdAt) : new Date();
          mockInvoices.unshift({
            id: mockNextId++,
            organizationId,
            ...data,
            createdBy: ctx.user.id,
            createdAt: now,
            updatedAt: now,
          });
          imported += 1;
        }
        return { imported };
      }

      await ensureSchema();
      const col = await getCollection<InvoiceDoc>(Collections.invoices);
      for (const item of input.invoices) {
        const { legacyId: _l, legacyCustomerId: _c, createdAt, ...data } = item;
        const exists = await col.findOne({
          organizationId,
          invoiceNumber: data.invoiceNumber,
        });
        if (exists) continue;
        const now = createdAt ? new Date(createdAt) : new Date();
        await insertDoc<InvoiceDoc>(Collections.invoices, {
          organizationId,
          ...data,
          createdBy: ctx.user.id,
          createdAt: now,
          updatedAt: now,
        });
        imported += 1;
      }
      return { imported };
    }),

  listProjectTaskLines: authedQuery
    .input(
      z.object({
        projectId: z.number().int().positive(),
        periodStart: z.string().min(1),
        periodEnd: z.string().min(1),
        excludeDepartments: z.array(z.string()).optional().default([]),
      }),
    )
    .query(async ({ ctx, input }) => {
      assertCanMutateInvoices(ctx.user);
      const bounds = invoicePeriodBounds(input.periodStart, input.periodEnd);
      if (!bounds) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Select a valid start and end date",
        });
      }

      if (useMock()) {
        const list = mock.mockInvoiceProjectTaskLines(input.projectId);
        const tasks = list.map((task) => {
          const trackedSeconds = mock.mockInvoiceTrackedSeconds(
            task.id,
            bounds,
            input.excludeDepartments,
          );
          return {
            id: task.id,
            title: task.title,
            hours: trackedSeconds / 3600,
          };
        });
        return {
          tasks,
          totalHours: tasks.reduce((sum, task) => sum + task.hours, 0),
        };
      }

      await ensureSchema();
      const project = await findById<ProjectDoc>(Collections.projects, input.projectId);
      if (!project || !belongsToUserOrg(ctx.user, project.organizationId)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      }

      const taskCol = await getCollection<TaskDoc>(Collections.tasks);
      const tasks = await taskCol
        .find({ ...orgFilter(ctx.user), projectId: input.projectId })
        .sort({ position: 1, id: 1 })
        .toArray();

      const taskById = new Map<number, TaskDoc>();
      for (const task of tasks) {
        const id = Number(task.id);
        if (Number.isFinite(id)) taskById.set(id, task);
      }

      const taskIds = [...taskById.keys()];
      const secondsByTask = new Map<number, number>();
      const now = new Date();
      const timeCol = await getCollection<TimeEntryDoc>(Collections.timeEntries);
      const entries = await timeCol
        .find({
          $or: [
            ...(taskIds.length > 0 ? [{ taskId: { $in: taskIds } }] : []),
            { projectId: input.projectId, taskId: { $ne: null } },
          ],
        })
        .toArray();

      const excludeDepartments = input.excludeDepartments ?? [];
      const userMap = new Map<number, Pick<UserDoc, "department" | "position" | "role">>();
      if (excludeDepartments.length > 0) {
        const userIds = [
          ...new Set(
            entries
              .map((entry) => Number(entry.userId))
              .filter((id) => Number.isInteger(id) && id > 0),
          ),
        ];
        if (userIds.length > 0) {
          const userCol = await getCollection<UserDoc>(Collections.users);
          const userDocs = (await userCol.find({ id: { $in: userIds } }).toArray()) as UserDoc[];
          for (const user of userDocs) {
            userMap.set(Number(user.id), {
              department: user.department ?? null,
              position: user.position ?? null,
              role: user.role,
            });
          }
        }
      }

      const extraTaskIds: number[] = [];
      for (const entry of entries) {
        const tid = Number(entry.taskId);
        if (!Number.isFinite(tid) || tid <= 0) continue;
        if (
          excludeDepartments.length > 0 &&
          staffTimerMatchesExcludedRoles(userMap.get(Number(entry.userId)), excludeDepartments)
        ) {
          continue;
        }
        const seconds = timeEntrySecondsInRange(entry, bounds.start, bounds.end, now);
        if (seconds <= 0) continue;
        secondsByTask.set(tid, (secondsByTask.get(tid) ?? 0) + seconds);
        if (!taskById.has(tid)) extraTaskIds.push(tid);
      }

      if (extraTaskIds.length > 0) {
        const extra = await taskCol
          .find({ ...orgFilter(ctx.user), id: { $in: [...new Set(extraTaskIds)] } })
          .toArray();
        for (const task of extra) {
          const id = Number(task.id);
          if (Number.isFinite(id)) taskById.set(id, task);
        }
      }

      const mapped = [...taskById.values()]
        .sort((a, b) => a.position - b.position || Number(a.id) - Number(b.id))
        .map((task) => {
          const id = Number(task.id);
          return {
            id,
            title: task.title,
            hours: (secondsByTask.get(id) ?? 0) / 3600,
          };
        });
      return {
        tasks: mapped,
        totalHours: mapped.reduce((sum, task) => sum + task.hours, 0),
      };
    }),
});
