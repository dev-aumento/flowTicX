/** Indian PAN: 5 letters, 4 digits, 1 letter. Example: ABCDE1234F */
export const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

/**
 * Regular GSTIN: 2-digit state code + 10-char PAN + entity + Z + checksum.
 * Example: 27AAPFU0939F1ZV
 */
export const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** GST UIN for UN bodies / embassies (15 characters). Example: 0717UNO00123UNS */
export const GST_UIN_PATTERN = /^[0-9]{4}[A-Z]{3}[0-9]{5}UN[0-9A-Z]$/;

export const GSTIN_EXAMPLE = "27AAPFU0939F1ZV";
export const PAN_EXAMPLE = "ABCDE1234F";

export const GSTIN_ERROR = `Enter a valid 15-character GSTIN / UIN (e.g. ${GSTIN_EXAMPLE}).`;
export const PAN_ERROR = `Enter a valid 10-character PAN (e.g. ${PAN_EXAMPLE}).`;
export const PAN_GSTIN_MISMATCH_ERROR = "PAN must match the PAN in the GSTIN.";

export function normalizeIndianTaxId(value: string): string {
  return value.replace(/[\s-]/g, "").toUpperCase();
}

export function sanitizeIndianTaxIdInput(value: string, maxLength: number): string {
  return normalizeIndianTaxId(value)
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, maxLength);
}

export function isValidPan(value: string): boolean {
  return PAN_PATTERN.test(normalizeIndianTaxId(value));
}

export function isValidGstinOrUin(value: string): boolean {
  const normalized = normalizeIndianTaxId(value);
  return GSTIN_PATTERN.test(normalized) || GST_UIN_PATTERN.test(normalized);
}

/** PAN embedded in a regular GSTIN (characters 3–12). */
export function panFromGstin(gstin: string): string | null {
  const normalized = normalizeIndianTaxId(gstin);
  if (!GSTIN_PATTERN.test(normalized)) return null;
  return normalized.slice(2, 12);
}

export function gstinPanMismatch(gstin: string, pan: string): boolean {
  const embedded = panFromGstin(gstin);
  const normalizedPan = normalizeIndianTaxId(pan);
  return Boolean(embedded && normalizedPan && embedded !== normalizedPan);
}
