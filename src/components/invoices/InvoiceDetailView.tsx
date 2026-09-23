import { useMemo, useState } from "react";
import { ArrowLeft, Pencil, Download, ChevronDown, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  displayHsnSac,
  formatMoney,
  invoiceBalanceDue,
  invoicePaidAmount,
  invoiceStatusBadgeClass,
  invoiceStatusLabel,
  invoiceSubTotal,
  invoiceTotal,
  lineAmount,
  type InvoiceRecord,
} from "@/lib/invoice-store";
import {
  downloadInvoiceAsPdf,
  downloadInvoicePreviewAsPdf,
  printInvoice,
  type InvoiceCustomerLike,
} from "@/lib/invoice-download";
import { InvoicePdfPreview } from "@/components/invoices/InvoicePdfPreview";
import { useOrganizationBillingProfile } from "@/hooks/useOrganizationBillingProfile";

const TERMS_LABEL: Record<string, string> = {
  due_on_receipt: "Due on Receipt",
  net_15: "Net 15",
  net_30: "Net 30",
  net_45: "Net 45",
  net_60: "Net 60",
};

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

type InvoiceDetailViewProps = {
  invoice: InvoiceRecord;
  customer?: InvoiceCustomerLike | null;
  onBack: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  deleting?: boolean;
  /** Client portal: view + PDF download only, no edits. */
  readOnly?: boolean;
};

export function InvoiceDetailView({
  invoice,
  customer = null,
  onBack,
  onEdit,
  onDelete,
  deleting = false,
  readOnly = false,
}: InvoiceDetailViewProps) {
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const { profile: organization } = useOrganizationBillingProfile();
  const subTotal = invoiceSubTotal(invoice.items);
  const total = invoiceTotal(invoice);
  const paidAmount = invoicePaidAmount(invoice);
  const balanceDue = invoiceBalanceDue(invoice);
  const currency = invoice.currency || "INR";
  const exportOptions = useMemo(
    () => ({ customer, useCurrentDate: true, organization }),
    [customer, organization],
  );
  const canEdit = Boolean(onEdit) && !readOnly;
  const canDelete = Boolean(onDelete) && !readOnly;

  async function handleDownloadPdf() {
    setDownloading(true);
    try {
      if (readOnly) {
        await downloadInvoicePreviewAsPdf(invoice, exportOptions);
      } else {
        await downloadInvoiceAsPdf(invoice, exportOptions);
      }
    } finally {
      setDownloading(false);
      setDownloadOpen(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-[#2563EB] hover:text-[#1D4ED8] mb-2"
          >
            <ArrowLeft size={14} />
            Back to invoices
          </button>
          <h1 className="text-2xl font-bold text-[#1F2937]">{invoice.invoiceNumber}</h1>
          <div className="flex flex-wrap items-center gap-2 mt-1.5">
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                invoiceStatusBadgeClass(invoice.status)
              }`}
            >
              {invoiceStatusLabel(invoice.status)}
            </span>
            <p className="text-sm text-gray-500">
              {invoice.customerName} · {currency}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canEdit && onEdit ? (
            <Button
              type="button"
              onClick={onEdit}
              className="bg-[#2563EB] hover:bg-[#1D4ED8] text-white gap-2"
            >
              <Pencil size={14} />
              Edit
            </Button>
          ) : null}
          {readOnly ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => void handleDownloadPdf()}
              disabled={downloading}
              className="border-gray-200 text-gray-700 gap-2"
            >
              <Download size={14} />
              {downloading ? "Downloading…" : "Download PDF"}
            </Button>
          ) : (
            <Popover open={downloadOpen} onOpenChange={setDownloadOpen} modal={false}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className="border-gray-200 text-gray-700 gap-2"
                >
                  <Download size={14} />
                  Download
                  <ChevronDown size={14} />
                </Button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                sideOffset={8}
                className="w-52 p-0 rounded-xl border border-gray-200 bg-white shadow-lg overflow-hidden dark:border-[#3d4a5f] dark:bg-[#151c2c]"
              >
                <button
                  type="button"
                  onClick={() => void handleDownloadPdf()}
                  className="w-full px-4 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-50 dark:text-white dark:hover:bg-white/5"
                >
                  Download PDF
                </button>
                <button
                  type="button"
                  onClick={() => {
                    printInvoice(invoice, exportOptions);
                    setDownloadOpen(false);
                  }}
                  className="w-full px-4 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-50 dark:text-white dark:hover:bg-white/5"
                >
                  Print
                </button>
              </PopoverContent>
            </Popover>
          )}
          {canDelete && onDelete ? (
            <Button
              type="button"
              variant="outline"
              onClick={onDelete}
              disabled={deleting}
              className="border-red-200 text-red-600 hover:bg-red-50 gap-2"
            >
              <Trash2 size={14} />
              {deleting ? "Deleting…" : "Delete"}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            onClick={onBack}
            className="border-gray-200 text-gray-700"
          >
            Close
          </Button>
        </div>
      </div>

      {readOnly ? (
        <>
          <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <div className="text-xs text-gray-400">Payment status</div>
              <div className="mt-1.5">
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                    invoiceStatusBadgeClass(invoice.status)
                  }`}
                >
                  {invoiceStatusLabel(invoice.status)}
                </span>
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-400">Amount paid</div>
              <div className="mt-1 text-sm font-semibold text-[#1F2937]">
                {formatMoney(paidAmount, currency)}
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-400">Balance due</div>
              <div className="mt-1 text-sm font-semibold text-[#1F2937]">
                {formatMoney(balanceDue, currency)}
              </div>
            </div>
          </div>
          <InvoicePdfPreview
            invoice={invoice}
            customer={customer}
            useCurrentDate
            title="Invoice"
            className="min-h-[70vh]"
          />
        </>
      ) : (
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 items-start min-w-0">
        <div className="space-y-5 min-w-0">
          <div className="bg-white border border-gray-200 rounded-xl p-5 sm:p-6 grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-xs text-gray-400 uppercase tracking-wide">Customer</div>
              <div className="font-semibold text-[#1F2937] mt-1">{invoice.customerName}</div>
            </div>
            <div>
              <div className="text-xs text-gray-400 uppercase tracking-wide">Invoice Date</div>
              <div className="font-medium text-[#1F2937] mt-1">
                {formatDate(invoice.invoiceDate)}
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-400 uppercase tracking-wide">Period</div>
              <div className="font-medium text-[#1F2937] mt-1">
                {invoice.periodStart || invoice.periodEnd
                  ? `${formatDate(invoice.periodStart || "")} – ${formatDate(invoice.periodEnd || "")}`
                  : "—"}
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-400 uppercase tracking-wide">Payment status</div>
              <div className="mt-1">
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                    invoiceStatusBadgeClass(invoice.status)
                  }`}
                >
                  {invoiceStatusLabel(invoice.status)}
                </span>
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-400 uppercase tracking-wide">Due Date</div>
              <div className="font-medium text-[#1F2937] mt-1">{formatDate(invoice.dueDate)}</div>
            </div>
            <div>
              <div className="text-xs text-gray-400 uppercase tracking-wide">Terms</div>
              <div className="font-medium text-[#1F2937] mt-1">
                {TERMS_LABEL[invoice.terms] || invoice.terms || "—"}
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-400 uppercase tracking-wide">Order Number</div>
              <div className="font-medium text-[#1F2937] mt-1">{invoice.orderNumber || "—"}</div>
            </div>
            <div>
              <div className="text-xs text-gray-400 uppercase tracking-wide">Salesperson</div>
              <div className="font-medium text-[#1F2937] mt-1">{invoice.salesperson || "—"}</div>
            </div>
            <div>
              <div className="text-xs text-gray-400 uppercase tracking-wide">HSN/SAC</div>
              <div className="font-medium text-[#1F2937] mt-1">{displayHsnSac(invoice.hsnSac)}</div>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <div className="min-w-[560px]">
                <div className="grid grid-cols-[minmax(140px,2fr)_70px_90px_80px_100px] gap-2 px-4 py-3 bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  <span>Item</span>
                  <span>Qty</span>
                  <span>Rate</span>
                  <span>Discount</span>
                  <span>Amount</span>
                </div>
                <div className="divide-y divide-gray-100">
                  {invoice.items.map((item) => (
                    <div
                      key={item.id}
                      className="grid grid-cols-[minmax(140px,2fr)_70px_90px_80px_100px] gap-2 px-4 py-3 text-sm items-center"
                    >
                      <span className="text-[#1F2937] font-medium">{item.itemDetails}</span>
                      <span className="text-gray-600">{item.quantity}</span>
                      <span className="text-gray-600">{formatMoney(item.rate, currency)}</span>
                      <span className="text-gray-600">{item.discountPercent}%</span>
                      <span className="font-semibold text-[#1F2937]">
                        {formatMoney(lineAmount(item), currency)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-white border border-gray-200 rounded-xl p-5">
              <div className="text-xs text-gray-400 uppercase tracking-wide mb-2">
                Customer Notes
              </div>
              <p className="text-sm text-gray-700 whitespace-pre-wrap">
                {invoice.customerNotes || "—"}
              </p>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">Sub Total</span>
                <span className="font-semibold">{formatMoney(subTotal, currency)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Shipping</span>
                <span className="font-medium">{formatMoney(invoice.shippingCharges, currency)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">
                  {invoice.taxMode === "none"
                    ? invoice.taxPercent > 0
                      ? `IGST (${invoice.taxPercent}%)`
                      : "Tax"
                    : `${invoice.taxMode.toUpperCase()} (${invoice.taxPercent}%)`}
                </span>
                <span className="font-medium">
                  {invoice.taxPercent > 0
                    ? `${invoice.taxMode === "tds" ? "-" : ""}${formatMoney((subTotal * invoice.taxPercent) / 100, currency)}`
                    : "—"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Adjustment</span>
                <span className="font-medium">{formatMoney(invoice.adjustment, currency)}</span>
              </div>
              <div className="pt-3 border-t border-gray-100 flex justify-between items-center">
                <span className="text-base font-semibold text-[#1F2937]">Total ({currency})</span>
                <span className="text-xl font-bold text-[#1F2937]">{formatMoney(total, currency)}</span>
              </div>
              {paidAmount > 0 ? (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-700 font-medium">Payment Made</span>
                  <span className="font-medium text-red-600">
                    (-) {formatMoney(paidAmount, currency)}
                  </span>
                </div>
              ) : null}
              <div className="flex justify-between items-center">
                <span className="text-base font-bold text-[#1F2937]">Balance Due</span>
                <span className="text-base font-bold text-[#1F2937]">
                  {formatMoney(balanceDue, currency)}
                </span>
              </div>
            </div>
          </div>
        </div>

        <InvoicePdfPreview
          invoice={invoice}
          customer={customer}
          useCurrentDate
          className="xl:sticky xl:top-4 xl:max-h-[calc(100vh-6rem)]"
        />
      </div>
      )}
    </div>
  );
}
