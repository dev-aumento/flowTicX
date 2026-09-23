import { Link, useNavigate, useParams } from "react-router";
import { FileText, Loader2 } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { InvoiceDetailView } from "@/components/invoices/InvoiceDetailView";
import { formatMoney, formatOutstandingByCurrency, invoiceBalanceDue, invoiceStatusBadgeClass, invoiceStatusLabel, invoiceTotal, isInvoiceOutstanding, type InvoiceRecord } from "@/lib/invoice-store";
import { formatWorkZoneDate } from "@/lib/timezone";
import { cn } from "@/lib/utils";

function formatInvoiceDate(value: string) {
  if (!value) return "—";
  return formatWorkZoneDate(`${value}T12:00:00`, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function ClientInvoices() {
  const navigate = useNavigate();
  const params = useParams<{ invoiceId?: string }>();
  const invoiceId =
    params.invoiceId && /^\d+$/.test(params.invoiceId) ? Number(params.invoiceId) : null;

  const { data: invoices = [], isLoading } = trpc.invoice.list.useQuery(undefined, {
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
  });
  const { data: selected, isLoading: detailLoading } = trpc.invoice.get.useQuery(
    { id: invoiceId ?? 0 },
    { enabled: invoiceId != null, refetchInterval: 10_000, refetchOnWindowFocus: true },
  );

  if (invoiceId != null && (isLoading || detailLoading) && !selected) {
    return <Loader2 className="animate-spin text-gray-400" />;
  }

  if (invoiceId != null && selected) {
    return (
      <InvoiceDetailView
        invoice={selected as InvoiceRecord}
        customer={selected.customer ?? null}
        onBack={() => navigate("/client/invoices")}
        readOnly
      />
    );
  }

  if (invoiceId != null && !isLoading) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-[#6D6E6F]">This invoice is not available in your portal.</p>
        <Link to="/client/invoices" className="text-sm font-medium text-[#F06A6A] hover:text-[#E45C5C]">
          Back to invoices
        </Link>
      </div>
    );
  }

  const outstanding = invoices.filter((invoice) => isInvoiceOutstanding(invoice.status));
  const outstandingTotalLabel = formatOutstandingByCurrency(outstanding);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[28px] font-semibold tracking-tight text-[#1E1F21] dark:text-white">
          Invoices
        </h1>
        <p className="text-sm text-[#6D6E6F] mt-1">
          Invoices billed to you by this workspace. Download or review them here anytime.
        </p>
      </div>

      {outstanding.length > 0 ? (
        <p className="text-sm text-[#3E3F42] dark:text-[#C8C7C5]">
          {outstanding.length} awaiting payment
          {outstandingTotalLabel ? ` · ${outstandingTotalLabel}` : ""}
        </p>
      ) : null}

      {isLoading ? (
        <Loader2 className="animate-spin text-gray-400" />
      ) : invoices.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-white py-14 text-center dark:border-[#30363d] dark:bg-[#161b22]">
          <FileText size={28} className="mx-auto text-gray-300 mb-2" />
          <p className="font-semibold text-[#1F2937] dark:text-white">No invoices yet</p>
          <p className="text-sm text-gray-500 mt-1 max-w-md mx-auto">
            When this workspace creates an invoice for you, it will show up here.
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden dark:border-[#30363d] dark:bg-[#161b22]">
          {invoices.map((invoice) => {
            const total = invoiceTotal(invoice);
            const remaining = invoiceBalanceDue(invoice);
            return (
              <Link
                key={invoice.id}
                to={`/client/invoices/${invoice.id}`}
                className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 last:border-0 hover:bg-gray-50 dark:border-white/5 dark:hover:bg-white/5"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-[#1F2937] dark:text-white truncate">
                    {invoice.invoiceNumber}
                  </p>
                  <p className="text-xs text-gray-400 truncate">
                    {formatInvoiceDate(invoice.invoiceDate)}
                    {invoice.dueDate ? ` · Due ${formatInvoiceDate(invoice.dueDate)}` : ""}
                    {invoice.status === "partial"
                      ? ` · Remaining ${formatMoney(remaining, invoice.currency)}`
                      : ""}
                  </p>
                </div>
                <span className="text-sm font-semibold text-[#1E1F21] dark:text-white shrink-0">
                  {formatMoney(invoice.status === "paid" ? total : remaining, invoice.currency)}
                </span>
                <span
                  className={cn(
                    "text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0",
                    invoiceStatusBadgeClass(invoice.status),
                  )}
                >
                  {invoiceStatusLabel(invoice.status)}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
