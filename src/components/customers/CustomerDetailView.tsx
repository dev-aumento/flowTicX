import { ArrowLeft, Mail, Phone, MapPin, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CustomerRecord } from "@/components/customers/NewCustomerForm";

type CustomerDetailViewProps = {
  customer: CustomerRecord;
  onBack: () => void;
  onEdit: () => void;
  onDelete?: () => void;
  deleting?: boolean;
};

function DetailRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <div className="text-xs text-gray-400 uppercase tracking-wide">{label}</div>
      <div className="text-sm font-medium text-[#1F2937] mt-1 break-words">
        {value?.trim() ? value : "—"}
      </div>
    </div>
  );
}

function formatAddress(customer: CustomerRecord, type: "billing" | "shipping") {
  const prefix = type === "billing" ? "billing" : "shipping";
  const parts = [
    customer[`${prefix}Address1` as const],
    customer[`${prefix}Address2` as const],
    [customer[`${prefix}City` as const], customer[`${prefix}State` as const]]
      .filter(Boolean)
      .join(", "),
    customer[`${prefix}Zip` as const],
    customer[`${prefix}Country` as const],
  ].filter((part) => part && String(part).trim());
  return parts.length ? parts.join("\n") : "";
}

export function CustomerDetailView({
  customer,
  onBack,
  onEdit,
  onDelete,
  deleting = false,
}: CustomerDetailViewProps) {
  const primaryName = [customer.salutation, customer.firstName, customer.lastName]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-[#2563EB] hover:text-[#1D4ED8] mb-2"
          >
            <ArrowLeft size={14} />
            Back to clients
          </button>
          <h1 className="text-2xl font-bold text-[#1F2937]">{customer.displayName}</h1>
          <p className="text-sm text-gray-500 mt-0.5 capitalize">
            {customer.customerType}
            {customer.companyName ? ` · ${customer.companyName}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            onClick={onEdit}
            className="bg-[#2563EB] hover:bg-[#1D4ED8] text-white gap-2"
          >
            <Pencil size={14} />
            Edit
          </Button>
          {onDelete ? (
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

      <div className="bg-white border border-gray-200 rounded-xl p-5 sm:p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        <DetailRow label="Primary Contact" value={primaryName} />
        <DetailRow label="Email" value={customer.email} />
        <DetailRow label="Work Phone" value={customer.workPhone} />
        <DetailRow label="Mobile" value={customer.mobile} />
        <DetailRow label="Currency" value={customer.currency} />
        <DetailRow
          label="Hourly Rate"
          value={
            Number(customer.hourlyRate) > 0
              ? `${customer.currency || "INR"} ${Number(customer.hourlyRate).toFixed(2)}`
              : "—"
          }
        />
        <DetailRow
          label="GST Treatment"
          value={
            (
              {
                registered_business: "Registered Business - Regular",
                registered_composition: "Registered Business - Composition",
                unregistered_business: "Unregistered Business",
                consumer: "Consumer",
                overseas: "Overseas",
                sez: "Special Economic Zone",
                deemed_export: "Deemed Export",
              } as Record<string, string>
            )[customer.gstTreatment || ""] ||
            customer.gstTreatment ||
            "—"
          }
        />
        <DetailRow label="GSTIN / UIN" value={customer.gstNumber} />
        <DetailRow label="Business Legal Name" value={customer.businessLegalName} />
        <DetailRow label="Business Trade Name" value={customer.businessTradeName} />
        <DetailRow label="Place of Supply" value={customer.placeOfSupply} />
        <DetailRow label="PAN" value={customer.pan} />
        <DetailRow
          label="Tax Preference"
          value={customer.taxPreference === "tax_exempt" ? "Tax Exempt" : "Taxable"}
        />
        <DetailRow label="Payment Terms" value={customer.paymentTerms} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-[#1F2937] mb-3">
            <MapPin size={16} className="text-[#2563EB]" />
            Billing Address
          </div>
          <p className="text-sm text-gray-700 whitespace-pre-wrap">
            {formatAddress(customer, "billing") || "—"}
          </p>
          {customer.billingPhone ? (
            <p className="text-sm text-gray-500 mt-2 flex items-center gap-1.5">
              <Phone size={14} />
              {customer.billingPhone}
            </p>
          ) : null}
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-[#1F2937] mb-3">
            <MapPin size={16} className="text-[#2563EB]" />
            Shipping Address
          </div>
          <p className="text-sm text-gray-700 whitespace-pre-wrap">
            {formatAddress(customer, "shipping") || "—"}
          </p>
          {customer.shippingPhone ? (
            <p className="text-sm text-gray-500 mt-2 flex items-center gap-1.5">
              <Phone size={14} />
              {customer.shippingPhone}
            </p>
          ) : null}
        </div>
      </div>

      {(customer.email || customer.mobile || customer.workPhone) && (
        <div className="bg-white border border-gray-200 rounded-xl p-5 flex flex-wrap gap-4 text-sm text-gray-600">
          {customer.email ? (
            <span className="inline-flex items-center gap-1.5">
              <Mail size={14} className="text-gray-400" />
              {customer.email}
            </span>
          ) : null}
          {customer.mobile || customer.workPhone ? (
            <span className="inline-flex items-center gap-1.5">
              <Phone size={14} className="text-gray-400" />
              {customer.mobile || customer.workPhone}
            </span>
          ) : null}
        </div>
      )}

      {customer.remarks ? (
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <div className="text-xs text-gray-400 uppercase tracking-wide mb-2">Remarks</div>
          <p className="text-sm text-gray-700 whitespace-pre-wrap">{customer.remarks}</p>
        </div>
      ) : null}
    </div>
  );
}
