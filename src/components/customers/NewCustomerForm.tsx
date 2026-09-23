import { useMemo, useState, type ReactNode } from "react";
import {
  Mail,
  Phone,
  Smartphone,
  Upload,
  Info,
  ChevronRight,
  Plus,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { WORLD_COUNTRIES } from "@/lib/world-countries";
import { getStatesForCountry } from "@/lib/country-states";
import {
  GSTIN_ERROR,
  GSTIN_EXAMPLE,
  PAN_ERROR,
  PAN_EXAMPLE,
  PAN_GSTIN_MISMATCH_ERROR,
  gstinPanMismatch,
  isValidGstinOrUin,
  isValidPan,
  sanitizeIndianTaxIdInput,
} from "@contracts/indian-tax-ids";

export type CustomerType = "business" | "individual";
export type TaxPreference = "taxable" | "tax_exempt";
export type GstTreatment =
  | "registered_business"
  | "registered_composition"
  | "unregistered_business"
  | "consumer"
  | "overseas"
  | "sez"
  | "deemed_export";

export type CustomerRecord = {
  id: number;
  customerType: CustomerType;
  salutation: string;
  firstName: string;
  lastName: string;
  companyName: string;
  displayName: string;
  currency: string;
  hourlyRate: number;
  email: string;
  workPhone: string;
  mobile: string;
  gstTreatment: GstTreatment;
  gstNumber: string;
  businessLegalName: string;
  businessTradeName: string;
  placeOfSupply: string;
  pan: string;
  taxPreference: TaxPreference;
  paymentTerms: string;
  billingCountry: string;
  billingAddress1: string;
  billingAddress2: string;
  billingCity: string;
  billingState: string;
  billingZip: string;
  billingPhone: string;
  shippingCountry: string;
  shippingAddress1: string;
  shippingAddress2: string;
  shippingCity: string;
  shippingState: string;
  shippingZip: string;
  shippingPhone: string;
  contactPersons: Array<{
    salutation: string;
    firstName: string;
    lastName: string;
    email: string;
    workPhone: string;
    mobile: string;
  }>;
  customFieldLabel: string;
  customFieldValue: string;
  remarks: string;
  createdAt: string;
  status?: "active" | "inactive";
  sourceUserId?: number | null;
  sourceOrganizationId?: number | null;
};

const emptyContactPerson = () => ({
  salutation: "",
  firstName: "",
  lastName: "",
  email: "",
  workPhone: "",
  mobile: "",
});

function createEmptyForm(): Omit<CustomerRecord, "id" | "createdAt"> {
  return {
    customerType: "individual",
    salutation: "",
    firstName: "",
    lastName: "",
    companyName: "",
    displayName: "",
    currency: "INR",
    hourlyRate: 0,
    email: "",
    workPhone: "",
    mobile: "",
    gstTreatment: "registered_business",
    gstNumber: "",
    businessLegalName: "",
    businessTradeName: "",
    placeOfSupply: "",
    pan: "",
    taxPreference: "taxable",
    paymentTerms: "due_on_receipt",
    billingCountry: "India",
    billingAddress1: "",
    billingAddress2: "",
    billingCity: "",
    billingState: "",
    billingZip: "",
    billingPhone: "",
    shippingCountry: "India",
    shippingAddress1: "",
    shippingAddress2: "",
    shippingCity: "",
    shippingState: "",
    shippingZip: "",
    shippingPhone: "",
    contactPersons: [],
    customFieldLabel: "",
    customFieldValue: "",
    remarks: "",
  };
}

const GST_TREATMENTS: Array<{ value: GstTreatment; label: string }> = [
  { value: "registered_business", label: "Registered Business - Regular" },
  { value: "registered_composition", label: "Registered Business - Composition" },
  { value: "unregistered_business", label: "Unregistered Business" },
  { value: "consumer", label: "Consumer" },
  { value: "overseas", label: "Overseas" },
  { value: "sez", label: "Special Economic Zone" },
  { value: "deemed_export", label: "Deemed Export" },
];

/** Zoho-style field visibility based on GST Treatment. */
function gstVisibility(treatment: GstTreatment) {
  const showGstinBlock = (
    [
      "registered_business",
      "registered_composition",
      "sez",
      "deemed_export",
    ] as GstTreatment[]
  ).includes(treatment);

  return {
    showGstin: showGstinBlock,
    gstinRequired: showGstinBlock,
    showBusinessNames: showGstinBlock,
    showPlaceOfSupply: treatment !== "overseas",
    placeOfSupplyRequired: treatment !== "overseas",
    showPan: treatment !== "overseas",
  };
}

function normalizeGstTreatment(value: unknown, hasGstin: boolean): GstTreatment {
  const allowed = GST_TREATMENTS.map((t) => t.value);
  if (typeof value === "string" && (allowed as string[]).includes(value)) {
    return value as GstTreatment;
  }
  return hasGstin ? "registered_business" : "unregistered_business";
}

const SALUTATIONS = ["Mr.", "Mrs.", "Ms.", "Miss", "Dr."];
const CURRENCIES = [
  { value: "INR", label: "INR — Indian Rupee" },
  { value: "USD", label: "USD — US Dollar" },
  { value: "EUR", label: "EUR — Euro" },
  { value: "GBP", label: "GBP — British Pound" },
  { value: "AED", label: "AED — UAE Dirham" },
  { value: "AUD", label: "AUD — Australian Dollar" },
  { value: "CAD", label: "CAD — Canadian Dollar" },
  { value: "SGD", label: "SGD — Singapore Dollar" },
  { value: "JPY", label: "JPY — Japanese Yen" },
  { value: "CHF", label: "CHF — Swiss Franc" },
  { value: "NZD", label: "NZD — New Zealand Dollar" },
  { value: "SAR", label: "SAR — Saudi Riyal" },
  { value: "QAR", label: "QAR — Qatari Riyal" },
  { value: "HKD", label: "HKD — Hong Kong Dollar" },
];
const PAYMENT_TERMS = [
  { value: "due_on_receipt", label: "Due on Receipt" },
  { value: "due_end_of_month", label: "Due end of the month" },
  { value: "due_end_of_next_month", label: "Due end of next month" },
  { value: "net_15", label: "Net 15" },
  { value: "net_30", label: "Net 30" },
  { value: "net_45", label: "Net 45" },
  { value: "net_60", label: "Net 60" },
];
const DETAIL_TABS = [
  { id: "other", label: "Other Details" },
  { id: "address", label: "Address" },
  { id: "contacts", label: "Contact Persons" },
  { id: "custom", label: "Custom Fields" },
  { id: "remarks", label: "Remarks" },
] as const;

type DetailTab = (typeof DETAIL_TABS)[number]["id"];

const fieldClass =
  "h-10 rounded-lg border border-gray-200 bg-white text-sm text-[#1F2937] focus-visible:border-[#2563EB] focus-visible:ring-[#2563EB]/30";
const selectClass = cn(
  fieldClass,
  "w-full px-3 outline-none appearance-auto focus:border-[#2563EB] focus:ring-[3px] focus:ring-[#2563EB]/30",
);

function FieldRow({
  label,
  required,
  hint,
  children,
  align = "center",
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: ReactNode;
  align?: "center" | "start";
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-2 sm:grid-cols-[180px_minmax(0,1fr)] sm:gap-5",
        align === "start" ? "sm:items-start" : "sm:items-center",
      )}
    >
      <div className={cn("flex items-center gap-1.5", align === "start" && "sm:pt-2.5")}>
        <Label
          className={cn(
            "text-sm font-medium text-gray-600",
          )}
        >
          {label}
          {required ? " *" : ""}
        </Label>
        {hint ? (
          <span title={hint} className="text-gray-400 cursor-help">
            <Info size={14} />
          </span>
        ) : null}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export type CustomerFormValues = Omit<CustomerRecord, "id" | "createdAt">;

type NewCustomerFormProps = {
  onCancel: () => void;
  onSave: (customer: CustomerFormValues) => void | Promise<void>;
  initialCustomer?: CustomerRecord;
  saving?: boolean;
};

export function NewCustomerForm({
  onCancel,
  onSave,
  initialCustomer,
  saving = false,
}: NewCustomerFormProps) {
  const isEditing = Boolean(initialCustomer);
  const [form, setForm] = useState(() => {
    if (!initialCustomer) return createEmptyForm();
    const { id: _id, createdAt: _createdAt, ...rest } = initialCustomer;
    return {
      ...createEmptyForm(),
      ...rest,
      gstTreatment: normalizeGstTreatment(
        (rest as { gstTreatment?: unknown }).gstTreatment,
        Boolean(rest.gstNumber?.trim()),
      ),
      businessLegalName:
        (rest as { businessLegalName?: string }).businessLegalName ?? "",
      businessTradeName:
        (rest as { businessTradeName?: string }).businessTradeName ?? "",
      hourlyRate: Math.max(0, Number((rest as { hourlyRate?: number }).hourlyRate) || 0),
    };
  });
  const [activeTab, setActiveTab] = useState<DetailTab>("other");
  const [error, setError] = useState<string | null>(null);
  const [gstFieldError, setGstFieldError] = useState<string | null>(null);
  const [panFieldError, setPanFieldError] = useState<string | null>(null);
  const [showMoreDetails, setShowMoreDetails] = useState(false);

  const visibility = useMemo(
    () => gstVisibility(form.gstTreatment),
    [form.gstTreatment],
  );

  const placeOfSupplyCountry = form.billingCountry || form.shippingCountry;
  const placeOfSupplyStates = useMemo(
    () => getStatesForCountry(placeOfSupplyCountry),
    [placeOfSupplyCountry],
  );

  function nextPlaceOfSupply(current: string, country: string) {
    const states = getStatesForCountry(country);
    if (!country) return "";
    if (states.length === 0) return current;
    return states.includes(current) ? current : "";
  }

  const displayNameOptions = useMemo(() => {
    const full = [form.firstName, form.lastName].filter(Boolean).join(" ").trim();
    const options = new Set<string>();
    if (full) options.add(full);
    if (form.companyName.trim()) options.add(form.companyName.trim());
    if (form.firstName.trim() && form.companyName.trim()) {
      options.add(`${form.firstName.trim()} (${form.companyName.trim()})`);
    }
    return [...options];
  }, [form.firstName, form.lastName, form.companyName]);

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setError(null);
    if (key === "gstNumber") setGstFieldError(null);
    if (key === "pan") setPanFieldError(null);
  }

  function handleGstTreatmentChange(next: GstTreatment) {
    const nextVisibility = gstVisibility(next);
    setForm((prev) => ({
      ...prev,
      gstTreatment: next,
      gstNumber: nextVisibility.showGstin ? prev.gstNumber : "",
      businessLegalName: nextVisibility.showBusinessNames ? prev.businessLegalName : "",
      businessTradeName: nextVisibility.showBusinessNames ? prev.businessTradeName : "",
      placeOfSupply: nextVisibility.showPlaceOfSupply ? prev.placeOfSupply : "",
      pan: nextVisibility.showPan ? prev.pan : "",
    }));
    setError(null);
    setGstFieldError(null);
    setPanFieldError(null);
  }

  async function handleSave() {
    if (!form.displayName.trim()) {
      setError("Display Name is required.");
      return;
    }
    if (!form.gstTreatment) {
      setError("GST Treatment is required.");
      setActiveTab("other");
      return;
    }

    const gstNumber = visibility.showGstin
      ? sanitizeIndianTaxIdInput(form.gstNumber, 15)
      : "";
    const pan = visibility.showPan ? sanitizeIndianTaxIdInput(form.pan, 10) : "";

    if (visibility.gstinRequired && !gstNumber) {
      const message = "GSTIN / UIN is required for this GST Treatment.";
      setGstFieldError(message);
      setError(message);
      setActiveTab("other");
      return;
    }
    if (gstNumber && !isValidGstinOrUin(gstNumber)) {
      setGstFieldError(GSTIN_ERROR);
      setError(GSTIN_ERROR);
      setActiveTab("other");
      return;
    }
    if (pan && !isValidPan(pan)) {
      setPanFieldError(PAN_ERROR);
      setError(PAN_ERROR);
      setActiveTab("other");
      return;
    }
    if (gstNumber && pan && gstinPanMismatch(gstNumber, pan)) {
      setPanFieldError(PAN_GSTIN_MISMATCH_ERROR);
      setError(PAN_GSTIN_MISMATCH_ERROR);
      setActiveTab("other");
      return;
    }
    if (visibility.placeOfSupplyRequired && !form.placeOfSupply) {
      setError("Place of Supply is required.");
      setActiveTab("other");
      return;
    }
    await onSave({
      ...form,
      gstNumber,
      businessLegalName: visibility.showBusinessNames ? form.businessLegalName.trim() : "",
      businessTradeName: visibility.showBusinessNames ? form.businessTradeName.trim() : "",
      placeOfSupply: visibility.showPlaceOfSupply ? form.placeOfSupply : "",
      pan,
    });
  }

  function copyBillingToShipping() {
    setForm((prev) => ({
      ...prev,
      shippingCountry: prev.billingCountry,
      shippingAddress1: prev.billingAddress1,
      shippingAddress2: prev.billingAddress2,
      shippingCity: prev.billingCity,
      shippingState: prev.billingState,
      shippingZip: prev.billingZip,
      shippingPhone: prev.billingPhone,
    }));
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#1F2937]">
            {isEditing ? "Edit Customer" : "New Customer"}
          </h1>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          className="border-gray-200 text-gray-600"
        >
          <X size={16} />
          Close
        </Button>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-5 sm:p-6 space-y-5">
        <FieldRow label="Customer Type" hint="Choose Business for companies or Individual for persons">
          <div className="flex flex-wrap items-center gap-5">
            {(
              [
                { value: "business", label: "Business" },
                { value: "individual", label: "Individual" },
              ] as const
            ).map((option) => (
              <label key={option.value} className="inline-flex items-center gap-2 text-sm text-[#1F2937] cursor-pointer">
                <input
                  type="radio"
                  name="customerType"
                  checked={form.customerType === option.value}
                  onChange={() => update("customerType", option.value)}
                  className="size-4 accent-[#2563EB]"
                />
                {option.label}
              </label>
            ))}
          </div>
        </FieldRow>

        <FieldRow label="Primary Contact" hint="Main person associated with this customer">
          <div className="grid grid-cols-1 sm:grid-cols-[110px_1fr_1fr] gap-2">
            <select
              value={form.salutation}
              onChange={(e) => update("salutation", e.target.value)}
              className={selectClass}
            >
              <option value="">Salutation</option>
              {SALUTATIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <Input
              value={form.firstName}
              onChange={(e) => update("firstName", e.target.value)}
              placeholder="First Name"
              className={fieldClass}
            />
            <Input
              value={form.lastName}
              onChange={(e) => update("lastName", e.target.value)}
              placeholder="Last Name"
              className={fieldClass}
            />
          </div>
        </FieldRow>

        <FieldRow label="Company Name">
          <Input
            value={form.companyName}
            onChange={(e) => update("companyName", e.target.value)}
            className={fieldClass}
          />
        </FieldRow>

        <FieldRow
          label="Display Name"
          required
          hint="Name shown on invoices and customer lists"
        >
          <Input
            list="customer-display-names"
            value={form.displayName}
            onChange={(e) => update("displayName", e.target.value)}
            placeholder="Select or type to add"
            className={fieldClass}
          />
          <datalist id="customer-display-names">
            {displayNameOptions.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </FieldRow>

        <FieldRow label="Currency">
          <div>
            <select
              value={form.currency}
              onChange={(e) => update("currency", e.target.value)}
              className={cn(selectClass, "max-w-xs")}
            >
              {CURRENCIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-400 mt-1.5">
              Currency is fixed to Indian Rupee for standard invoicing unless changed here.
            </p>
          </div>
        </FieldRow>

        <FieldRow
          label="Hourly Rate"
          hint="Used on automatic invoices when a project for this client is selected"
        >
          <div className="relative max-w-xs">
            <Input
              type="number"
              min={0}
              step="0.01"
              value={form.hourlyRate}
              onChange={(e) => update("hourlyRate", Number(e.target.value) || 0)}
              placeholder="0.00"
              className={fieldClass}
            />
            <p className="text-xs text-gray-400 mt-1.5">
              Per hour, in {form.currency || "INR"}. Line items stay editable on the invoice.
            </p>
          </div>
        </FieldRow>

        <FieldRow label="Email Address" hint="Primary billing and communication email">
          <div className="relative max-w-xl">
            <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <Input
              type="email"
              value={form.email}
              onChange={(e) => update("email", e.target.value)}
              className={cn(fieldClass, "pl-9")}
            />
          </div>
        </FieldRow>

        <FieldRow label="Phone" hint="Work and mobile contact numbers">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-2xl">
            <div className="relative">
              <Phone size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <Input
                value={form.workPhone}
                onChange={(e) => update("workPhone", e.target.value)}
                placeholder="Work Phone"
                className={cn(fieldClass, "pl-9")}
              />
            </div>
            <div className="relative">
              <Smartphone size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <Input
                value={form.mobile}
                onChange={(e) => update("mobile", e.target.value)}
                placeholder="Mobile"
                className={cn(fieldClass, "pl-9")}
              />
            </div>
          </div>
        </FieldRow>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="flex gap-1 overflow-x-auto border-b border-gray-200 px-2 sm:px-4">
          {DETAIL_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "shrink-0 px-3 sm:px-4 py-3 text-sm font-medium border-b-2 transition-colors",
                activeTab === tab.id
                  ? "border-[#2563EB] text-[#2563EB]"
                  : "border-transparent text-gray-500 hover:text-gray-700",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="p-5 sm:p-6 space-y-5">
          {activeTab === "other" ? (
            <>
              <FieldRow label="GST Treatment" required>
                <select
                  value={form.gstTreatment}
                  onChange={(e) =>
                    handleGstTreatmentChange(e.target.value as GstTreatment)
                  }
                  className={cn(selectClass, "max-w-xl")}
                >
                  {GST_TREATMENTS.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </FieldRow>

              {visibility.showGstin ? (
                <FieldRow
                  label="GSTIN / UIN"
                  required={visibility.gstinRequired}
                  hint="15-character GSTIN (e.g. 27AAPFU0939F1ZV) or UIN"
                >
                  <div className="flex flex-col gap-1.5 max-w-xl">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                      <Input
                        value={form.gstNumber}
                        onChange={(e) =>
                          update("gstNumber", sanitizeIndianTaxIdInput(e.target.value, 15))
                        }
                        placeholder={GSTIN_EXAMPLE}
                        maxLength={15}
                        autoComplete="off"
                        spellCheck={false}
                        aria-invalid={Boolean(gstFieldError)}
                        className={cn(
                          fieldClass,
                          "flex-1 uppercase font-mono tracking-wide",
                          gstFieldError && "border-red-400 focus-visible:ring-red-400/30",
                        )}
                      />
                      <button
                        type="button"
                        className="shrink-0 text-sm font-medium text-[#2563EB] hover:text-[#1D4ED8] text-left sm:px-1"
                      >
                        Get Taxpayer details
                      </button>
                    </div>
                    {gstFieldError ? (
                      <p className="text-xs text-red-600">{gstFieldError}</p>
                    ) : null}
                  </div>
                </FieldRow>
              ) : null}

              {visibility.showBusinessNames ? (
                <>
                  <FieldRow label="Business Legal Name">
                    <Input
                      value={form.businessLegalName}
                      onChange={(e) => update("businessLegalName", e.target.value)}
                      className={cn(fieldClass, "max-w-xl")}
                    />
                  </FieldRow>
                  <FieldRow label="Business Trade Name">
                    <Input
                      value={form.businessTradeName}
                      onChange={(e) => update("businessTradeName", e.target.value)}
                      className={cn(fieldClass, "max-w-xl")}
                    />
                  </FieldRow>
                </>
              ) : null}

              {visibility.showPlaceOfSupply ? (
                <FieldRow label="Place of Supply" required={visibility.placeOfSupplyRequired}>
                  {placeOfSupplyStates.length > 0 ? (
                    <select
                      value={form.placeOfSupply}
                      onChange={(e) => update("placeOfSupply", e.target.value)}
                      disabled={!placeOfSupplyCountry}
                      className={cn(selectClass, "max-w-xl")}
                    >
                      <option value="">
                        {placeOfSupplyCountry
                          ? "Select place of supply"
                          : "Select a country in Address first"}
                      </option>
                      {placeOfSupplyStates.map((state) => (
                        <option key={state} value={state}>
                          {state}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <Input
                      value={form.placeOfSupply}
                      onChange={(e) => update("placeOfSupply", e.target.value)}
                      placeholder={
                        placeOfSupplyCountry
                          ? "Enter place of supply"
                          : "Select a country in Address first"
                      }
                      disabled={!placeOfSupplyCountry}
                      className={cn(fieldClass, "max-w-xl")}
                    />
                  )}
                </FieldRow>
              ) : null}

              {visibility.showPan ? (
                <FieldRow label="PAN" hint="Permanent Account Number — 5 letters, 4 digits, 1 letter">
                  <div className="flex flex-col gap-1.5 max-w-xs">
                    <Input
                      value={form.pan}
                      onChange={(e) =>
                        update("pan", sanitizeIndianTaxIdInput(e.target.value, 10))
                      }
                      placeholder={PAN_EXAMPLE}
                      maxLength={10}
                      autoComplete="off"
                      spellCheck={false}
                      aria-invalid={Boolean(panFieldError)}
                      className={cn(
                        fieldClass,
                        "uppercase font-mono tracking-wide",
                        panFieldError && "border-red-400 focus-visible:ring-red-400/30",
                      )}
                    />
                    {panFieldError ? (
                      <p className="text-xs text-red-600">{panFieldError}</p>
                    ) : null}
                  </div>
                </FieldRow>
              ) : null}

              <FieldRow label="Tax Preference" required>
                <div className="flex flex-wrap items-center gap-5">
                  {(
                    [
                      { value: "taxable", label: "Taxable" },
                      { value: "tax_exempt", label: "Tax Exempt" },
                    ] as const
                  ).map((option) => (
                    <label
                      key={option.value}
                      className="inline-flex items-center gap-2 text-sm text-[#1F2937] cursor-pointer"
                    >
                      <input
                        type="radio"
                        name="taxPreference"
                        checked={form.taxPreference === option.value}
                        onChange={() => update("taxPreference", option.value)}
                        className="size-4 accent-[#2563EB]"
                      />
                      {option.label}
                    </label>
                  ))}
                </div>
              </FieldRow>

              <FieldRow label="Payment Terms">
                <select
                  value={form.paymentTerms}
                  onChange={(e) => update("paymentTerms", e.target.value)}
                  className={cn(selectClass, "max-w-xs")}
                >
                  {PAYMENT_TERMS.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </FieldRow>

              <FieldRow label="Documents" align="start">
                <div>
                  <label className="inline-flex items-center gap-2 h-10 px-4 rounded-lg border border-gray-200 bg-white text-sm font-medium text-[#1F2937] hover:bg-gray-50 cursor-pointer">
                    <Upload size={16} className="text-[#2563EB]" />
                    Upload File
                    <input type="file" className="hidden" multiple accept="*/*" />
                  </label>
                  <p className="text-xs text-gray-400 mt-2">
                    You can upload a maximum of 3 files, 10MB each.
                  </p>
                </div>
              </FieldRow>

              {!showMoreDetails ? (
                <button
                  type="button"
                  onClick={() => setShowMoreDetails(true)}
                  className="text-sm font-medium text-[#2563EB] hover:text-[#1D4ED8]"
                >
                  Add more details
                </button>
              ) : (
                <FieldRow label="Notes" align="start">
                  <Textarea
                    value={form.remarks}
                    onChange={(e) => update("remarks", e.target.value)}
                    placeholder="Additional notes about this customer"
                    className="min-h-24 rounded-lg border-gray-200"
                  />
                </FieldRow>
              )}
            </>
          ) : null}

          {activeTab === "address" ? (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
              <AddressBlock
                title="Billing Address"
                values={{
                  country: form.billingCountry,
                  address1: form.billingAddress1,
                  address2: form.billingAddress2,
                  city: form.billingCity,
                  state: form.billingState,
                  zip: form.billingZip,
                  phone: form.billingPhone,
                }}
                onChange={(key, value) => {
                  const map = {
                    country: "billingCountry",
                    address1: "billingAddress1",
                    address2: "billingAddress2",
                    city: "billingCity",
                    state: "billingState",
                    zip: "billingZip",
                    phone: "billingPhone",
                  } as const;
                  if (key === "country") {
                    setForm((prev) => ({
                      ...prev,
                      billingCountry: value,
                      placeOfSupply: nextPlaceOfSupply(
                        prev.placeOfSupply,
                        value || prev.shippingCountry,
                      ),
                    }));
                    setError(null);
                    return;
                  }
                  update(map[key], value);
                }}
              />
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-[#1F2937]">Shipping Address</h3>
                  <button
                    type="button"
                    onClick={copyBillingToShipping}
                    className="text-xs font-medium text-[#2563EB] hover:text-[#1D4ED8]"
                  >
                    Copy billing address
                  </button>
                </div>
                <AddressBlock
                  title=""
                  values={{
                    country: form.shippingCountry,
                    address1: form.shippingAddress1,
                    address2: form.shippingAddress2,
                    city: form.shippingCity,
                    state: form.shippingState,
                    zip: form.shippingZip,
                    phone: form.shippingPhone,
                  }}
                  onChange={(key, value) => {
                    const map = {
                      country: "shippingCountry",
                      address1: "shippingAddress1",
                      address2: "shippingAddress2",
                      city: "shippingCity",
                      state: "shippingState",
                      zip: "shippingZip",
                      phone: "shippingPhone",
                    } as const;
                    if (key === "country") {
                      setForm((prev) => ({
                        ...prev,
                        shippingCountry: value,
                        placeOfSupply: nextPlaceOfSupply(
                          prev.placeOfSupply,
                          prev.billingCountry || value,
                        ),
                      }));
                      setError(null);
                      return;
                    }
                    update(map[key], value);
                  }}
                />
              </div>
            </div>
          ) : null}

          {activeTab === "contacts" ? (
            <div className="space-y-4">
              {form.contactPersons.length === 0 ? (
                <p className="text-sm text-gray-500">No additional contact persons added yet.</p>
              ) : (
                form.contactPersons.map((person, index) => (
                  <div
                    key={index}
                    className="rounded-xl border border-gray-200 p-4 space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-semibold text-[#1F2937]">
                        Contact Person {index + 1}
                      </h4>
                      <button
                        type="button"
                        onClick={() =>
                          update(
                            "contactPersons",
                            form.contactPersons.filter((_, i) => i !== index),
                          )
                        }
                        className="text-xs text-red-500 hover:text-red-600"
                      >
                        Remove
                      </button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <select
                        value={person.salutation}
                        onChange={(e) => {
                          const next = [...form.contactPersons];
                          next[index] = { ...person, salutation: e.target.value };
                          update("contactPersons", next);
                        }}
                        className={selectClass}
                      >
                        <option value="">Salutation</option>
                        {SALUTATIONS.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                      <Input
                        value={person.firstName}
                        onChange={(e) => {
                          const next = [...form.contactPersons];
                          next[index] = { ...person, firstName: e.target.value };
                          update("contactPersons", next);
                        }}
                        placeholder="First Name"
                        className={fieldClass}
                      />
                      <Input
                        value={person.lastName}
                        onChange={(e) => {
                          const next = [...form.contactPersons];
                          next[index] = { ...person, lastName: e.target.value };
                          update("contactPersons", next);
                        }}
                        placeholder="Last Name"
                        className={fieldClass}
                      />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <Input
                        type="email"
                        value={person.email}
                        onChange={(e) => {
                          const next = [...form.contactPersons];
                          next[index] = { ...person, email: e.target.value };
                          update("contactPersons", next);
                        }}
                        placeholder="Email"
                        className={fieldClass}
                      />
                      <Input
                        value={person.workPhone}
                        onChange={(e) => {
                          const next = [...form.contactPersons];
                          next[index] = { ...person, workPhone: e.target.value };
                          update("contactPersons", next);
                        }}
                        placeholder="Work Phone"
                        className={fieldClass}
                      />
                      <Input
                        value={person.mobile}
                        onChange={(e) => {
                          const next = [...form.contactPersons];
                          next[index] = { ...person, mobile: e.target.value };
                          update("contactPersons", next);
                        }}
                        placeholder="Mobile"
                        className={fieldClass}
                      />
                    </div>
                  </div>
                ))
              )}
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  update("contactPersons", [...form.contactPersons, emptyContactPerson()])
                }
                className="border-gray-200 text-[#2563EB]"
              >
                <Plus size={16} />
                Add Contact Person
              </Button>
            </div>
          ) : null}

          {activeTab === "custom" ? (
            <div className="space-y-4 max-w-xl">
              <FieldRow label="Field Label">
                <Input
                  value={form.customFieldLabel}
                  onChange={(e) => update("customFieldLabel", e.target.value)}
                  placeholder="e.g. Customer Code"
                  className={fieldClass}
                />
              </FieldRow>
              <FieldRow label="Field Value">
                <Input
                  value={form.customFieldValue}
                  onChange={(e) => update("customFieldValue", e.target.value)}
                  className={fieldClass}
                />
              </FieldRow>
            </div>
          ) : null}

          {activeTab === "remarks" ? (
            <FieldRow label="Remarks" align="start">
              <Textarea
                value={form.remarks}
                onChange={(e) => update("remarks", e.target.value)}
                placeholder="Internal remarks about this customer"
                className="min-h-32 rounded-lg border-gray-200"
              />
            </FieldRow>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2">
        <p className="text-xs text-gray-500 max-w-xl">
          Customer Owner: Assign a user as the customer owner to provide access only to the
          data of this customer.
        </p>
        <div className="flex items-center gap-2 self-end sm:self-auto">
          {error ? <p className="text-xs text-red-600 mr-2 max-w-xs sm:max-w-sm">{error}</p> : null}
          <Button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="bg-[#2563EB] hover:bg-[#1D4ED8] text-white min-w-24"
          >
            {saving ? "Saving…" : isEditing ? "Update" : "Save"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            className="border-gray-200 text-gray-700 min-w-24"
          >
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}

function AddressBlock({
  title,
  values,
  onChange,
}: {
  title: string;
  values: {
    country: string;
    address1: string;
    address2: string;
    city: string;
    state: string;
    zip: string;
    phone: string;
  };
  onChange: (
    key: "country" | "address1" | "address2" | "city" | "state" | "zip" | "phone",
    value: string,
  ) => void;
}) {
  const stateOptions = getStatesForCountry(values.country);
  const hasStateOptions = stateOptions.length > 0;

  return (
    <div className="space-y-3">
      {title ? <h3 className="text-sm font-semibold text-[#1F2937]">{title}</h3> : null}
      <select
        value={values.country}
        onChange={(e) => {
          onChange("country", e.target.value);
          onChange("state", "");
        }}
        className={selectClass}
      >
        <option value="">Select country</option>
        {WORLD_COUNTRIES.map((country) => (
          <option key={country} value={country}>
            {country}
          </option>
        ))}
      </select>
      <Input
        value={values.address1}
        onChange={(e) => onChange("address1", e.target.value)}
        placeholder="Address Line 1"
        className={fieldClass}
      />
      <Input
        value={values.address2}
        onChange={(e) => onChange("address2", e.target.value)}
        placeholder="Address Line 2"
        className={fieldClass}
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <Input
          value={values.city}
          onChange={(e) => onChange("city", e.target.value)}
          placeholder="City"
          className={fieldClass}
        />
        {hasStateOptions ? (
          <select
            value={values.state}
            onChange={(e) => onChange("state", e.target.value)}
            className={selectClass}
            disabled={!values.country}
          >
            <option value="">State / Province</option>
            {stateOptions.map((state) => (
              <option key={state} value={state}>
                {state}
              </option>
            ))}
          </select>
        ) : (
          <Input
            value={values.state}
            onChange={(e) => onChange("state", e.target.value)}
            placeholder="State / Province"
            className={fieldClass}
            disabled={!values.country}
          />
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <Input
          value={values.zip}
          onChange={(e) => onChange("zip", e.target.value)}
          placeholder="Zip / Postal Code"
          className={fieldClass}
        />
        <Input
          value={values.phone}
          onChange={(e) => onChange("phone", e.target.value)}
          placeholder="Phone"
          className={fieldClass}
        />
      </div>
    </div>
  );
}
