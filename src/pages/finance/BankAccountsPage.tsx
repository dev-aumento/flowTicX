import { useMemo, useState } from "react";
import { Building2, Pencil, Trash2, X } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
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

type BankForm = {
  name: string;
  bankName: string;
  accountNumber: string;
  accountType: "current" | "savings" | "cash" | "other";
  currency: string;
  openingBalance: number;
  currentBalance: number;
  ifscOrSwift: string;
  branch: string;
  isActive: boolean;
  notes: string;
};

const emptyForm = (): BankForm => ({
  name: "",
  bankName: "",
  accountNumber: "",
  accountType: "current",
  currency: "INR",
  openingBalance: 0,
  currentBalance: 0,
  ifscOrSwift: "",
  branch: "",
  isActive: true,
  notes: "",
});

export default function BankAccountsPage() {
  const utils = trpc.useUtils();
  const { data = [], isLoading } = trpc.finance.bankAccounts.list.useQuery();
  const createMutation = trpc.finance.bankAccounts.create.useMutation();
  const updateMutation = trpc.finance.bankAccounts.update.useMutation();
  const deleteMutation = trpc.finance.bankAccounts.delete.useMutation();

  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<BankForm>(emptyForm());
  const [error, setError] = useState<string | null>(null);

  const totalBalance = useMemo(
    () => data.reduce((sum, b) => sum + (b.currentBalance || 0), 0),
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
      name: row.name,
      bankName: row.bankName,
      accountNumber: row.accountNumber,
      accountType: row.accountType,
      currency: row.currency || "INR",
      openingBalance: row.openingBalance,
      currentBalance: row.currentBalance,
      ifscOrSwift: row.ifscOrSwift,
      branch: row.branch,
      isActive: row.isActive,
      notes: row.notes,
    });
    setError(null);
    setOpen(true);
  }

  async function handleSave() {
    setError(null);
    if (!form.name.trim() || !form.bankName.trim()) {
      setError("Account name and bank name are required.");
      return;
    }
    try {
      if (editId != null) {
        await updateMutation.mutateAsync({ id: editId, ...form });
      } else {
        await createMutation.mutateAsync(form);
      }
      await utils.finance.bankAccounts.list.invalidate();
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save bank account.");
    }
  }

  async function handleDelete(id: number) {
    if (!window.confirm("Delete this bank account?")) return;
    await deleteMutation.mutateAsync({ id });
    await utils.finance.bankAccounts.list.invalidate();
  }

  if (isLoading) return <FinanceLoading />;

  const saving = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-4">
      <FinancePageHeader
        title="Bank Accounts"
        description="Add, edit, and track balances for your business bank accounts."
        icon={Building2}
        onCreate={openCreate}
        createLabel="Add bank account"
        extra={
          <div className="text-sm text-gray-500">
            Total balance:{" "}
            <span className="font-semibold text-gray-800">
              <FinanceMoney value={totalBalance} />
            </span>
          </div>
        }
      />

      {data.length === 0 ? (
        <FinanceEmptyState
          icon={Building2}
          title="No bank accounts yet"
          description="Add your current and savings accounts to track cash and reconcile payments."
          actionLabel="Add bank account"
          onAction={openCreate}
        />
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs">
              <tr>
                <th className="text-left font-medium px-4 py-3">Account</th>
                <th className="text-left font-medium px-4 py-3">Bank</th>
                <th className="text-left font-medium px-4 py-3">Type</th>
                <th className="text-left font-medium px-4 py-3">Number</th>
                <th className="text-right font-medium px-4 py-3">Balance</th>
                <th className="text-left font-medium px-4 py-3">Status</th>
                <th className="text-right font-medium px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <tr key={row.id} className="border-t border-gray-100">
                  <td className="px-4 py-3 font-medium text-gray-800">{row.name}</td>
                  <td className="px-4 py-3 text-gray-600">
                    {row.bankName}
                    {row.branch ? <span className="text-gray-400"> · {row.branch}</span> : null}
                  </td>
                  <td className="px-4 py-3 capitalize text-gray-600">{row.accountType}</td>
                  <td className="px-4 py-3 text-gray-500 font-mono text-xs">
                    {row.accountNumber || "—"}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold">
                    <FinanceMoney value={row.currentBalance} currency={row.currency} />
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge
                      label={row.isActive ? "Active" : "Inactive"}
                      tone={row.isActive ? "success" : "neutral"}
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
        <DialogContent
          showCloseButton={false}
          className="sm:max-w-lg p-0 gap-0 overflow-visible border-0 bg-transparent shadow-none"
        >
          <div className="relative">
            <DialogClose asChild>
              <button
                type="button"
                className="absolute -top-3 -right-3 z-20 flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-500 shadow-md transition-colors hover:bg-gray-50 hover:text-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/40"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </DialogClose>

            <div className="flex max-h-[90vh] flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">
              <DialogHeader className="shrink-0 px-6 pt-6 pb-3 pr-10">
                <DialogTitle>
                  {editId != null ? "Edit bank account" : "Add bank account"}
                </DialogTitle>
              </DialogHeader>

              <div className="min-h-0 flex-1 overflow-y-auto px-6 space-y-3">
                <Field label="Account display name">
                  <input
                    className={inputClass}
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="HDFC Current"
                  />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Bank name">
                    <input
                      className={inputClass}
                      value={form.bankName}
                      onChange={(e) => setForm((f) => ({ ...f, bankName: e.target.value }))}
                      placeholder="HDFC Bank"
                    />
                  </Field>
                  <Field label="Account type">
                    <select
                      className={selectClass}
                      value={form.accountType}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          accountType: e.target.value as BankForm["accountType"],
                        }))
                      }
                    >
                      <option value="current">Current</option>
                      <option value="savings">Savings</option>
                      <option value="cash">Cash</option>
                      <option value="other">Other</option>
                    </select>
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Account number">
                    <input
                      className={inputClass}
                      value={form.accountNumber}
                      onChange={(e) => setForm((f) => ({ ...f, accountNumber: e.target.value }))}
                    />
                  </Field>
                  <Field label="IFSC / SWIFT">
                    <input
                      className={inputClass}
                      value={form.ifscOrSwift}
                      onChange={(e) => setForm((f) => ({ ...f, ifscOrSwift: e.target.value }))}
                    />
                  </Field>
                </div>
                <Field label="Branch">
                  <input
                    className={inputClass}
                    value={form.branch}
                    onChange={(e) => setForm((f) => ({ ...f, branch: e.target.value }))}
                  />
                </Field>
                <div className="grid grid-cols-3 gap-3">
                  <Field label="Currency">
                    <input
                      className={inputClass}
                      value={form.currency}
                      onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}
                    />
                  </Field>
                  <Field label="Opening balance">
                    <input
                      type="number"
                      className={inputClass}
                      value={form.openingBalance}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, openingBalance: Number(e.target.value) || 0 }))
                      }
                    />
                  </Field>
                  <Field label="Current balance">
                    <input
                      type="number"
                      className={inputClass}
                      value={form.currentBalance}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, currentBalance: Number(e.target.value) || 0 }))
                      }
                    />
                  </Field>
                </div>
                <Field label="Notes">
                  <textarea
                    className={`${inputClass} h-20 py-2`}
                    value={form.notes}
                    onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  />
                </Field>
                <label className="flex items-center gap-2 text-sm text-gray-700 pb-1">
                  <input
                    type="checkbox"
                    checked={form.isActive}
                    onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
                  />
                  Active account
                </label>
                {error ? <p className="text-sm text-red-500 pb-1">{error}</p> : null}
              </div>

              <DialogFooter className="shrink-0 flex-row justify-end gap-2 border-t border-gray-100 bg-white px-6 py-4">
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={saving}
                  className="bg-[#2563EB] hover:bg-[#1D4ED8]"
                >
                  {editId != null ? "Save changes" : "Add account"}
                </Button>
              </DialogFooter>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
