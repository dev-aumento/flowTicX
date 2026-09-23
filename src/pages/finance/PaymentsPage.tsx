import { useMemo, useState } from "react";
import { Banknote, Pencil, Trash2 } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { formatMoney, invoiceTotal } from "@/lib/invoice-store";
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
  inputClass,
  selectClass,
} from "@/components/finance/FinancePageKit";

type PaymentMethod = "bank_transfer" | "upi" | "cash" | "cheque" | "card" | "other";

type PaymentForm = {
  invoiceId: number | null;
  customerId: number | null;
  customerName: string;
  amount: number;
  paymentDate: string;
  method: PaymentMethod;
  bankAccountId: number | null;
  reference: string;
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

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(value: string) {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

const emptyForm = (): PaymentForm => ({
  invoiceId: null,
  customerId: null,
  customerName: "",
  amount: 0,
  paymentDate: todayIso(),
  method: "bank_transfer",
  bankAccountId: null,
  reference: "",
  notes: "",
});

export default function PaymentsPage() {
  const utils = trpc.useUtils();
  const { data = [], isLoading } = trpc.finance.payments.list.useQuery();
  const { data: invoices = [] } = trpc.invoice.list.useQuery();
  const { data: customers = [] } = trpc.customer.list.useQuery();
  const { data: banks = [] } = trpc.finance.bankAccounts.list.useQuery();
  const createMutation = trpc.finance.payments.create.useMutation();
  const updateMutation = trpc.finance.payments.update.useMutation();
  const deleteMutation = trpc.finance.payments.delete.useMutation();

  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<PaymentForm>(emptyForm());
  const [error, setError] = useState<string | null>(null);

  const bankMap = useMemo(
    () => new Map(banks.map((b) => [b.id, b.name])),
    [banks],
  );

  const invoiceMap = useMemo(
    () => new Map(invoices.map((i) => [i.id, i])),
    [invoices],
  );

  const totalReceived = useMemo(
    () => data.reduce((sum, p) => sum + p.amount, 0),
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
      invoiceId: row.invoiceId,
      customerId: row.customerId,
      customerName: row.customerName,
      amount: row.amount,
      paymentDate: row.paymentDate,
      method: row.method,
      bankAccountId: row.bankAccountId,
      reference: row.reference,
      notes: row.notes,
    });
    setError(null);
    setOpen(true);
  }

  function handleInvoiceChange(invoiceId: number | null) {
    const invoice = invoiceId != null ? invoiceMap.get(invoiceId) : undefined;
    setForm((f) => ({
      ...f,
      invoiceId,
      customerId: invoice?.customerId ?? f.customerId,
      customerName: invoice?.customerName ?? f.customerName,
      amount: invoice ? invoiceTotal(invoice) : f.amount,
    }));
  }

  async function handleSave() {
    setError(null);
    if (form.amount <= 0) {
      setError("Amount must be greater than zero.");
      return;
    }
    if (!form.paymentDate) {
      setError("Payment date is required.");
      return;
    }
    try {
      const payload = {
        invoiceId: form.invoiceId,
        customerId: form.customerId,
        customerName: form.customerName,
        amount: form.amount,
        paymentDate: form.paymentDate,
        method: form.method,
        bankAccountId: form.bankAccountId,
        reference: form.reference,
        notes: form.notes,
      };
      if (editId != null) {
        await updateMutation.mutateAsync({ id: editId, ...payload });
      } else {
        await createMutation.mutateAsync(payload);
      }
      await utils.finance.payments.list.invalidate();
      await utils.finance.bankAccounts.list.invalidate();
      await utils.invoice.list.invalidate();
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save payment.");
    }
  }

  async function handleDelete(id: number) {
    if (!window.confirm("Delete this payment?")) return;
    await deleteMutation.mutateAsync({ id });
    await utils.finance.payments.list.invalidate();
  }

  if (isLoading) return <FinanceLoading />;

  return (
    <div className="space-y-4">
      <FinancePageHeader
        title="Payments"
        description="Record and track incoming payments against invoices."
        icon={Banknote}
        onCreate={openCreate}
        createLabel="Record payment"
        extra={
          <div className="text-sm text-gray-500">
            Total received:{" "}
            <span className="font-semibold text-gray-800">
              <FinanceMoney value={totalReceived} />
            </span>
          </div>
        }
      />

      {data.length === 0 ? (
        <FinanceEmptyState
          icon={Banknote}
          title="No payments recorded"
          description="Record customer payments to update bank balances and invoice status."
          actionLabel="Record payment"
          onAction={openCreate}
        />
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs">
              <tr>
                <th className="text-left font-medium px-4 py-3">Date</th>
                <th className="text-left font-medium px-4 py-3">Customer</th>
                <th className="text-left font-medium px-4 py-3">Invoice</th>
                <th className="text-left font-medium px-4 py-3">Method</th>
                <th className="text-left font-medium px-4 py-3">Bank</th>
                <th className="text-right font-medium px-4 py-3">Amount</th>
                <th className="text-right font-medium px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <tr key={row.id} className="border-t border-gray-100">
                  <td className="px-4 py-3 text-gray-500">{formatDate(row.paymentDate)}</td>
                  <td className="px-4 py-3 font-medium text-gray-800">
                    {row.customerName || "—"}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {row.invoiceId != null
                      ? invoiceMap.get(row.invoiceId)?.invoiceNumber ?? `#${row.invoiceId}`
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-gray-600 capitalize">
                    {METHOD_LABELS[row.method]}
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {row.bankAccountId != null ? bankMap.get(row.bankAccountId) ?? "—" : "—"}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold">
                    <FinanceMoney value={row.amount} />
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
            <DialogTitle>{editId != null ? "Edit payment" : "Record payment"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-1">
            <Field label="Invoice (optional)">
              <select
                className={selectClass}
                value={form.invoiceId ?? ""}
                onChange={(e) =>
                  handleInvoiceChange(e.target.value ? Number(e.target.value) : null)
                }
              >
                <option value="">No invoice linked</option>
                {invoices.map((inv) => (
                  <option key={inv.id} value={inv.id}>
                    {inv.invoiceNumber} — {inv.customerName} ({formatMoney(invoiceTotal(inv))})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Customer">
              <select
                className={selectClass}
                value={form.customerId ?? ""}
                onChange={(e) => {
                  const id = e.target.value ? Number(e.target.value) : null;
                  const customer = customers.find((c) => c.id === id);
                  setForm((f) => ({
                    ...f,
                    customerId: id,
                    customerName: customer?.displayName ?? f.customerName,
                  }));
                }}
              >
                <option value="">Select customer…</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.displayName}
                  </option>
                ))}
              </select>
            </Field>
            {!form.customerId ? (
              <Field label="Customer name">
                <input
                  className={inputClass}
                  value={form.customerName}
                  onChange={(e) => setForm((f) => ({ ...f, customerName: e.target.value }))}
                />
              </Field>
            ) : null}
            <div className="grid grid-cols-2 gap-3">
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
              <Field label="Payment date">
                <input
                  type="date"
                  className={inputClass}
                  value={form.paymentDate}
                  onChange={(e) => setForm((f) => ({ ...f, paymentDate: e.target.value }))}
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Method">
                <select
                  className={selectClass}
                  value={form.method}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, method: e.target.value as PaymentMethod }))
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
            <Field label="Reference">
              <input
                className={inputClass}
                value={form.reference}
                onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))}
                placeholder="Txn ID / cheque no."
              />
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
                {editId != null ? "Save changes" : "Record payment"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
