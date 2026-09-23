import { useMemo, useState } from "react";
import { Pencil, Receipt, Trash2 } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FinanceEmptyState,
  FinanceLoading,
  FinanceMoney,
  FinancePageHeader,
  StatusBadge,
  inputClass,
  selectClass,
} from "@/components/finance/FinancePageKit";

type PaymentMethod = "bank_transfer" | "upi" | "cash" | "cheque" | "card" | "other";
type ExpenseStatus = "draft" | "recorded";

type ExpenseForm = {
  expenseDate: string;
  vendorName: string;
  category: string;
  ledgerAccountId: number | null;
  amount: number;
  taxAmount: number;
  currency: string;
  paymentMethod: PaymentMethod;
  bankAccountId: number | null;
  status: ExpenseStatus;
  notes: string;
};

const METHOD_LABELS: Record<PaymentMethod, string> = {
  bank_transfer: "Bank transfer",
  upi: "UPI",
  cash: "Cash",
  cheque: "Cheque",
  card: "Card",
  other: "Other",
};

const CATEGORIES = [
  "General",
  "Salaries & Wages",
  "Software & Tools",
  "Marketing",
  "Office Expenses",
  "Travel & Meals",
  "Other Expenses",
];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(value: string) {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

const emptyForm = (): ExpenseForm => ({
  expenseDate: todayIso(),
  vendorName: "",
  category: "General",
  ledgerAccountId: null,
  amount: 0,
  taxAmount: 0,
  currency: "INR",
  paymentMethod: "bank_transfer",
  bankAccountId: null,
  status: "recorded",
  notes: "",
});

export default function ExpensesPage() {
  const utils = trpc.useUtils();
  const { data = [], isLoading } = trpc.finance.expenses.list.useQuery();
  const { data: banks = [] } = trpc.finance.bankAccounts.list.useQuery();
  const { data: ledgers = [] } = trpc.finance.ledgerAccounts.list.useQuery();
  const createMutation = trpc.finance.expenses.create.useMutation();
  const updateMutation = trpc.finance.expenses.update.useMutation();
  const deleteMutation = trpc.finance.expenses.delete.useMutation();

  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<ExpenseForm>(emptyForm());
  const [error, setError] = useState<string | null>(null);

  const ledgerMap = useMemo(
    () => new Map(ledgers.map((l) => [l.id, `${l.code} — ${l.name}`])),
    [ledgers],
  );

  const expenseAccounts = useMemo(
    () => ledgers.filter((l) => l.type === "expense" && l.isActive),
    [ledgers],
  );

  const totalExpenses = useMemo(
    () =>
      data
        .filter((e) => e.status === "recorded")
        .reduce((sum, e) => sum + e.amount + e.taxAmount, 0),
    [data],
  );

  function openCreate() {
    setEditId(null);
    setForm(emptyForm());
    setError(null);
    setOpen(true);
  }

  function openEdit(row: (typeof data)[number]) {
    setEditId(row.id);
    setForm({
      expenseDate: row.expenseDate,
      vendorName: row.vendorName,
      category: row.category,
      ledgerAccountId: row.ledgerAccountId,
      amount: row.amount,
      taxAmount: row.taxAmount,
      currency: row.currency || "INR",
      paymentMethod: row.paymentMethod,
      bankAccountId: row.bankAccountId,
      status: row.status,
      notes: row.notes,
    });
    setError(null);
    setOpen(true);
  }

  async function handleSave() {
    setError(null);
    if (!form.vendorName.trim()) {
      setError("Vendor name is required.");
      return;
    }
    if (form.amount <= 0) {
      setError("Amount must be greater than zero.");
      return;
    }
    try {
      const payload = {
        expenseDate: form.expenseDate,
        vendorName: form.vendorName,
        category: form.category,
        ledgerAccountId: form.ledgerAccountId,
        amount: form.amount,
        taxAmount: form.taxAmount,
        currency: form.currency,
        paymentMethod: form.paymentMethod,
        bankAccountId: form.bankAccountId,
        status: form.status,
        notes: form.notes,
      };
      if (editId != null) {
        await updateMutation.mutateAsync({ id: editId, ...payload });
      } else {
        await createMutation.mutateAsync(payload);
      }
      await utils.finance.expenses.list.invalidate();
      await utils.finance.bankAccounts.list.invalidate();
      await utils.finance.reports.summary.invalidate();
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save expense.");
    }
  }

  async function handleDelete(id: number) {
    if (!window.confirm("Delete this expense?")) return;
    await deleteMutation.mutateAsync({ id });
    await utils.finance.expenses.list.invalidate();
  }

  if (isLoading) return <FinanceLoading />;

  return (
    <div className="space-y-4">
      <FinancePageHeader
        title="Expenses"
        description="Track business expenses, vendors, and reimbursements."
        icon={Receipt}
        onCreate={openCreate}
        createLabel="Add expense"
        extra={
          <div className="text-sm text-gray-500">
            Recorded total:{" "}
            <span className="font-semibold text-gray-800">
              <FinanceMoney value={totalExpenses} />
            </span>
          </div>
        }
      />

      {data.length === 0 ? (
        <FinanceEmptyState
          icon={Receipt}
          title="No expenses yet"
          description="Log vendor bills and operating costs to keep your books accurate."
          actionLabel="Add expense"
          onAction={openCreate}
        />
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs">
              <tr>
                <th className="text-left font-medium px-4 py-3">Date</th>
                <th className="text-left font-medium px-4 py-3">Vendor</th>
                <th className="text-left font-medium px-4 py-3">Category</th>
                <th className="text-left font-medium px-4 py-3">Account</th>
                <th className="text-right font-medium px-4 py-3">Amount</th>
                <th className="text-left font-medium px-4 py-3">Status</th>
                <th className="text-right font-medium px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <tr key={row.id} className="border-t border-gray-100">
                  <td className="px-4 py-3 text-gray-500">{formatDate(row.expenseDate)}</td>
                  <td className="px-4 py-3 font-medium text-gray-800">{row.vendorName}</td>
                  <td className="px-4 py-3 text-gray-600">{row.category}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {row.ledgerAccountId != null
                      ? ledgerMap.get(row.ledgerAccountId) ?? "—"
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold">
                    <FinanceMoney
                      value={row.amount + row.taxAmount}
                      currency={row.currency}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge
                      label={row.status}
                      tone={row.status === "recorded" ? "success" : "neutral"}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => openEdit(row)}
                        className="p-2 rounded-lg hover:bg-gray-50 text-gray-500"
                        aria-label="Edit"
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDelete(row.id)}
                        className="p-2 rounded-lg hover:bg-red-50 text-red-500"
                        aria-label="Delete"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editId != null ? "Edit expense" : "Add expense"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-1">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Expense date">
                <input
                  type="date"
                  className={inputClass}
                  value={form.expenseDate}
                  onChange={(e) => setForm((f) => ({ ...f, expenseDate: e.target.value }))}
                />
              </Field>
              <Field label="Status">
                <select
                  className={selectClass}
                  value={form.status}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, status: e.target.value as ExpenseStatus }))
                  }
                >
                  <option value="draft">Draft</option>
                  <option value="recorded">Recorded</option>
                </select>
              </Field>
            </div>
            <Field label="Vendor name">
              <input
                className={inputClass}
                value={form.vendorName}
                onChange={(e) => setForm((f) => ({ ...f, vendorName: e.target.value }))}
                placeholder="Vendor or payee"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Category">
                <select
                  className={selectClass}
                  value={form.category}
                  onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Ledger account">
                <select
                  className={selectClass}
                  value={form.ledgerAccountId ?? ""}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      ledgerAccountId: e.target.value ? Number(e.target.value) : null,
                    }))
                  }
                >
                  <option value="">None</option>
                  {expenseAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} — {a.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Amount">
                <input
                  type="number"
                  className={inputClass}
                  value={form.amount}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, amount: Number(e.target.value) || 0 }))
                  }
                />
              </Field>
              <Field label="Tax amount">
                <input
                  type="number"
                  className={inputClass}
                  value={form.taxAmount}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, taxAmount: Number(e.target.value) || 0 }))
                  }
                />
              </Field>
              <Field label="Currency">
                <input
                  className={inputClass}
                  value={form.currency}
                  onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Payment method">
                <select
                  className={selectClass}
                  value={form.paymentMethod}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      paymentMethod: e.target.value as PaymentMethod,
                    }))
                  }
                >
                  {(Object.keys(METHOD_LABELS) as PaymentMethod[]).map((m) => (
                    <option key={m} value={m}>
                      {METHOD_LABELS[m]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Bank account">
                <select
                  className={selectClass}
                  value={form.bankAccountId ?? ""}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      bankAccountId: e.target.value ? Number(e.target.value) : null,
                    }))
                  }
                >
                  <option value="">None</option>
                  {banks.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Notes">
              <textarea
                className={`${inputClass} h-20 py-2`}
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </Field>
            {error ? <p className="text-sm text-red-500">{error}</p> : null}
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => void handleSave()}
                disabled={createMutation.isPending || updateMutation.isPending}
                className="bg-[#2563EB] hover:bg-[#1D4ED8]"
              >
                {editId != null ? "Save changes" : "Add expense"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
