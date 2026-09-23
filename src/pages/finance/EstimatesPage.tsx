import { useMemo, useState } from "react";
import { ClipboardList, Pencil, Trash2 } from "lucide-react";
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

type EstimateStatus = "draft" | "sent" | "accepted" | "declined" | "converted";

type LineItem = {
  id: string;
  itemDetails: string;
  quantity: number;
  rate: number;
  discountPercent: number;
  taxPercent: number;
};

type EstimateForm = {
  estimateNumber: string;
  customerId: number | null;
  customerName: string;
  estimateDate: string;
  validUntil: string;
  currency: string;
  lineDescription: string;
  lineAmount: number;
  items: LineItem[];
  notes: string;
  taxPercent: number;
  adjustment: number;
  status: EstimateStatus;
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

function estimateTotal(
  items: LineItem[],
  taxPercent: number,
  adjustment = 0,
) {
  const sub = items.reduce((sum, item) => {
    const base = item.quantity * item.rate;
    return sum + Math.max(0, base * (1 - (item.discountPercent || 0) / 100));
  }, 0);
  const tax = (sub * (taxPercent || 0)) / 100;
  return Math.max(0, sub + tax + (adjustment || 0));
}

function makeLineItem(description: string, amount: number): LineItem {
  return {
    id: crypto.randomUUID(),
    itemDetails: description,
    quantity: 1,
    rate: amount,
    discountPercent: 0,
    taxPercent: 0,
  };
}

function statusTone(status: EstimateStatus) {
  if (status === "accepted") return "success" as const;
  if (status === "sent") return "info" as const;
  if (status === "declined") return "danger" as const;
  if (status === "converted") return "warning" as const;
  return "neutral" as const;
}

const emptyForm = (): EstimateForm => ({
  estimateNumber: `EST-${Date.now().toString().slice(-6)}`,
  customerId: null,
  customerName: "",
  estimateDate: todayIso(),
  validUntil: "",
  currency: "INR",
  lineDescription: "",
  lineAmount: 0,
  items: [makeLineItem("", 0)],
  notes: "",
  taxPercent: 0,
  adjustment: 0,
  status: "draft",
});

export default function EstimatesPage() {
  const utils = trpc.useUtils();
  const { data = [], isLoading } = trpc.finance.estimates.list.useQuery();
  const { data: customers = [] } = trpc.customer.list.useQuery();
  const createMutation = trpc.finance.estimates.create.useMutation();
  const updateMutation = trpc.finance.estimates.update.useMutation();
  const deleteMutation = trpc.finance.estimates.delete.useMutation();

  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<EstimateForm>(emptyForm());
  const [error, setError] = useState<string | null>(null);

  const formTotal = useMemo(
    () => {
      const items =
        form.lineDescription.trim() || form.lineAmount > 0
          ? [makeLineItem(form.lineDescription, form.lineAmount)]
          : form.items;
      return estimateTotal(items, form.taxPercent, form.adjustment);
    },
    [form],
  );

  const pipelineTotal = useMemo(
    () => data.reduce((sum, row) => sum + (row.total ?? estimateTotal(row.items, row.taxPercent, row.adjustment)), 0),
    [data],
  );

  function openCreate() {
    setEditId(null);
    setForm(emptyForm());
    setError(null);
    setOpen(true);
  }

  function openEdit(row: (typeof data)[number]) {
    const first = row.items[0];
    setEditId(row.id);
    setForm({
      estimateNumber: row.estimateNumber,
      customerId: row.customerId,
      customerName: row.customerName,
      estimateDate: row.estimateDate,
      validUntil: row.validUntil,
      currency: row.currency || "INR",
      lineDescription: first?.itemDetails ?? "",
      lineAmount: first ? first.quantity * first.rate : 0,
      items: row.items.length > 0 ? row.items : [makeLineItem("", 0)],
      notes: row.notes,
      taxPercent: row.taxPercent,
      adjustment: row.adjustment,
      status: row.status,
    });
    setError(null);
    setOpen(true);
  }

  function buildPayload(f: EstimateForm) {
    const items =
      f.lineDescription.trim() || f.lineAmount > 0
        ? [makeLineItem(f.lineDescription, f.lineAmount)]
        : f.items.filter((i) => i.itemDetails.trim() || i.rate > 0);
    return {
      estimateNumber: f.estimateNumber,
      customerId: f.customerId,
      customerName: f.customerName,
      estimateDate: f.estimateDate,
      validUntil: f.validUntil,
      currency: f.currency,
      items: items.length > 0 ? items : [makeLineItem("Services", 0)],
      notes: f.notes,
      taxPercent: f.taxPercent,
      adjustment: f.adjustment,
      status: f.status,
    };
  }

  async function handleSave() {
    setError(null);
    if (!form.estimateNumber.trim() || !form.customerName.trim()) {
      setError("Estimate number and customer are required.");
      return;
    }
    try {
      const payload = buildPayload(form);
      if (editId != null) {
        await updateMutation.mutateAsync({ id: editId, ...payload });
      } else {
        await createMutation.mutateAsync(payload);
      }
      await utils.finance.estimates.list.invalidate();
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save estimate.");
    }
  }

  async function handleDelete(id: number) {
    if (!window.confirm("Delete this estimate?")) return;
    await deleteMutation.mutateAsync({ id });
    await utils.finance.estimates.list.invalidate();
  }

  if (isLoading) return <FinanceLoading />;

  return (
    <div className="space-y-4">
      <FinancePageHeader
        title="Estimates"
        description="Create quotes and estimates for clients before invoicing."
        icon={ClipboardList}
        onCreate={openCreate}
        createLabel="New estimate"
        extra={
          <div className="text-sm text-gray-500">
            Pipeline total:{" "}
            <span className="font-semibold text-gray-800">
              <FinanceMoney value={pipelineTotal} />
            </span>
          </div>
        }
      />

      {data.length === 0 ? (
        <FinanceEmptyState
          icon={ClipboardList}
          title="No estimates yet"
          description="Create your first estimate to share pricing with prospects."
          actionLabel="New estimate"
          onAction={openCreate}
        />
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs">
              <tr>
                <th className="text-left font-medium px-4 py-3">Number</th>
                <th className="text-left font-medium px-4 py-3">Customer</th>
                <th className="text-left font-medium px-4 py-3">Date</th>
                <th className="text-left font-medium px-4 py-3">Valid until</th>
                <th className="text-right font-medium px-4 py-3">Total</th>
                <th className="text-left font-medium px-4 py-3">Status</th>
                <th className="text-right font-medium px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row) => {
                const total = row.total ?? estimateTotal(row.items, row.taxPercent, row.adjustment);
                return (
                  <tr key={row.id} className="border-t border-gray-100">
                    <td className="px-4 py-3 font-medium text-gray-800">{row.estimateNumber}</td>
                    <td className="px-4 py-3 text-gray-600">{row.customerName}</td>
                    <td className="px-4 py-3 text-gray-500">{formatDate(row.estimateDate)}</td>
                    <td className="px-4 py-3 text-gray-500">{formatDate(row.validUntil)}</td>
                    <td className="px-4 py-3 text-right font-semibold">
                      <FinanceMoney value={total} currency={row.currency} />
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
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editId != null ? "Edit estimate" : "New estimate"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-1">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Estimate number">
                <input
                  className={inputClass}
                  value={form.estimateNumber}
                  onChange={(e) => setForm((f) => ({ ...f, estimateNumber: e.target.value }))}
                />
              </Field>
              <Field label="Status">
                <select
                  className={selectClass}
                  value={form.status}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, status: e.target.value as EstimateStatus }))
                  }
                >
                  <option value="draft">Draft</option>
                  <option value="sent">Sent</option>
                  <option value="accepted">Accepted</option>
                  <option value="declined">Declined</option>
                  <option value="converted">Converted</option>
                </select>
              </Field>
            </div>
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
                  placeholder="Acme Corp"
                />
              </Field>
            ) : null}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Estimate date">
                <input
                  type="date"
                  className={inputClass}
                  value={form.estimateDate}
                  onChange={(e) => setForm((f) => ({ ...f, estimateDate: e.target.value }))}
                />
              </Field>
              <Field label="Valid until">
                <input
                  type="date"
                  className={inputClass}
                  value={form.validUntil}
                  onChange={(e) => setForm((f) => ({ ...f, validUntil: e.target.value }))}
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Line item description">
                <input
                  className={inputClass}
                  value={form.lineDescription}
                  onChange={(e) => setForm((f) => ({ ...f, lineDescription: e.target.value }))}
                  placeholder="Consulting services"
                />
              </Field>
              <Field label="Amount">
                <input
                  type="number"
                  className={inputClass}
                  value={form.lineAmount}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, lineAmount: Number(e.target.value) || 0 }))
                  }
                />
              </Field>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Tax %">
                <input
                  type="number"
                  className={inputClass}
                  value={form.taxPercent}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, taxPercent: Number(e.target.value) || 0 }))
                  }
                />
              </Field>
              <Field label="Adjustment">
                <input
                  type="number"
                  className={inputClass}
                  value={form.adjustment}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, adjustment: Number(e.target.value) || 0 }))
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
            <div className="rounded-lg bg-gray-50 px-3 py-2 text-sm flex justify-between">
              <span className="text-gray-600">Total</span>
              <span className="font-semibold text-gray-800">
                <FinanceMoney value={formTotal} currency={form.currency} />
              </span>
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
                {editId != null ? "Save changes" : "Create estimate"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
