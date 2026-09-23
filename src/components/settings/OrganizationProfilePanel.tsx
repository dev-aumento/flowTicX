import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import {
  Upload,
  HelpCircle,
  Info,
  Plus,
  Trash2,
  Send,
  Pencil,
  X,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { WORLD_COUNTRIES } from "@/lib/world-countries";
import { getStatesForCountry } from "@/lib/country-states";
import { WORK_TIMEZONE_LABEL } from "@/lib/timezone";
import { useAuth } from "@/hooks/useAuth";
import { trpc } from "@/providers/trpc";
import { INVOICE_CURRENCIES } from "@/lib/invoice-store";
import {
  DEFAULT_ORGANIZATION_PROFILE,
  cacheOrganizationProfile,
  hasOrganizationBillingDetails,
  hasOrganizationLogo,
  loadOrganizationProfile,
  mergeOrganizationProfiles,
  normalizeOrganizationProfile,
  type OrganizationProfileForm,
  type OrgAdditionalField,
} from "@/lib/organization-profile";
import {
  GSTIN_ERROR,
  GSTIN_EXAMPLE,
  PAN_ERROR,
  PAN_EXAMPLE,
  isValidGstinOrUin,
  isValidPan,
  sanitizeIndianTaxIdInput,
} from "@contracts/indian-tax-ids";

export type { OrganizationProfileForm, OrgAdditionalField };

const DEFAULT_FORM = DEFAULT_ORGANIZATION_PROFILE;

const INDUSTRIES = [
  "Software / IT",
  "Consulting",
  "Manufacturing",
  "Retail",
  "Healthcare",
  "Education",
  "Finance",
  "Real Estate",
  "Other",
];

const BUSINESS_TYPES = [
  "Sole Proprietorship",
  "Partnership",
  "Private Limited",
  "Public Limited",
  "LLP",
  "NGO / Trust",
  "Other",
];

const FISCAL_YEARS = [
  { value: "january_december", label: "January - December" },
  { value: "april_march", label: "April - March" },
  { value: "july_june", label: "July - June" },
  { value: "october_september", label: "October - September" },
];

const DATE_FORMATS = [
  { value: "dd MMM yyyy", label: "dd MMM yyyy [ 04 May 2017 ]" },
  { value: "dd/MM/yyyy", label: "dd/MM/yyyy [ 04/05/2017 ]" },
  { value: "MM/dd/yyyy", label: "MM/dd/yyyy [ 05/04/2017 ]" },
  { value: "yyyy-MM-dd", label: "yyyy-MM-dd [ 2017-05-04 ]" },
];

const COMPANY_ID_TYPES = ["CIN", "EIN", "Company Registration", "Other"];
const TAX_ID_TYPES = ["GSTIN", "VAT", "TIN", "PAN", "Other"];

const fieldClass =
  "h-10 rounded-lg border border-gray-200 bg-white text-sm text-[#1F2937] focus-visible:border-[#2563EB] focus-visible:ring-[#2563EB]/30";
const selectClass = cn(
  fieldClass,
  "w-full px-3 outline-none focus:border-[#2563EB] focus:ring-[3px] focus:ring-[#2563EB]/30",
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
        "grid grid-cols-1 gap-2 sm:grid-cols-[200px_minmax(0,1fr)] sm:gap-5",
        align === "start" ? "sm:items-start" : "sm:items-center",
      )}
    >
      <div className={cn("flex items-center gap-1.5", align === "start" && "sm:pt-2.5")}>
        <Label
          className={cn(
            "text-sm font-medium",
            required ? "text-red-600" : "text-gray-600",
          )}
        >
          {label}
          {required ? " *" : ""}
        </Label>
        {hint ? (
          <span title={hint} className="text-gray-400 cursor-help">
            <HelpCircle size={14} />
          </span>
        ) : null}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

type OrganizationProfilePanelProps = {
  onSaved?: () => void;
  onError?: (message: string) => void;
};

export function OrganizationProfilePanel({
  onSaved,
  onError,
}: OrganizationProfilePanelProps) {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localCache = loadOrganizationProfile();
  const [form, setForm] = useState<OrganizationProfileForm>(() =>
    normalizeOrganizationProfile({
      ...localCache,
      primaryContactName: localCache.primaryContactName || user?.name || "",
      primaryContactEmail: localCache.primaryContactEmail || user?.email || "",
    }),
  );
  const [savedSnapshot, setSavedSnapshot] = useState(() => JSON.stringify(form));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [editingContact, setEditingContact] = useState(false);
  const [contactDraft, setContactDraft] = useState({ name: "", email: "" });

  const [hydratedFromServer, setHydratedFromServer] = useState(false);
  const migratedLocalRef = useRef(false);

  const profileQuery = trpc.organization.getBillingProfile.useQuery(undefined, {
    staleTime: 30_000,
  });

  const saveMutation = trpc.organization.updateBillingProfile.useMutation({
    onSuccess: async (data) => {
      const next = normalizeOrganizationProfile(data);
      cacheOrganizationProfile(next);
      setForm(next);
      setSavedSnapshot(JSON.stringify(next));
      setEditingContact(false);
      setError(null);
      setSaved(true);
      onSaved?.();
      await utils.organization.getBillingProfile.invalidate();
      await utils.organization.getWorkspaceCurrency.invalidate();
      await utils.dashboard.getHrDashboard.invalidate();
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => setSaved(false), 2000);
    },
    onError: (err) => {
      const message = err.message || "Could not save organization profile.";
      setError(message);
      onError?.(message);
    },
  });

  useEffect(() => {
    return () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!profileQuery.data || hydratedFromServer) return;

    const server = normalizeOrganizationProfile(profileQuery.data);
    const local = loadOrganizationProfile();
    // Merge so a server name without logo does not hide a locally saved logo.
    const preferred = mergeOrganizationProfiles(server, local);

    const next = normalizeOrganizationProfile({
      ...preferred,
      organizationId: String(profileQuery.data.organizationId || preferred.organizationId),
      primaryContactName:
        preferred.primaryContactName || user?.name || "",
      primaryContactEmail:
        preferred.primaryContactEmail || user?.email || "",
    });
    setForm(next);
    setSavedSnapshot(JSON.stringify(next));
    setHydratedFromServer(true);
    if (hasOrganizationBillingDetails(next) || hasOrganizationLogo(next)) {
      cacheOrganizationProfile(next);
    }

    // Push local logo/details to the server when missing so finance invoices can show them.
    const billingProfileSaved = Boolean(
      (profileQuery.data as { billingProfileSaved?: boolean }).billingProfileSaved,
    );
    const contactName = next.primaryContactName.trim();
    const contactEmail = next.primaryContactEmail.trim();
    const canMigrate =
      String(user?.role ?? "").toLowerCase() === "admin" &&
      Boolean(contactName) &&
      Boolean(contactEmail) &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail) &&
      (
        !billingProfileSaved ||
        (hasOrganizationLogo(local) && !hasOrganizationLogo(server))
      ) &&
      !migratedLocalRef.current &&
      !saveMutation.isPending;

    if (canMigrate) {
      migratedLocalRef.current = true;
      const { organizationId: _organizationId, ...payload } = next;
      saveMutation.mutate(payload);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-time hydrate/migrate from server+local cache
  }, [profileQuery.data, user?.email, user?.name, user?.role, hydratedFromServer]);

  const effectiveForm = useMemo((): OrganizationProfileForm => {
    if (!editingContact) return form;
    return {
      ...form,
      primaryContactName: contactDraft.name,
      primaryContactEmail: contactDraft.email,
    };
  }, [form, editingContact, contactDraft]);

  const isDirty = useMemo(
    () => JSON.stringify(effectiveForm) !== savedSnapshot,
    [effectiveForm, savedSnapshot],
  );

  const stateOptions = useMemo(
    () => getStatesForCountry(form.location),
    [form.location],
  );
  const paymentStateOptions = useMemo(
    () => getStatesForCountry(form.paymentCountry),
    [form.paymentCountry],
  );

  function update<K extends keyof OrganizationProfileForm>(
    key: K,
    value: OrganizationProfileForm[K],
  ) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setError(null);
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    setSaved(false);
  }

  function handleLogoChange(file: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      const message = "Please upload an image file for the logo.";
      setError(message);
      onError?.(message);
      return;
    }
    if (file.size > 1024 * 1024) {
      const message = "Logo must be 1MB or smaller.";
      setError(message);
      onError?.(message);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const raw = typeof reader.result === "string" ? reader.result : null;
      if (!raw) {
        update("logoDataUrl", null);
        return;
      }
      // Normalize to PNG so invoice HTML/PDF can render SVG/WebP reliably.
      const img = new Image();
      img.onload = () => {
        const maxSide = 640;
        const srcW = Math.max(1, img.naturalWidth || img.width || 1);
        const srcH = Math.max(1, img.naturalHeight || img.height || 1);
        const scale = Math.min(1, maxSide / Math.max(srcW, srcH));
        const width = Math.max(1, Math.round(srcW * scale));
        const height = Math.max(1, Math.round(srcH * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          update("logoDataUrl", raw);
          return;
        }
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        try {
          update("logoDataUrl", canvas.toDataURL("image/png"));
        } catch {
          update("logoDataUrl", raw);
        }
      };
      img.onerror = () => update("logoDataUrl", raw);
      img.src = raw;
    };
    reader.readAsDataURL(file);
  }

  function addAdditionalField() {
    update("additionalFields", [
      ...form.additionalFields,
      { id: `field_${Date.now()}`, label: "", value: "" },
    ]);
  }

  function handleSave() {
    const nextForm = editingContact
      ? {
          ...form,
          primaryContactName: contactDraft.name.trim(),
          primaryContactEmail: contactDraft.email.trim(),
        }
      : form;

    if (!nextForm.name.trim()) {
      const message = "Organization Name is required.";
      setError(message);
      onError?.(message);
      return;
    }
    if (!nextForm.location.trim()) {
      const message = "Organization Location is required.";
      setError(message);
      onError?.(message);
      return;
    }
    if (!nextForm.primaryContactName.trim()) {
      const message = "Primary contact name is required.";
      setError(message);
      onError?.(message);
      setEditingContact(true);
      return;
    }
    if (
      !nextForm.primaryContactEmail.trim() ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextForm.primaryContactEmail.trim())
    ) {
      const message = "Enter a valid primary contact email.";
      setError(message);
      onError?.(message);
      setEditingContact(true);
      return;
    }

    const taxType = nextForm.taxIdType.trim().toUpperCase();
    const taxValue = nextForm.taxIdValue.trim();
    if (taxValue) {
      if (taxType === "GSTIN" && !isValidGstinOrUin(taxValue)) {
        setError(GSTIN_ERROR);
        onError?.(GSTIN_ERROR);
        return;
      }
      if (taxType === "PAN" && !isValidPan(taxValue)) {
        setError(PAN_ERROR);
        onError?.(PAN_ERROR);
        return;
      }
    }

    const { organizationId: _organizationId, ...payload } = nextForm;
    setForm(nextForm);
    saveMutation.mutate(payload);
  }

  function handleCancel() {
    const server = profileQuery.data
      ? normalizeOrganizationProfile(profileQuery.data)
      : null;
    const stored =
      server && hasOrganizationBillingDetails(server)
        ? server
        : loadOrganizationProfile();
    setForm(stored);
    setSavedSnapshot(JSON.stringify(stored));
    setError(null);
    setSaved(false);
    setEditingContact(false);
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
  }

  function startEditingContact() {
    setContactDraft({
      name: form.primaryContactName,
      email: form.primaryContactEmail,
    });
    setEditingContact(true);
  }

  function saveContactDraft() {
    const name = contactDraft.name.trim();
    const email = contactDraft.email.trim();
    if (!name) {
      const message = "Primary contact name is required.";
      setError(message);
      onError?.(message);
      return;
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      const message = "Enter a valid primary contact email.";
      setError(message);
      onError?.(message);
      return;
    }
    setForm((prev) => ({
      ...prev,
      primaryContactName: name,
      primaryContactEmail: email,
    }));
    setEditingContact(false);
    setError(null);
    setSaved(false);
  }

  const displayContactName = form.primaryContactName || "—";
  const displayContactEmail = form.primaryContactEmail || "—";

  if (profileQuery.isLoading && !hydratedFromServer) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 size={28} className="animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, x: 10 }}
      animate={{ opacity: 1, x: 0 }}
      className="space-y-6"
    >
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold text-[#1F2937]">Organization Profile</h2>
        <span className="inline-flex items-center rounded-full bg-blue-50 text-[#2563EB] text-xs font-semibold px-2.5 py-1">
          ID: {form.organizationId}
        </span>
      </div>
      <p className="text-sm text-gray-500">
        Saved for your organization and used on invoices for both admin and finance logins.
      </p>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-[#1F2937]">Organization Logo</h3>
        <div className="flex flex-col sm:flex-row gap-4 sm:items-center">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="w-full sm:w-56 h-28 rounded-xl border border-dashed border-gray-300 bg-gray-50 hover:bg-gray-100 transition-colors flex flex-col items-center justify-center gap-2 overflow-hidden"
          >
            {form.logoDataUrl ? (
              <img
                src={form.logoDataUrl}
                alt="Organization logo"
                className="max-h-full max-w-full object-contain"
              />
            ) : (
              <>
                <Upload size={22} className="text-gray-400" />
                <span className="text-xs font-medium text-gray-500 px-3 text-center">
                  Upload Your Organization Logo
                </span>
              </>
            )}
          </button>
          <div className="text-xs text-gray-500 space-y-1">
            <p>This logo will be displayed in transaction PDFs and email notifications.</p>
            <p>Preferred Image Dimensions: 240 × 240 pixels @ 72 DPI</p>
            <p>Maximum File Size: 1MB</p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => handleLogoChange(e.target.files?.[0] ?? null)}
          />
        </div>
      </div>

      <div className="space-y-5">
        <FieldRow label="Organization Name" required>
          <Input
            value={form.name}
            onChange={(e) => update("name", e.target.value)}
            className={cn(fieldClass, "max-w-xl")}
          />
        </FieldRow>

        <FieldRow label="Industry" hint="Select the industry your organization operates in">
          <select
            value={form.industry}
            onChange={(e) => update("industry", e.target.value)}
            className={cn(selectClass, "max-w-xl")}
          >
            <option value="">Select</option>
            {INDUSTRIES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </FieldRow>

        <FieldRow label="Business Type">
          <select
            value={form.businessType}
            onChange={(e) => update("businessType", e.target.value)}
            className={cn(selectClass, "max-w-xl")}
          >
            <option value="">Select</option>
            {BUSINESS_TYPES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </FieldRow>

        <FieldRow label="Organization Location" required>
          <select
            value={form.location}
            onChange={(e) => {
              update("location", e.target.value);
              update("state", "");
            }}
            className={cn(selectClass, "max-w-xl")}
          >
            <option value="">Select country</option>
            {WORLD_COUNTRIES.map((country) => (
              <option key={country} value={country}>
                {country}
              </option>
            ))}
          </select>
        </FieldRow>

        <FieldRow
          label="Organization Address"
          hint="Address shown on invoices and documents"
          align="start"
        >
          <div className="space-y-2 max-w-xl">
            <Input
              value={form.addressLine1}
              onChange={(e) => update("addressLine1", e.target.value)}
              placeholder="Street 1"
              className={fieldClass}
            />
            <Input
              value={form.addressLine2}
              onChange={(e) => update("addressLine2", e.target.value)}
              placeholder="Street 2"
              className={fieldClass}
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Input
                value={form.city}
                onChange={(e) => update("city", e.target.value)}
                placeholder="City"
                className={fieldClass}
              />
              <Input
                value={form.zip}
                onChange={(e) => update("zip", e.target.value)}
                placeholder="Zip / Postal Code"
                className={fieldClass}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {stateOptions.length > 0 ? (
                <select
                  value={form.state}
                  onChange={(e) => update("state", e.target.value)}
                  className={selectClass}
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
                  value={form.state}
                  onChange={(e) => update("state", e.target.value)}
                  placeholder="State / Province"
                  className={fieldClass}
                />
              )}
              <Input
                value={form.phone}
                onChange={(e) => update("phone", e.target.value)}
                placeholder="Phone"
                className={fieldClass}
              />
            </div>
          </div>
        </FieldRow>

        <FieldRow label="Website URL">
          <Input
            value={form.website}
            onChange={(e) => update("website", e.target.value)}
            placeholder="Website URL"
            className={cn(fieldClass, "max-w-xl")}
          />
        </FieldRow>

        <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <p className="text-sm text-gray-700">
            Would you like to add a different address for payment stubs?
          </p>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">
              {form.differentPaymentAddress ? "Yes" : "No"}
            </span>
            <Switch
              checked={form.differentPaymentAddress}
              onCheckedChange={(checked) => update("differentPaymentAddress", checked)}
            />
          </div>
        </div>

        {form.differentPaymentAddress ? (
          <div className="rounded-xl border border-gray-200 p-4 space-y-2 max-w-xl">
            <p className="text-sm font-semibold text-[#1F2937] mb-1">Payment Address</p>
            <select
              value={form.paymentCountry}
              onChange={(e) => {
                update("paymentCountry", e.target.value);
                update("paymentState", "");
              }}
              className={selectClass}
            >
              {WORLD_COUNTRIES.map((country) => (
                <option key={country} value={country}>
                  {country}
                </option>
              ))}
            </select>
            <Input
              value={form.paymentAddressLine1}
              onChange={(e) => update("paymentAddressLine1", e.target.value)}
              placeholder="Street 1"
              className={fieldClass}
            />
            <Input
              value={form.paymentAddressLine2}
              onChange={(e) => update("paymentAddressLine2", e.target.value)}
              placeholder="Street 2"
              className={fieldClass}
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Input
                value={form.paymentCity}
                onChange={(e) => update("paymentCity", e.target.value)}
                placeholder="City"
                className={fieldClass}
              />
              <Input
                value={form.paymentZip}
                onChange={(e) => update("paymentZip", e.target.value)}
                placeholder="Zip / Postal Code"
                className={fieldClass}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {paymentStateOptions.length > 0 ? (
                <select
                  value={form.paymentState}
                  onChange={(e) => update("paymentState", e.target.value)}
                  className={selectClass}
                >
                  <option value="">State / Province</option>
                  {paymentStateOptions.map((state) => (
                    <option key={state} value={state}>
                      {state}
                    </option>
                  ))}
                </select>
              ) : (
                <Input
                  value={form.paymentState}
                  onChange={(e) => update("paymentState", e.target.value)}
                  placeholder="State / Province"
                  className={fieldClass}
                />
              )}
              <Input
                value={form.paymentPhone}
                onChange={(e) => update("paymentPhone", e.target.value)}
                placeholder="Phone"
                className={fieldClass}
              />
            </div>
          </div>
        ) : null}

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-[#1F2937]">Primary Contact</h3>
            {!editingContact ? (
              <button
                type="button"
                onClick={startEditingContact}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-[#2563EB] hover:text-[#1D4ED8]"
              >
                <Pencil size={14} />
                Edit
              </button>
            ) : null}
          </div>

          {editingContact ? (
            <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label className="text-sm font-medium text-gray-600 mb-1.5 block">
                    Sender Name
                  </Label>
                  <Input
                    value={contactDraft.name}
                    onChange={(e) =>
                      setContactDraft((prev) => ({ ...prev, name: e.target.value }))
                    }
                    placeholder="Contact name"
                    className={fieldClass}
                  />
                </div>
                <div>
                  <Label className="text-sm font-medium text-gray-600 mb-1.5 block">
                    Sender Email
                  </Label>
                  <Input
                    type="email"
                    value={contactDraft.email}
                    onChange={(e) =>
                      setContactDraft((prev) => ({ ...prev, email: e.target.value }))
                    }
                    placeholder="contact@example.com"
                    className={fieldClass}
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button type="button" onClick={saveContactDraft} className="bg-[#2563EB] hover:bg-[#1D4ED8] text-white h-9">
                  Update Contact
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setEditingContact(false);
                    setError(null);
                  }}
                  className="border-gray-200 text-gray-700 h-9"
                >
                  <X size={14} />
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-gray-200 bg-gray-50 grid grid-cols-1 md:grid-cols-2 overflow-hidden">
              <div className="p-4 border-b md:border-b-0 md:border-r border-gray-200">
                <div className="flex items-center gap-2 text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                  <Send size={14} className="text-[#2563EB]" />
                  Sender
                </div>
                <p className="text-sm font-semibold text-[#1F2937]">{displayContactName}</p>
                <p className="text-sm text-gray-500">{displayContactEmail}</p>
              </div>
              <div className="p-4">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                  Emails are sent through
                </p>
                <p className="text-sm font-medium text-[#1F2937]">Email address of sender</p>
                <p className="text-sm text-gray-500">{displayContactEmail}</p>
              </div>
            </div>
          )}
        </div>

        <FieldRow label="Base Currency" hint="Currency used across invoices and reports">
          <select
            value={form.baseCurrency}
            onChange={(e) => update("baseCurrency", e.target.value)}
            className={cn(selectClass, "max-w-xl")}
          >
            {INVOICE_CURRENCIES.map((item) => (
              <option key={item.code} value={item.code}>
                {item.label}
              </option>
            ))}
          </select>
        </FieldRow>

        <FieldRow label="Fiscal Year">
          <select
            value={form.fiscalYear}
            onChange={(e) => update("fiscalYear", e.target.value)}
            className={cn(selectClass, "max-w-xl")}
          >
            {FISCAL_YEARS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </FieldRow>
        
        <FieldRow label="Time Zone">
          <select
            value={form.timeZone}
            onChange={(e) => update("timeZone", e.target.value)}
            className={cn(selectClass, "max-w-xl")}
          >
            <option value="Asia/Kolkata">{WORK_TIMEZONE_LABEL}</option>
            <option value="UTC">UTC</option>
            <option value="America/New_York">(GMT -5:00) Eastern Time</option>
            <option value="Europe/London">(GMT +0:00) London</option>
            <option value="Asia/Dubai">(GMT +4:00) Dubai</option>
            <option value="Asia/Singapore">(GMT +8:00) Singapore</option>
          </select>
        </FieldRow>

        <FieldRow label="Date Format">
          <select
            value={form.dateFormat}
            onChange={(e) => update("dateFormat", e.target.value)}
            className={cn(selectClass, "max-w-xl")}
          >
            {DATE_FORMATS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </FieldRow>

        <FieldRow label="Company ID">
          <div className="grid grid-cols-1 sm:grid-cols-[140px_minmax(0,1fr)] gap-2 max-w-xl">
            <select
              value={form.companyIdType}
              onChange={(e) => update("companyIdType", e.target.value)}
              className={selectClass}
            >
              {COMPANY_ID_TYPES.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
            <Input
              value={form.companyIdValue}
              onChange={(e) => update("companyIdValue", e.target.value)}
              placeholder="Enter company ID"
              className={fieldClass}
            />
          </div>
        </FieldRow>

        <FieldRow label="Tax ID">
          <div className="grid grid-cols-1 sm:grid-cols-[140px_minmax(0,1fr)] gap-2 max-w-xl">
            <select
              value={form.taxIdType}
              onChange={(e) => update("taxIdType", e.target.value)}
              className={selectClass}
            >
              {TAX_ID_TYPES.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
            <Input
              value={form.taxIdValue}
              onChange={(e) => {
                const type = form.taxIdType.trim().toUpperCase();
                const raw = e.target.value;
                if (type === "GSTIN") {
                  update("taxIdValue", sanitizeIndianTaxIdInput(raw, 15));
                  return;
                }
                if (type === "PAN") {
                  update("taxIdValue", sanitizeIndianTaxIdInput(raw, 10));
                  return;
                }
                update("taxIdValue", raw);
              }}
              placeholder={
                form.taxIdType === "GSTIN"
                  ? GSTIN_EXAMPLE
                  : form.taxIdType === "PAN"
                    ? PAN_EXAMPLE
                    : "Enter tax ID"
              }
              maxLength={
                form.taxIdType === "GSTIN" ? 15 : form.taxIdType === "PAN" ? 10 : 80
              }
              autoComplete="off"
              spellCheck={false}
              className={cn(
                fieldClass,
                (form.taxIdType === "GSTIN" || form.taxIdType === "PAN") &&
                  "uppercase font-mono tracking-wide",
              )}
            />
          </div>
        </FieldRow>
      </div>

      <div className="border-t border-gray-200 pt-5 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-[#1F2937]">Bank details for invoices</h3>
          <p className="text-xs text-gray-500 mt-1">
            Shown on invoices only after you save them here. Leave blank to hide the bank section.
          </p>
        </div>

        <FieldRow label="Bank Name">
          <Input
            value={form.bankName}
            onChange={(e) => update("bankName", e.target.value)}
            placeholder="e.g. HDFC Bank"
            className={cn(fieldClass, "max-w-xl")}
          />
        </FieldRow>
        <FieldRow label="Account Name">
          <Input
            value={form.bankAccountName}
            onChange={(e) => update("bankAccountName", e.target.value)}
            placeholder="Name on the account"
            className={cn(fieldClass, "max-w-xl")}
          />
        </FieldRow>
        <FieldRow label="Account Number">
          <Input
            value={form.bankAccountNumber}
            onChange={(e) => update("bankAccountNumber", e.target.value)}
            placeholder="Account number"
            className={cn(fieldClass, "max-w-xl")}
          />
        </FieldRow>
        <FieldRow label="IFSC Code">
          <Input
            value={form.bankIfsc}
            onChange={(e) => update("bankIfsc", e.target.value)}
            placeholder="IFSC"
            className={cn(fieldClass, "max-w-xl")}
          />
        </FieldRow>
        <FieldRow label="SWIFT Code">
          <Input
            value={form.bankSwift}
            onChange={(e) => update("bankSwift", e.target.value)}
            placeholder="SWIFT / BIC (optional)"
            className={cn(fieldClass, "max-w-xl")}
          />
        </FieldRow>
      </div>

      <div className="border-t border-gray-200 pt-5 space-y-4">
        <h3 className="text-sm font-semibold text-[#1F2937]">Additional Fields</h3>

        {form.additionalFields.length > 0 ? (
          <div className="rounded-xl border border-gray-200 overflow-hidden">
            <div className="grid grid-cols-[1fr_1fr_40px] gap-2 px-4 py-2 bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wider">
              <span>Label Name</span>
              <span>Value</span>
              <span />
            </div>
            <div className="divide-y divide-gray-100">
              {form.additionalFields.map((field, index) => (
                <div
                  key={field.id}
                  className="grid grid-cols-[1fr_1fr_40px] gap-2 px-4 py-2 items-center"
                >
                  <Input
                    value={field.label}
                    onChange={(e) => {
                      const next = [...form.additionalFields];
                      next[index] = { ...field, label: e.target.value };
                      update("additionalFields", next);
                    }}
                    placeholder="Label"
                    className={fieldClass}
                  />
                  <Input
                    value={field.value}
                    onChange={(e) => {
                      const next = [...form.additionalFields];
                      next[index] = { ...field, value: e.target.value };
                      update("additionalFields", next);
                    }}
                    placeholder="Value"
                    className={fieldClass}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      update(
                        "additionalFields",
                        form.additionalFields.filter((f) => f.id !== field.id),
                      )
                    }
                    className="h-9 w-9 inline-flex items-center justify-center rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50"
                    aria-label="Remove field"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <button
          type="button"
          onClick={addAdditionalField}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-[#2563EB] hover:text-[#1D4ED8]"
        >
          <Plus size={16} />
          New Field
        </button>

        <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-3 flex gap-2">
          <Info size={16} className="text-[#2563EB] shrink-0 mt-0.5" />
          <p className="text-xs text-gray-600">
            You can include the Company ID, Tax ID and additional fields in your organization
            address which will be displayed in your transaction PDFs.
          </p>
        </div>
      </div>

      {error ? <p className="text-sm text-red-500">{error}</p> : null}

      <div className="flex items-center gap-2 pt-1">
        <Button
          type="button"
          onClick={handleSave}
          disabled={!isDirty || saved || saveMutation.isPending}
          className="bg-[#2563EB] hover:bg-[#1D4ED8] text-white min-w-24 disabled:opacity-50 disabled:pointer-events-none gap-2"
        >
          {saveMutation.isPending ? (
            <Loader2 size={14} className="animate-spin" />
          ) : null}
          {saved ? "Saved" : saveMutation.isPending ? "Saving…" : "Save"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={handleCancel}
          disabled={(!isDirty && !editingContact) || saveMutation.isPending}
          className="border-gray-200 text-gray-700 min-w-24"
        >
          Cancel
        </Button>
      </div>
    </motion.div>
  );
}
