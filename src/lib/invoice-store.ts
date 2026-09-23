import { workZoneWallTimeToUtc } from "@/lib/timezone";

export type InvoiceLineItem = {
  id: string;
  itemDetails: string;
  quantity: number;
  rate: number;
  discountPercent: number;
  taxPercent: number;
};

export type InvoiceStatus = "draft" | "pending" | "sent" | "partial" | "paid";
export type InvoicePaymentStatus = Exclude<InvoiceStatus, "draft">;

export const INVOICE_PAYMENT_STATUS_OPTIONS: { value: InvoicePaymentStatus; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "sent", label: "Sent" },
  { value: "partial", label: "Partial payment" },
  { value: "paid", label: "Paid" },
];

export function invoiceStatusLabel(status?: string | null): string {
  const value = String(status ?? "").toLowerCase();
  if (value === "partial") return "Partial payment";
  if (value === "pending") return "Pending";
  if (value === "paid") return "Paid";
  if (value === "sent") return "Sent";
  if (value === "draft") return "Draft";
  return status?.trim() || "Pending";
}

export function invoiceStatusBadgeClass(status?: string | null): string {
  const value = String(status ?? "").toLowerCase();
  if (value === "paid") return "bg-emerald-50 text-emerald-700";
  if (value === "partial") return "bg-orange-50 text-orange-700";
  if (value === "sent") return "bg-sky-50 text-sky-700";
  if (value === "pending") return "bg-amber-50 text-amber-700";
  return "bg-slate-100 text-slate-600";
}

export function isInvoiceOutstanding(status?: string | null): boolean {
  const value = String(status ?? "").toLowerCase();
  return value === "pending" || value === "sent" || value === "partial";
}

export function paymentStatusFromInvoice(status?: string | null): InvoicePaymentStatus {
  const value = String(status ?? "").toLowerCase();
  if (value === "paid" || value === "partial" || value === "sent") return value;
  return "pending";
}

export const INVOICE_CURRENCIES = [
  { code: "INR", label: "INR — Indian Rupee" },
  { code: "USD", label: "USD — US Dollar" },
  { code: "EUR", label: "EUR — Euro" },
  { code: "GBP", label: "GBP — British Pound" },
  { code: "AED", label: "AED — UAE Dirham" },
  { code: "AUD", label: "AUD — Australian Dollar" },
  { code: "CAD", label: "CAD — Canadian Dollar" },
  { code: "SGD", label: "SGD — Singapore Dollar" },
  { code: "JPY", label: "JPY — Japanese Yen" },
  { code: "CHF", label: "CHF — Swiss Franc" },
  { code: "NZD", label: "NZD — New Zealand Dollar" },
  { code: "SAR", label: "SAR — Saudi Riyal" },
  { code: "QAR", label: "QAR — Qatari Riyal" },
  { code: "HKD", label: "HKD — Hong Kong Dollar" },
] as const;

export type InvoiceCurrencyCode = (typeof INVOICE_CURRENCIES)[number]["code"];

export function normalizeCurrencyCode(currency?: string | null): InvoiceCurrencyCode {
  const code = String(currency ?? "INR").trim().toUpperCase();
  if (INVOICE_CURRENCIES.some((item) => item.code === code)) {
    return code as InvoiceCurrencyCode;
  }
  return "INR";
}

export type InvoiceRecord = {
  id: number;
  invoiceNumber: string;
  orderNumber: string;
  customerId: number;
  customerName: string;
  /** ISO currency code; defaults to INR when missing on older invoices. */
  currency?: string;
  invoiceDate: string;
  /** Billing period start (YYYY-MM-DD). */
  periodStart?: string;
  /** Billing period end (YYYY-MM-DD). */
  periodEnd?: string;
  terms: string;
  dueDate: string;
  salesperson: string;
  /** GST HSN (goods) or SAC (services) code for this invoice. */
  hsnSac?: string;
  items: InvoiceLineItem[];
  customerNotes: string;
  shippingCharges: number;
  taxMode: "tds" | "tcs" | "none";
  taxPercent: number;
  adjustment: number;
  roundOff: boolean;
  status: InvoiceStatus;
  /** Amount already received. Remaining due is total minus this. */
  amountPaid?: number;
  createdAt: string;
  /** Project used to auto-fill hours from timers. */
  projectId?: number | null;
  /** Departments / designations whose timers are left out of automatic hours. */
  excludeDepartments?: string[];
  autoInvoiceType?: "task" | "project" | null;
};

export type InvoiceFormValues = Omit<InvoiceRecord, "id" | "createdAt"> & {
  id?: number;
};

export const INVOICES_STORAGE_KEY = "tracker.admin.invoices";
export const INVOICES_MIGRATED_KEY = "tracker.admin.invoices.migrated.v1";

/** Legacy localStorage shape (string ids) used before Mongo persistence. */
export type LegacyInvoiceRecord = Omit<InvoiceRecord, "id" | "customerId"> & {
  id: string | number;
  customerId: string | number;
};

export function loadLegacyInvoices(): LegacyInvoiceRecord[] {
  try {
    const raw = localStorage.getItem(INVOICES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function clearLegacyInvoices() {
  localStorage.removeItem(INVOICES_STORAGE_KEY);
}

export function hasMigratedLegacyInvoices(): boolean {
  return localStorage.getItem(INVOICES_MIGRATED_KEY) === "1";
}

export function markLegacyInvoicesMigrated() {
  localStorage.setItem(INVOICES_MIGRATED_KEY, "1");
}

/** HSN is 4/6/8 digits; SAC is 6 digits. Keep one combined optional code. */
export function normalizeHsnSac(value: string): string {
  return value.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 8);
}

export function displayHsnSac(value?: string | null): string {
  const normalized = normalizeHsnSac(value ?? "");
  return normalized || "-";
}

export function nextInvoiceNumber(existing: Pick<InvoiceRecord, "invoiceNumber">[] = []): string {
  const max = existing.reduce((acc, inv) => {
    const match = inv.invoiceNumber.match(/(\d+)\s*$/);
    const num = match ? Number(match[1]) : 0;
    return Number.isFinite(num) ? Math.max(acc, num) : acc;
  }, 0);
  return `Aumento/${max + 1}`;
}

export function lineAmount(item: InvoiceLineItem): number {
  const base = item.quantity * item.rate;
  const afterDiscount = base * (1 - (item.discountPercent || 0) / 100);
  // Tax is applied at invoice level (IGST / TDS / TCS), not per line item.
  return Math.max(0, afterDiscount);
}

export function invoiceSubTotal(items: InvoiceLineItem[]): number {
  return items.reduce((sum, item) => sum + lineAmount(item), 0);
}

export function invoiceTotal(invoice: Pick<
  InvoiceRecord,
  "items" | "shippingCharges" | "taxMode" | "taxPercent" | "adjustment" | "roundOff"
>): number {
  const sub = invoiceSubTotal(invoice.items);
  const shipping = Number(invoice.shippingCharges) || 0;
  const adjustment = Number(invoice.adjustment) || 0;
  let total = sub + shipping + adjustment;
  if (invoice.taxPercent > 0) {
    const taxAmount = (sub * invoice.taxPercent) / 100;
    // "none" = Tax/IGST (adds); TCS adds; TDS deducts
    total = invoice.taxMode === "tds" ? total - taxAmount : total + taxAmount;
  }
  if (invoice.roundOff) total = Math.round(total);
  return Math.max(0, total);
}

type InvoiceMoneyFields = Pick<
  InvoiceRecord,
  "items" | "shippingCharges" | "taxMode" | "taxPercent" | "adjustment" | "roundOff"
> & {
  status?: string | null;
  amountPaid?: number | null;
};

export function invoicePaidAmount(invoice: InvoiceMoneyFields): number {
  const total = invoiceTotal(invoice);
  if (String(invoice.status ?? "").toLowerCase() === "paid") return total;
  const paid = Number(invoice.amountPaid) || 0;
  if (!Number.isFinite(paid) || paid <= 0) return 0;
  return Math.min(total, paid);
}

export function invoiceBalanceDue(invoice: InvoiceMoneyFields): number {
  if (String(invoice.status ?? "").toLowerCase() === "paid") return 0;
  return Math.max(0, invoiceTotal(invoice) - invoicePaidAmount(invoice));
}

export function resolveInvoicePayment(input: {
  status: InvoiceStatus;
  amountPaid?: number | null;
  total: number;
}): { status: InvoiceStatus; amountPaid: number } {
  const total = Math.max(0, Number(input.total) || 0);
  const rawPaid = Number(input.amountPaid) || 0;
  const paid = Number.isFinite(rawPaid) ? Math.max(0, rawPaid) : 0;
  if (input.status === "draft") {
    return { status: "draft", amountPaid: Math.min(paid, total) };
  }
  if (input.status === "paid" || (total > 0 && paid >= total)) {
    return { status: "paid", amountPaid: total };
  }
  if (input.status === "partial") {
    return { status: "partial", amountPaid: Math.min(paid, total) };
  }
  return { status: input.status, amountPaid: 0 };
}

export function formatOutstandingByCurrency(
  invoices: Array<InvoiceMoneyFields & { currency?: string | null }>,
): string {
  const byCurrency = new Map<string, number>();
  for (const invoice of invoices) {
    const code = normalizeCurrencyCode(invoice.currency);
    byCurrency.set(code, (byCurrency.get(code) ?? 0) + invoiceBalanceDue(invoice));
  }
  return [...byCurrency.entries()]
    .filter(([, amount]) => amount > 0)
    .map(([code, amount]) => formatMoney(amount, code))
    .join(" · ");
}

/** Invoice-level IGST when Tax mode is selected (taxMode "none"). */
export function invoiceIgstAmount(invoice: Pick<
  InvoiceRecord,
  "items" | "taxMode" | "taxPercent"
>): number {
  if (invoice.taxMode !== "none" || !(invoice.taxPercent > 0)) return 0;
  return (invoiceSubTotal(invoice.items) * invoice.taxPercent) / 100;
}

export function formatMoney(value: number, currency = "INR"): string {
  const code = currency || "INR";
  const locale = code === "INR" ? "en-IN" : "en-US";
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: code,
      maximumFractionDigits: code === "JPY" ? 0 : 2,
    }).format(value || 0);
  } catch {
    return `${currencySymbol(code)}${(value || 0).toFixed(2)}`;
  }
}

/** Display currency symbol (HTML preview / UI). */
export function currencySymbol(currency = "INR"): string {
  const code = (currency || "INR").toUpperCase();
  const symbols: Record<string, string> = {
    INR: "₹",
    USD: "$",
    EUR: "€",
    GBP: "£",
    AED: "د.إ",
    AUD: "A$",
    CAD: "C$",
    SGD: "S$",
    JPY: "¥",
    CHF: "CHF ",
    NZD: "NZ$",
    SAR: "SAR ",
    QAR: "QAR ",
    HKD: "HK$",
  };
  return symbols[code] || `${code} `;
}

/**
 * Currency prefix for jsPDF built-in fonts (WinAnsi — limited Unicode).
 * Prefer real symbols where the font supports them; fall back otherwise.
 */
export function currencyPdfPrefix(currency = "INR"): string {
  const code = (currency || "INR").toUpperCase();
  const symbols: Record<string, string> = {
    INR: "Rs.", // ₹ is not in Helvetica; Rs. is PDF-safe for file download
    USD: "$",
    EUR: "€",
    GBP: "£",
    AED: "AED",
    AUD: "A$",
    CAD: "C$",
    SGD: "S$",
    JPY: "¥",
    CHF: "CHF",
    NZD: "NZ$",
    SAR: "SAR",
    QAR: "QAR",
    HKD: "HK$",
  };
  return symbols[code] || code;
}

/** Seconds from a time entry, including a still-running task timer. */
export function timeEntryLoggedSeconds(
  entry: {
    clockIn?: Date | string | null;
    clockOut?: Date | string | null;
    duration?: number | null;
    durationSeconds?: number | null;
  },
  now: Date = new Date(),
): number {
  if (typeof entry.durationSeconds === "number" && entry.durationSeconds > 0) {
    return entry.durationSeconds;
  }
  const start = entry.clockIn ? new Date(entry.clockIn).getTime() : NaN;
  if (!Number.isFinite(start)) {
    const minutes = Number(entry.duration);
    if (Number.isFinite(minutes) && minutes > 0) return Math.floor(minutes * 60);
    return 0;
  }
  const end = entry.clockOut ? new Date(entry.clockOut).getTime() : now.getTime();
  if (Number.isFinite(end) && end > start) {
    return Math.floor((end - start) / 1000);
  }
  const minutes = Number(entry.duration);
  if (Number.isFinite(minutes) && minutes > 0) return Math.floor(minutes * 60);
  return 0;
}

function asTime(value: Date | string | null | undefined): number {
  if (value == null || value === "") return NaN;
  const t = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(t) ? t : NaN;
}

function entryIntervalMs(
  entry: {
    clockIn?: Date | string | null;
    clockOut?: Date | string | null;
    createdAt?: Date | string | null;
    duration?: number | null;
    durationSeconds?: number | null;
  },
  now: Date,
): { start: number; end: number } | null {
  let start = asTime(entry.clockIn);
  if (!Number.isFinite(start)) start = asTime(entry.createdAt);
  if (!Number.isFinite(start)) return null;
  const clockOut = asTime(entry.clockOut);
  if (Number.isFinite(clockOut) && clockOut > start) return { start, end: clockOut };
  if (typeof entry.durationSeconds === "number" && entry.durationSeconds > 0) {
    return { start, end: start + entry.durationSeconds * 1000 };
  }
  const minutes = Number(entry.duration);
  if (Number.isFinite(minutes) && minutes > 0) {
    return { start, end: start + minutes * 60 * 1000 };
  }
  return { start, end: now.getTime() };
}

function parseDayKey(value: string): { year: number; month: number; day: number } | null {
  const match = String(value).trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  return { year, month, day };
}

/** Inclusive start/end of the invoice period in the workspace timezone (IST). */
export function invoicePeriodBounds(periodStart?: string | null, periodEnd?: string | null) {
  const startDay = parseDayKey(String(periodStart ?? ""));
  const endDay = parseDayKey(String(periodEnd ?? ""));
  if (!startDay || !endDay) return null;
  const start = workZoneWallTimeToUtc(startDay.year, startDay.month, startDay.day, 0, 0, 0, 0);
  const end = workZoneWallTimeToUtc(endDay.year, endDay.month, endDay.day, 23, 59, 59, 999);
  if (end < start) return null;
  return { start, end };
}

/**
 * Seconds of a timer session that fall inside the invoice period.
 * Uses when the timer actually ran (clock in/out), not when the task was created.
 */
export function timeEntrySecondsInRange(
  entry: {
    clockIn?: Date | string | null;
    clockOut?: Date | string | null;
    createdAt?: Date | string | null;
    duration?: number | null;
    durationSeconds?: number | null;
  },
  rangeStart: Date,
  rangeEnd: Date,
  now: Date = new Date(),
): number {
  const interval = entryIntervalMs(entry, now);
  if (interval) {
    const overlapStart = Math.max(interval.start, rangeStart.getTime());
    const overlapEnd = Math.min(interval.end, rangeEnd.getTime());
    if (overlapEnd > overlapStart) {
      return Math.floor((overlapEnd - overlapStart) / 1000);
    }
  }
  return 0;
}

/** Hours to bill: logged time, then actualHours, then estimate. */
export function billableHoursFromTask(task: {
  actualHours?: string | number | null;
  estimatedHours?: string | number | null;
  trackedSeconds?: number | null;
}): number {
  const tracked = Number(task.trackedSeconds);
  if (Number.isFinite(tracked) && tracked > 0) return tracked / 3600;
  const actual = parseFloat(String(task.actualHours ?? ""));
  if (Number.isFinite(actual) && actual > 0) return actual;
  const estimated = parseFloat(String(task.estimatedHours ?? ""));
  if (Number.isFinite(estimated) && estimated > 0) return estimated;
  return 0;
}

export function roundInvoiceHours(hours: number): number {
  if (!Number.isFinite(hours) || hours <= 0) return 0;
  const rounded = Math.round(hours * 100) / 100;
  // Keep a billable sliver when tracked time is under 36 seconds.
  return rounded > 0 ? rounded : 0.01;
}

/** "10 hours", "1 hour 10 minutes", "2 hours 20 minutes". */
export function formatInvoiceTaskHours(hours: number): string {
  const totalMinutes = Math.round(Math.max(0, hours) * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  const hourPart = h === 1 ? "1 hour" : `${h} hours`;
  const minutePart = m === 1 ? "1 minute" : `${m} minutes`;
  if (totalMinutes === 0) return "0 hours";
  if (m === 0) return hourPart;
  if (h === 0) return minutePart;
  return `${hourPart} ${minutePart}`;
}

export function invoiceItemFromProjectTask(
  task: { id: number; title: string; hours: number },
  rate: number,
): InvoiceLineItem {
  const hours = roundInvoiceHours(task.hours);
  const title = task.title.trim() || `Task #${task.id}`;
  return {
    id: `task_${task.id}_${Math.random().toString(36).slice(2, 7)}`,
    itemDetails: title,
    quantity: hours,
    rate: Number.isFinite(rate) ? Math.max(0, rate) : 0,
    discountPercent: 0,
    taxPercent: 0,
  };
}

export const PROJECT_INVOICE_LINE_TITLE = "Design and developing";

export function invoiceItemFromProjectHours(
  hours: number,
  rate: number,
  title = PROJECT_INVOICE_LINE_TITLE,
  existingId?: string,
): InvoiceLineItem {
  return {
    id: existingId ?? `project_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    itemDetails: title.trim() || PROJECT_INVOICE_LINE_TITLE,
    quantity: roundInvoiceHours(hours),
    rate: Number.isFinite(rate) ? Math.max(0, rate) : 0,
    discountPercent: 0,
    taxPercent: 0,
  };
}
