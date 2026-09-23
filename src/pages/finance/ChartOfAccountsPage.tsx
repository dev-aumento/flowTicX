import { useMemo, useState } from "react";
import { BookOpen, Pencil, Trash2 } from "lucide-react";
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
  FinancePageHeader,
  StatusBadge,
  inputClass,
  selectClass,
} from "@/components/finance/FinancePageKit";

type LedgerForm = {
  code: string;
  name: string;
  type: "asset" | "liability" | "equity" | "income" | "expense";
  description: string;
  isActive: boolean;
};

const emptyForm = (): LedgerForm => ({
  code: "",
  name: "",
  type: "expense",
  description: "",
  isActive: true,
});

const TYPE_ORDER = ["asset", "liability", "equity", "income", "expense"] as const;

export default function ChartOfAccountsPage() {
  const utils = trpc.useUtils();
  const { data = [], isLoading } = trpc.finance.ledgerAccounts.list.useQuery();
  const createMutation = trpc.finance.ledgerAccounts.create.useMutation();
  const updateMutation = trpc.finance.ledgerAccounts.update.useMutation();
  const deleteMutation = trpc.finance.ledgerAccounts.delete.useMutation();

  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<LedgerForm>(emptyForm());
  const [error, setError] = useState<string | null>(null);

  const grouped = useMemo(() => {
    return TYPE_ORDER.map((type) => ({
      type,
      rows: data.filter((d) => d.type === type),
    })).filter((g) => g.rows.length > 0);
  }, [data]);

  function openCreate() {
    setEditId(null);
    setForm(emptyForm());
    setError(null);
    setOpen(true);
  }

  function openEdit(row: (typeof data)[number]) {
    setEditId(row.id);
    setForm({
      code: row.code,
      name: row.name,
      type: row.type,
      description: row.description,
      isActive: row.isActive,
    });
    setError(null);
    setOpen(true);
  }

  async function handleSave() {
    setError(null);
    if (!form.code.trim() || !form.name.trim()) {
      setError("Code and name are required.");
      return;
    }
    try {
      if (editId != null) {
        await updateMutation.mutateAsync({ id: editId, ...form });
      } else {
        await createMutation.mutateAsync(form);
      }
      await utils.finance.ledgerAccounts.list.invalidate();
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save account.");
    }
  }

  async function handleDelete(id: number) {
    if (!window.confirm("Delete this ledger account?")) return;
    try {
      await deleteMutation.mutateAsync({ id });
      await utils.finance.ledgerAccounts.list.invalidate();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Could not delete account.");
    }
  }

  if (isLoading) return <FinanceLoading />;

  return (
    <div className="space-y-4">
      <FinancePageHeader
        title="Chart of Accounts"
        description="Organize income, expense, asset, and liability accounts for your books."
        icon={BookOpen}
        onCreate={openCreate}
        createLabel="Add account"
      />

      {data.length === 0 ? (
        <FinanceEmptyState
          icon={BookOpen}
          title="No accounts yet"
          description="Default accounts will appear once this page loads for your organization."
          actionLabel="Add account"
          onAction={openCreate}
        />
      ) : (
        <div className="space-y-4">
          {grouped.map((group) => (
            <div
              key={group.type}
              className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm"
            >
              <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-gray-800 capitalize">{group.type}</h2>
                <span className="text-xs text-gray-400">{group.rows.length} accounts</span>
              </div>
              <table className="w-full text-sm">
                <thead className="text-xs text-gray-400">
                  <tr>
                    <th className="text-left font-medium px-4 py-2">Code</th>
                    <th className="text-left font-medium px-4 py-2">Name</th>
                    <th className="text-left font-medium px-4 py-2">Description</th>
                    <th className="text-left font-medium px-4 py-2">Status</th>
                    <th className="text-right font-medium px-4 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {group.rows.map((row) => (
                    <tr key={row.id} className="border-t border-gray-50">
                      <td className="px-4 py-2.5 font-mono text-xs text-gray-600">{row.code}</td>
                      <td className="px-4 py-2.5 font-medium text-gray-800">
                        {row.name}
                        {row.isSystem ? (
                          <span className="ml-2 text-[10px] text-gray-400">System</span>
                        ) : null}
                      </td>
                      <td className="px-4 py-2.5 text-gray-500 truncate max-w-xs">
                        {row.description || "—"}
                      </td>
                      <td className="px-4 py-2.5">
                        <StatusBadge
                          label={row.isActive ? "Active" : "Inactive"}
                          tone={row.isActive ? "success" : "neutral"}
                        />
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => openEdit(row)}
                            className="p-2 rounded-lg hover:bg-gray-50 text-gray-500"
                          >
                            <Pencil size={15} />
                          </button>
                          {!row.isSystem ? (
                            <button
                              type="button"
                              onClick={() => void handleDelete(row.id)}
                              className="p-2 rounded-lg hover:bg-red-50 text-red-500"
                            >
                              <Trash2 size={15} />
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editId != null ? "Edit account" : "Add account"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-1">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Code">
                <input
                  className={inputClass}
                  value={form.code}
                  onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                  placeholder="5600"
                />
              </Field>
              <Field label="Type">
                <select
                  className={selectClass}
                  value={form.type}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, type: e.target.value as LedgerForm["type"] }))
                  }
                >
                  {TYPE_ORDER.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Name">
              <input
                className={inputClass}
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Consulting Income"
              />
            </Field>
            <Field label="Description">
              <textarea
                className={`${inputClass} h-20 py-2`}
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </Field>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
              />
              Active
            </label>
            {error ? <p className="text-sm text-red-500">{error}</p> : null}
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => void handleSave()}
                className="bg-[#2563EB] hover:bg-[#1D4ED8]"
              >
                Save
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
