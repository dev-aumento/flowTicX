import { useMemo, useState } from "react";
import { HandCoins, Pencil, Trash2 } from "lucide-react";
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

type BillStatus = "open" | "paid" | "void";

type VendorBillForm = {
  vendorName: string;
  billNumber: string;
  billDate: string;
  dueDate: string;
  amount: number;
  currency: string;
  category: string;
  status: BillStatus;
  paidAt: string | null;
  notes: string;
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

function statusTone(status: BillStatus) {
  if (status === "paid") return "success" as const;
  if (status === "open") return "warning" as const;
  return "neutral" as const;
}

const emptyForm = (): VendorBillForm => ({
  vendorName: "",
  billNumber: "",
  billDate: todayIso(),
  dueDate: "",
  amount: 0,
  currency: "INR",
  category: "General",
  status: "open",
  paidAt: null,
  notes: "",
});

export default function PayablePage() {
  const utils = trpc.useUtils();
  const { data = [], isLoading } = trpc.finance.vendorBills.list.useQuery();
  const createMutation = trpc.finance.vendorBills.create.useMutation();
  const updateMutation = trpc.finance.vendorBills.update.useMutation();
  const deleteMutation = trpc.finance.vendorBills.delete.useMutation();

  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<VendorBillForm>(emptyForm());
  const [error, setError] = useState<string | null>(null);

  const openTotal = useMemo(
    () => data.filter((b) => b.status === "open").reduce((sum, b) => sum + b.amount, 0),
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
      vendorName: row.vendorName,
      billNumber: row.billNumber,
      billDate: row.billDate,
      dueDate: row.dueDate,
      amount: row.amount,
      currency: row.currency || "INR",
      category: row.category,
      status: row.status,
      paidAt: row.paidAt,
      notes: row.notes,
    });
    setError(null);
    setOpen(true);
  }

  async function handleSave() {
    setError(null);
    if (!form.vendorName.trim() || !form.billNumber.trim()) {
      setError("Vendor and bill number are required.");
      return;
    }
    if (form.amount <= 0) {
      setError("Amount must be greater than zero.");
      return;
    }
    try {
      const payload = {
        vendorName: form.vendorName,
        billNumber: form.billNumber,
        billDate: form.billDate,
        dueDate: form.dueDate,
        amount: form.amount,
        currency: form.currency,
        category: form.category,
        status: form.status,
        paidAt: form.status === "paid" ? form.paidAt ?? todayIso() : null,
        notes: form.notes,
      };
      if (editId != null) {
        await updateMutation.mutateAsync({ id: editId, ...payload });
      } else {
        await createMutation.mutateAsync(payload);
      }
      await utils.finance.vendorBills.list.invalidate();
      await utils.finance.reports.summary.invalidate();
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save vendor bill.");
    }
  }

  async function handleDelete(id: number) {
    if (!window.confirm("Delete this vendor bill?")) return;
    await deleteMutation.mutateAsync({ id });
    await utils.finance.vendorBills.list.invalidate();
  }

  if (isLoading) return <FinanceLoading />;

  return (
    <div className="space-y-4">
      <FinancePageHeader
        title="Accounts Payable"
        description="Track vendor bills and outgoing payments."
        icon={HandCoins}
        onCreate={openCreate}
        createLabel="Add vendor bill"
        extra={
          <div className="text-sm text-gray-500">
            Open balance:{" "}
            <span className="font-semibold text-gray-800">
              <FinanceMoney value={openTotal} />
            </span>
          </div>
        }
      />

      {data.length === 0 ? (
        <FinanceEmptyState
          icon={HandCoins}
          title="No vendor bills yet"
          description="Add bills from suppliers to track what you owe."
          actionLabel="Add vendor bill"
          onAction={openCreate}
        />
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs">
              <tr>
                <th className="text-left font-medium px-4 py-3">Bill #</th>
                <th className="text-left font-medium px-4 py-3">Vendor</th>
                <th className="text-left font-medium px-4 py-3">Bill date</th>
                <th className="text-left font-medium px-4 py-3">Due date</th>
                <th className="text-left font-medium px-4 py-3">Category</th>
                <th className="text-right font-medium px-4 py-3">Amount</th>
                <th className="text-left font-medium px-4 py-3">Status</th>
                <th className="text-right font-medium px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <tr key={row.id} className="border-t border-gray-100">
                  <td className="px-4 py-3 font-medium text-gray-800">{row.billNumber}</td>
                  <td className="px-4 py-3 text-gray-600">{row.vendorName}</td>
                  <td className="px-4 py-3 text-gray-500">{formatDate(row.billDate)}</td>
                  <td className="px-4 py-3 text-gray-500">{formatDate(row.dueDate)}</td>
                  <td className="px-4 py-3 text-gray-600">{row.category}</td>
                  <td className="px-4 py-3 text-right font-semibold">
                    <FinanceMoney value={row.amount} currency={row.currency} />
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge label={row.status} tone={statusTone(row.status)} />
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
            <DialogTitle>{editId != null ? "Edit vendor bill" : "Add vendor bill"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-1">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Vendor name">
                <input
                  className={inputClass}
                  value={form.vendorName}
                  onChange={(e) => setForm((f) => ({ ...f, vendorName: e.target.value }))}
                />
              </Field>
              <Field label="Bill number">
                <input
                  className={inputClass}
                  value={form.billNumber}
                  onChange={(e) => setForm((f) => ({ ...f, billNumber: e.target.value }))}
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Bill date">
                <input
                  type="date"
                  className={inputClass}
                  value={form.billDate}
                  onChange={(e) => setForm((f) => ({ ...f, billDate: e.target.value }))}
                />
              </Field>
              <Field label="Due date">
                <input
                  type="date"
                  className={inputClass}
                  value={form.dueDate}
                  onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
                />
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
              <Field label="Currency">
                <input
                  className={inputClass}
                  value={form.currency}
                  onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}
                />
              </Field>
              <Field label="Status">
                <select
                  className={selectClass}
                  value={form.status}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      status: e.target.value as BillStatus,
                      paidAt: e.target.value === "paid" ? f.paidAt ?? todayIso() : null,
                    }))
                  }
                >
                  <option value="open">Open</option>
                  <option value="paid">Paid</option>
                  <option value="void">Void</option>
                </select>
              </Field>
            </div>
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
                {editId != null ? "Save changes" : "Add bill"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
