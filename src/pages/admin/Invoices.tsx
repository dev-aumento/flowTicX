import { useEffect, useState } from "react";
import { useNavigate, useParams, useLocation, Navigate } from "react-router";
import { motion } from "framer-motion";
import { FileText, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NewInvoiceForm } from "@/components/invoices/NewInvoiceForm";
import { InvoiceDetailView } from "@/components/invoices/InvoiceDetailView";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { hasPermission } from "@/lib/permissions";
import {
  clearLegacyInvoices,
  formatMoney,
  hasMigratedLegacyInvoices,
  invoiceBalanceDue,
  invoiceStatusLabel,
  invoiceTotal,
  loadLegacyInvoices,
  markLegacyInvoicesMigrated,
  type InvoiceFormValues,
  type InvoiceRecord,
} from "@/lib/invoice-store";
import type { CustomerRecord } from "@/components/customers/NewCustomerForm";
import {
  clearLegacyCustomers,
  hasMigratedLegacyCustomers,
  loadLegacyCustomers,
  markLegacyCustomersMigrated,
} from "@/lib/customer-store";

function formatDate(value: string) {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function AdminInvoices() {
  const { user } = useAuth();
  const canManageInvoices = hasPermission(user, "invoices.manage");
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams<{ invoiceId?: string }>();
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const isCreate = /\/admin\/invoices\/new\/?$/.test(location.pathname);
  const isEdit = /\/admin\/invoices\/\d+\/edit\/?$/.test(location.pathname);
  const invoiceId =
    params.invoiceId && /^\d+$/.test(params.invoiceId) ? Number(params.invoiceId) : null;
  const isDetail = invoiceId != null && !isEdit && !isCreate;

  const utils = trpc.useUtils();
  const { data: invoices = [], isLoading } = trpc.invoice.list.useQuery();
  const { data: customers = [] } = trpc.customer.list.useQuery();
  const importCustomers = trpc.customer.importLegacy.useMutation();
  const importInvoices = trpc.invoice.importLegacy.useMutation();
  const createMutation = trpc.invoice.create.useMutation();
  const updateMutation = trpc.invoice.update.useMutation();
  const deleteMutation = trpc.invoice.delete.useMutation();

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        let customerIdMap: Record<string, number> = {};

        if (!hasMigratedLegacyCustomers()) {
          const legacyCustomers = loadLegacyCustomers();
          if (legacyCustomers.length > 0) {
            const result = await importCustomers.mutateAsync({
              customers: legacyCustomers.map((c) => {
                const { id, createdAt, ...rest } = c;
                return {
                  ...rest,
                  legacyId: String(id),
                  createdAt: typeof createdAt === "string" ? createdAt : undefined,
                  contactPersons: Array.isArray(rest.contactPersons) ? rest.contactPersons : [],
                };
              }),
            });
            customerIdMap = result.idMap ?? {};
            if (cancelled) return;
            clearLegacyCustomers();
            await utils.customer.list.invalidate();
          }
          markLegacyCustomersMigrated();
        }

        if (hasMigratedLegacyInvoices()) return;

        const legacyInvoices = loadLegacyInvoices();
        if (legacyInvoices.length === 0) {
          markLegacyInvoicesMigrated();
          return;
        }

        if (Object.keys(customerIdMap).length === 0) {
          const serverCustomers = await utils.customer.list.fetch();
          for (const inv of legacyInvoices) {
            const match = serverCustomers.find((c) => c.displayName === inv.customerName);
            if (match) customerIdMap[String(inv.customerId)] = match.id;
          }
        }

        await importInvoices.mutateAsync({
          invoices: legacyInvoices
            .map((inv) => {
              const { id, createdAt, customerId, ...rest } = inv;
              const mappedId =
                customerIdMap[String(customerId)] ??
                (typeof customerId === "number" ? customerId : Number.NaN);
              if (!Number.isFinite(mappedId)) return null;
              return {
                ...rest,
                customerId: mappedId,
                legacyId: String(id),
                legacyCustomerId: customerId,
                createdAt: typeof createdAt === "string" ? createdAt : undefined,
                items: Array.isArray(rest.items) ? rest.items : [],
              };
            })
            .filter((inv): inv is NonNullable<typeof inv> => inv != null),
        });
        if (cancelled) return;
        clearLegacyInvoices();
        markLegacyInvoicesMigrated();
        await utils.invoice.list.invalidate();
      } catch {
        // Keep legacy data so retry is possible on next visit.
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedInvoice =
    invoiceId != null ? invoices.find((inv) => inv.id === invoiceId) ?? null : null;

  async function handleSave(values: InvoiceFormValues) {
    setSaveError(null);
    try {
      const { id: _id, ...payload } = values;
      const saved =
        isEdit && invoiceId != null
          ? await updateMutation.mutateAsync({ id: invoiceId, ...payload })
          : await createMutation.mutateAsync(payload);
      await utils.invoice.list.invalidate();
      await utils.invoice.get.invalidate();
      navigate(`/admin/invoices/${saved.id}`, { replace: true });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save invoice");
    }
  }

  async function handleDelete() {
    if (!selectedInvoice) return;
    const ok = window.confirm(
      `Delete invoice "${selectedInvoice.invoiceNumber}"? This cannot be undone.`,
    );
    if (!ok) return;
    setDeleteError(null);
    try {
      await deleteMutation.mutateAsync({ id: selectedInvoice.id });
      await utils.invoice.list.invalidate();
      navigate("/admin/invoices", { replace: true });
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Failed to delete invoice");
    }
  }

  if (isCreate) {
    if (!canManageInvoices) {
      return <Navigate to="/admin/invoices" replace />;
    }
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        {saveError ? <p className="mb-3 text-sm text-red-600">{saveError}</p> : null}
        <NewInvoiceForm
          key={`invoice-create-${location.key}`}
          initialInvoice={undefined}
          customers={customers as CustomerRecord[]}
          existingInvoices={invoices}
          onCancel={() => navigate("/admin/invoices")}
          onSave={handleSave}
          saving={createMutation.isPending || updateMutation.isPending}
        />
      </motion.div>
    );
  }

  if (isEdit) {
    if (!canManageInvoices) {
      return <Navigate to="/admin/invoices" replace />;
    }
    if (isLoading) {
      return (
        <div className="bg-white border border-gray-200 rounded-xl px-6 py-16 flex items-center justify-center gap-2 text-gray-500">
          <Loader2 size={18} className="animate-spin" />
          Loading invoice…
        </div>
      );
    }
    if (!selectedInvoice) {
      return (
        <div className="bg-white border border-gray-200 rounded-xl px-6 py-16 text-center">
          <p className="text-sm text-gray-600 mb-4">Invoice not found.</p>
          <Button type="button" variant="outline" onClick={() => navigate("/admin/invoices")}>
            Back to invoices
          </Button>
        </div>
      );
    }
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        {saveError ? <p className="mb-3 text-sm text-red-600">{saveError}</p> : null}
        <NewInvoiceForm
          key={`invoice-edit-${selectedInvoice.id}`}
          initialInvoice={selectedInvoice as InvoiceRecord}
          customers={customers as CustomerRecord[]}
          existingInvoices={invoices}
          onCancel={() => navigate(`/admin/invoices/${selectedInvoice.id}`)}
          onSave={handleSave}
          saving={createMutation.isPending || updateMutation.isPending}
        />
      </motion.div>
    );
  }

  if (isDetail) {
    if (isLoading) {
      return (
        <div className="bg-white border border-gray-200 rounded-xl px-6 py-16 flex items-center justify-center gap-2 text-gray-500">
          <Loader2 size={18} className="animate-spin" />
          Loading invoice…
        </div>
      );
    }
    if (!selectedInvoice) {
      return (
        <div className="bg-white border border-gray-200 rounded-xl px-6 py-16 text-center">
          <p className="text-sm text-gray-600 mb-4">Invoice not found.</p>
          <Button type="button" variant="outline" onClick={() => navigate("/admin/invoices")}>
            Back to invoices
          </Button>
        </div>
      );
    }
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        {deleteError ? <p className="mb-3 text-sm text-red-600">{deleteError}</p> : null}
        <InvoiceDetailView
          invoice={selectedInvoice as InvoiceRecord}
          customer={
            (customers.find((c) => c.id === selectedInvoice.customerId) as
              | CustomerRecord
              | undefined) ?? null
          }
          onBack={() => {
            setDeleteError(null);
            navigate("/admin/invoices");
          }}
          onEdit={
            canManageInvoices
              ? () => navigate(`/admin/invoices/${selectedInvoice.id}/edit`)
              : undefined
          }
          onDelete={canManageInvoices ? handleDelete : undefined}
          deleting={deleteMutation.isPending}
        />
      </motion.div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#1F2937]">Invoice</h1>
          <p className="text-sm text-gray-500 mt-0.5">Create and manage invoices</p>
        </div>
        {canManageInvoices ? (
          <Button
            type="button"
            onClick={() => {
              setSaveError(null);
              navigate("/admin/invoices/new");
            }}
            className="bg-[#2563EB] hover:bg-[#1D4ED8] text-white gap-2"
          >
            <Plus size={16} />
            Create New Invoice
          </Button>
        ) : null}
      </div>

      {isLoading ? (
        <div className="bg-white border border-gray-200 rounded-xl px-6 py-16 flex items-center justify-center gap-2 text-gray-500">
          <Loader2 size={18} className="animate-spin" />
          Loading invoices…
        </div>
      ) : invoices.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl px-6 py-16 text-center">
          <FileText size={36} className="mx-auto text-gray-300 mb-3" />
          <p className="text-sm font-medium text-gray-600">No invoices yet</p>
          <p className="text-xs text-gray-400 mt-1 mb-4">
            Create your first invoice to get started
          </p>
          {canManageInvoices ? (
            <Button
              type="button"
              onClick={() => navigate("/admin/invoices/new")}
              className="bg-[#2563EB] hover:bg-[#1D4ED8] text-white gap-2"
            >
              <Plus size={16} />
              Create New Invoice
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="hidden md:grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_110px_120px_100px_110px] gap-3 px-5 py-3 bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wider">
            <span>Invoice #</span>
            <span>Customer</span>
            <span>Date</span>
            <span>Due Date</span>
            <span>Status</span>
            <span className="text-right">Amount</span>
          </div>
          <div className="divide-y divide-gray-100">
            {invoices.map((invoice) => (
              <button
                key={invoice.id}
                type="button"
                onClick={() => navigate(`/admin/invoices/${invoice.id}`)}
                className="w-full text-left grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_110px_120px_100px_110px] gap-2 md:gap-3 px-5 py-4 hover:bg-gray-50/80 transition-colors"
              >
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-[#2563EB] truncate dark:text-white">
                    {invoice.invoiceNumber}
                  </div>
                  <div className="md:hidden text-xs text-gray-500 mt-0.5 truncate">
                    {invoice.customerName}
                  </div>
                </div>
                <div className="hidden md:block text-sm text-gray-700 truncate">
                  {invoice.customerName}
                </div>
                <div className="text-sm text-gray-600">{formatDate(invoice.invoiceDate)}</div>
                <div className="text-sm text-gray-600">{formatDate(invoice.dueDate)}</div>
                <div>
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
                      invoice.status === "paid"
                        ? "bg-blue-50 text-blue-700"
                        : invoice.status === "partial"
                          ? "bg-orange-50 text-orange-700"
                          : invoice.status === "sent"
                            ? "bg-emerald-50 text-emerald-700"
                            : invoice.status === "pending"
                              ? "bg-amber-50 text-amber-700"
                              : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {invoiceStatusLabel(invoice.status)}
                  </span>
                </div>
                <div className="text-sm font-semibold text-gray-800 md:text-right">
                  <div>{formatMoney(invoiceTotal(invoice), invoice.currency || "INR")}</div>
                  {invoice.status === "partial" ? (
                    <div className="text-xs font-medium text-orange-700 md:text-right">
                      Due {formatMoney(invoiceBalanceDue(invoice), invoice.currency || "INR")}
                    </div>
                  ) : null}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}
