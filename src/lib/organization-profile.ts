export const ORGANIZATION_PROFILE_STORAGE_KEY = "settings-organization-profile";

export type OrgAdditionalField = { id: string; label: string; value: string };

export type OrganizationProfileForm = {
  organizationId: string;
  logoDataUrl: string | null;
  name: string;
  industry: string;
  businessType: string;
  location: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  zip: string;
  state: string;
  phone: string;
  fax: string;
  website: string;
  differentPaymentAddress: boolean;
  paymentAddressLine1: string;
  paymentAddressLine2: string;
  paymentCity: string;
  paymentZip: string;
  paymentState: string;
  paymentCountry: string;
  paymentPhone: string;
  primaryContactName: string;
  primaryContactEmail: string;
  baseCurrency: string;
  fiscalYear: string;
  language: string;
  timeZone: string;
  dateFormat: string;
  companyIdType: string;
  companyIdValue: string;
  taxIdType: string;
  taxIdValue: string;
  additionalFields: OrgAdditionalField[];
  bankName: string;
  bankAccountName: string;
  bankAccountNumber: string;
  bankIfsc: string;
  bankSwift: string;
};

export const DEFAULT_ORGANIZATION_PROFILE: OrganizationProfileForm = {
  organizationId: "12345678",
  logoDataUrl: null,
  name: "",
  industry: "",
  businessType: "",
  location: "India",
  addressLine1: "",
  addressLine2: "",
  city: "",
  zip: "",
  state: "",
  phone: "",
  fax: "",
  website: "",
  differentPaymentAddress: false,
  paymentAddressLine1: "",
  paymentAddressLine2: "",
  paymentCity: "",
  paymentZip: "",
  paymentState: "",
  paymentCountry: "India",
  paymentPhone: "",
  primaryContactName: "",
  primaryContactEmail: "",
  baseCurrency: "INR",
  fiscalYear: "january_december",
  language: "en",
  timeZone: "Asia/Kolkata",
  dateFormat: "dd MMM yyyy",
  companyIdType: "CIN",
  companyIdValue: "",
  taxIdType: "GSTIN",
  taxIdValue: "",
  additionalFields: [],
  bankName: "",
  bankAccountName: "",
  bankAccountNumber: "",
  bankIfsc: "",
  bankSwift: "",
};

export function normalizeOrganizationProfile(
  value?: Partial<OrganizationProfileForm> | null,
): OrganizationProfileForm {
  return {
    ...DEFAULT_ORGANIZATION_PROFILE,
    ...(value ?? {}),
    additionalFields: Array.isArray(value?.additionalFields)
      ? value!.additionalFields
      : [],
    bankName: String(value?.bankName ?? ""),
    bankAccountName: String(value?.bankAccountName ?? ""),
    bankAccountNumber: String(value?.bankAccountNumber ?? ""),
    bankIfsc: String(value?.bankIfsc ?? ""),
    bankSwift: String(value?.bankSwift ?? ""),
  };
}

/** Local cache only — invoices should prefer the server profile when available. */
export function loadOrganizationProfile(): OrganizationProfileForm {
  try {
    const raw = localStorage.getItem(ORGANIZATION_PROFILE_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_ORGANIZATION_PROFILE };
    const parsed = JSON.parse(raw) as Partial<OrganizationProfileForm>;
    return normalizeOrganizationProfile(parsed);
  } catch {
    return { ...DEFAULT_ORGANIZATION_PROFILE };
  }
}

export function cacheOrganizationProfile(profile: OrganizationProfileForm) {
  try {
    localStorage.setItem(ORGANIZATION_PROFILE_STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // Ignore quota / private-mode failures; server profile remains source of truth.
  }
}

/** True when the profile has enough company identity for invoice headers. */
export function hasOrganizationBillingDetails(profile?: OrganizationProfileForm | null) {
  return Boolean(profile?.name?.trim());
}

export function hasOrganizationLogo(profile?: OrganizationProfileForm | null) {
  const logo = profile?.logoDataUrl?.trim() ?? "";
  return logo.startsWith("data:image/");
}

/**
 * Merge server billing profile with the local cache so a missing server logo
 * (common before the first re-save) still appears on invoices in this browser,
 * and so admin can migrate the logo up to the shared org profile.
 */
export function mergeOrganizationProfiles(
  primary?: Partial<OrganizationProfileForm> | null,
  fallback?: Partial<OrganizationProfileForm> | null,
): OrganizationProfileForm {
  const a = normalizeOrganizationProfile(primary);
  const b = normalizeOrganizationProfile(fallback);
  return normalizeOrganizationProfile({
    ...b,
    ...a,
    name: a.name.trim() || b.name.trim(),
    logoDataUrl: hasOrganizationLogo(a) ? a.logoDataUrl : b.logoDataUrl,
    addressLine1: a.addressLine1.trim() || b.addressLine1,
    addressLine2: a.addressLine2.trim() || b.addressLine2,
    city: a.city.trim() || b.city,
    state: a.state.trim() || b.state,
    zip: a.zip.trim() || b.zip,
    phone: a.phone.trim() || b.phone,
    taxIdValue: a.taxIdValue.trim() || b.taxIdValue,
    taxIdType: a.taxIdType.trim() || b.taxIdType,
    companyIdValue: a.companyIdValue.trim() || b.companyIdValue,
    primaryContactName: a.primaryContactName.trim() || b.primaryContactName,
    primaryContactEmail: a.primaryContactEmail.trim() || b.primaryContactEmail,
    bankName: a.bankName.trim() || b.bankName,
    bankAccountName: a.bankAccountName.trim() || b.bankAccountName,
    bankAccountNumber: a.bankAccountNumber.trim() || b.bankAccountNumber,
    bankIfsc: a.bankIfsc.trim() || b.bankIfsc,
    bankSwift: a.bankSwift.trim() || b.bankSwift,
    additionalFields:
      a.additionalFields.length > 0 ? a.additionalFields : b.additionalFields,
  });
}

/** Profile used on invoice preview/PDF — server first, local logo/details as fill-ins. */
export function resolveOrganizationProfileForInvoice(
  server?: Partial<OrganizationProfileForm> | null,
): OrganizationProfileForm {
  return mergeOrganizationProfiles(server, loadOrganizationProfile());
}

export function formatOrganizationBankLines(org: OrganizationProfileForm): string[] {
  const lines: string[] = [];
  if (org.bankName?.trim()) lines.push(`Bank Name: ${org.bankName.trim()}`);
  if (org.bankAccountName?.trim()) lines.push(`Account Name: ${org.bankAccountName.trim()}`);
  if (org.bankAccountNumber?.trim()) lines.push(`Account Number: ${org.bankAccountNumber.trim()}`);
  if (org.bankIfsc?.trim()) lines.push(`IFSC Code: ${org.bankIfsc.trim()}`);
  if (org.bankSwift?.trim()) lines.push(`SWIFT Code: ${org.bankSwift.trim()}`);
  return lines;
}

export function hasOrganizationBankDetails(profile?: OrganizationProfileForm | null) {
  if (!profile) return false;
  return formatOrganizationBankLines(normalizeOrganizationProfile(profile)).length > 0;
}

export function formatOrganizationAddress(org: OrganizationProfileForm): string[] {
  const lines: string[] = [];
  if (org.addressLine1.trim()) lines.push(org.addressLine1.trim());
  if (org.addressLine2.trim()) lines.push(org.addressLine2.trim());
  const cityLine = [org.city, org.state, org.zip].filter((p) => p?.trim()).join(" ");
  if (cityLine) {
    const withCountry = org.location?.trim()
      ? `${cityLine}, ${org.location.trim()}`
      : cityLine;
    lines.push(withCountry);
  } else if (org.location?.trim()) {
    lines.push(org.location.trim());
  }
  return lines;
}

export function formatCustomerBillingAddress(customer: {
  billingAddress1?: string;
  billingAddress2?: string;
  billingCity?: string;
  billingState?: string;
  billingZip?: string;
  billingCountry?: string;
}): string[] {
  const lines: string[] = [];
  if (customer.billingAddress1?.trim()) lines.push(customer.billingAddress1.trim());
  if (customer.billingAddress2?.trim()) lines.push(customer.billingAddress2.trim());
  const cityState = [customer.billingCity, customer.billingState]
    .filter((p) => p?.trim())
    .join(", ");
  const cityLine = [cityState, customer.billingZip].filter((p) => p?.trim()).join(" ");
  if (cityLine) lines.push(cityLine);
  if (customer.billingCountry?.trim()) lines.push(customer.billingCountry.trim());
  return lines;
}
