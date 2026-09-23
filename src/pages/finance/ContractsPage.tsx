import { useMemo, useState } from "react";
import { Pencil, ScrollText, Trash2 } from "lucide-react";
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

type ContractStatus = "draft" | "active" | "expired" | "cancelled";

type ContractForm = {
  customerId: number | null;
  customerName: string;
  title: string;
  startDate: string;
  endDate: string;
  value: number;
  currency: string;
  billingTerms: string;
  status: ContractStatus;
  notes: string;
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

function statusTone(status: ContractStatus) {
  if (status === "active") return "success" as const;
  if (status === "expired") return "warning" as const;
  if (status === "cancelled") return "danger" as const;
  return "neutral" as const;
}

const emptyForm = (): ContractForm => ({
  customerId: null,
  customerName: "",
  title: "",
  startDate: todayIso(),
  endDate: "",
  value: 0,
  currency: "INR",
  billingTerms: "",
  status: "draft",
  notes: "",
});

export default function ContractsPage() {
  const utils = trpc.useUtils();
  const { data = [], isLoading } = trpc.finance.contracts.list.useQuery();
  const { data: customers = [] } = trpc.customer.list.useQuery();
  const createMutation = trpc.finance.contracts.create.useMutation();
  const updateMutation = trpc.finance.contracts.update.useMutation();
  const deleteMutation = trpc.finance.contracts.delete.useMutation();

  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<ContractForm>(emptyForm());
  const [error, setError] = useState<string | null>(null);

  const activeValue = useMemo(
    () =>
      data.filter((c) => c.status === "active").reduce((sum, c) => sum + (c.value || 0), 0),
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
      customerId: row.customerId,
      customerName: row.customerName,
      title: row.title,
      startDate: row.startDate,
      endDate: row.endDate,
      value: row.value,
      currency: row.currency || "INR",
      billingTerms: row.billingTerms,
      status: row.status,
      notes: row.notes,
    });
    setError(null);
    setOpen(true);
  }

  async function handleSave() {
    setError(null);
    if (!form.title.trim() || !form.customerName.trim()) {
      setError("Title and customer are required.");
      return;
    }
    try {
      const payload = {
        customerId: form.customerId,
        customerName: form.customerName,
        title: form.title,
        startDate: form.startDate,
        endDate: form.endDate,
        value: form.value,
        currency: form.currency,
        billingTerms: form.billingTerms,
        status: form.status,
        notes: form.notes,
      };
      if (editId != null) {
        await updateMutation.mutateAsync({ id: editId, ...payload });
      } else {
        await createMutation.mutateAsync(payload);
      }
      await utils.finance.contracts.list.invalidate();
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save contract.");
    }
  }

  async function handleDelete(id: number) {
    if (!window.confirm("Delete this contract?")) return;
    await deleteMutation.mutateAsync({ id });
    await utils.finance.contracts.list.invalidate();
  }

  if (isLoading) return <FinanceLoading />;

  return (
    <div className="space-y-4">
      <FinancePageHeader
        title="Contracts"
        description="Manage client contracts, renewals, and billing terms."
        icon={ScrollText}
        onCreate={openCreate}
        createLabel="New contract"
        extra={
          <div className="text-sm text-gray-500">
            Active value:{" "}
            <span className="font-semibold text-gray-800">
              <FinanceMoney value={activeValue} />
            </span>
          </div>
        }
      />

      {data.length === 0 ? (
        <FinanceEmptyState
          icon={ScrollText}
          title="No contracts yet"
          description="Track recurring agreements and billing terms for your clients."
          actionLabel="New contract"
          onAction={openCreate}
        />
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs">
              <tr>
                <th className="text-left font-medium px-4 py-3">Title</th>
                <th className="text-left font-medium px-4 py-3">Customer</th>
                <th className="text-left font-medium px-4 py-3">Start</th>
                <th className="text-left font-medium px-4 py-3">End</th>
                <th className="text-right font-medium px-4 py-3">Value</th>
                <th className="text-left font-medium px-4 py-3">Status</th>
                <th className="text-right font-medium px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <tr key={row.id} className="border-t border-gray-100">
                  <td className="px-4 py-3 font-medium text-gray-800">{row.title}</td>
                  <td className="px-4 py-3 text-gray-600">{row.customerName}</td>
                  <td className="px-4 py-3 text-gray-500">{formatDate(row.startDate)}</td>
                  <td className="px-4 py-3 text-gray-500">{formatDate(row.endDate)}</td>
                  <td className="px-4 py-3 text-right font-semibold">
                    <FinanceMoney value={row.value} currency={row.currency} />
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
            <DialogTitle>{editId != null ? "Edit contract" : "New contract"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-1">
            <Field label="Title">
              <input
                className={inputClass}
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="Annual support agreement"
              />
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
              <Field label="Start date">
                <input
                  type="date"
                  className={inputClass}
                  value={form.startDate}
                  onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
                />
              </Field>
              <Field label="End date">
                <input
                  type="date"
                  className={inputClass}
                  value={form.endDate}
                  onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
                />
              </Field>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Value">
                <input
                  type="number"
                  className={inputClass}
                  value={form.value}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, value: Number(e.target.value) || 0 }))
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
                    setForm((f) => ({ ...f, status: e.target.value as ContractStatus }))
                  }
                >
                  <option value="draft">Draft</option>
                  <option value="active">Active</option>
                  <option value="expired">Expired</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </Field>
            </div>
            <Field label="Billing terms">
              <input
                className={inputClass}
                value={form.billingTerms}
                onChange={(e) => setForm((f) => ({ ...f, billingTerms: e.target.value }))}
                placeholder="Net 30, monthly retainer…"
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
                {editId != null ? "Save changes" : "Create contract"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
