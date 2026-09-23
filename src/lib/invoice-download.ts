import { jsPDF } from "jspdf";
import { amountInCurrencyWords } from "@/lib/amount-in-words";
import {
  formatCustomerBillingAddress,
  formatOrganizationAddress,
  formatOrganizationBankLines,
  resolveOrganizationProfileForInvoice,
  type OrganizationProfileForm,
} from "@/lib/organization-profile";
import {
  currencyPdfPrefix,
  currencySymbol,
  displayHsnSac,
  formatMoney,
  invoiceBalanceDue,
  invoicePaidAmount,
  invoiceStatusLabel,
  type InvoiceLineItem,
  type InvoiceRecord,
} from "@/lib/invoice-store";
import type { CustomerRecord } from "@/components/customers/NewCustomerForm";

const TERMS_LABEL: Record<string, string> = {
  due_on_receipt: "Due on Receipt",
  net_15: "Net 15",
  net_30: "Net 30",
  net_45: "Net 45",
  net_60: "Net 60",
};

const INK = { r: 33, g: 37, b: 41 };
const MUTED = { r: 90, g: 90, b: 90 };
const BORDER = { r: 180, g: 180, b: 180 };
const HEADER_BG = { r: 232, g: 232, b: 232 };

export type InvoiceCustomerLike = Pick<
  CustomerRecord,
  | "displayName"
  | "companyName"
  | "currency"
  | "billingAddress1"
  | "billingAddress2"
  | "billingCity"
  | "billingState"
  | "billingZip"
  | "billingCountry"
  | "gstNumber"
>;

export type InvoiceExportOptions = {
  customer?: InvoiceCustomerLike | null;
  /** When true, invoice date on the document is today's date. */
  useCurrentDate?: boolean;
  /**
   * Organization billing profile from the server (shared admin/finance tenant data).
   * Falls back to the local cache when omitted.
   */
  organization?: OrganizationProfileForm | null;
};

function formatInvoiceDate(value: string, useCurrentDate = false) {
  const date = useCurrentDate
    ? new Date()
    : value
      ? new Date(`${value}T00:00:00`)
      : new Date();
  if (Number.isNaN(date.getTime())) return value || "-";
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeFilename(value: string) {
  return (value || "invoice").replace(/[\\/:*?"<>|]+/g, "-").trim() || "invoice";
}

/** PDF-safe money (Helvetica cannot render ₹). */
function formatPdfAmount(value: number): string {
  const amount = Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function formatHtmlAmount(value: number): string {
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);
}

function asciiSafe(value: string) {
  return value
    .replace(/\u20B9/g, "Rs.")
    .replace(/\u2013|\u2014/g, "-")
    .replace(/\u2022/g, "-")
    .replace(/\u00A0/g, " ");
}

function lineTaxable(item: InvoiceLineItem): number {
  const base = item.quantity * item.rate;
  return Math.max(0, base * (1 - (item.discountPercent || 0) / 100));
}

function lineIgstAmount(item: InvoiceLineItem): number {
  return Math.max(0, (lineTaxable(item) * (item.taxPercent || 0)) / 100);
}

/** Prefer invoice-level Tax (IGST) over per-line tax %. */
function resolveLineIgstPercent(invoice: InvoiceRecord, item: InvoiceLineItem): number {
  if (invoice.taxMode === "none" && invoice.taxPercent > 0) return invoice.taxPercent;
  return item.taxPercent || 0;
}

function resolveLineIgstAmount(invoice: InvoiceRecord, item: InvoiceLineItem): number {
  return Math.max(0, (lineTaxable(item) * resolveLineIgstPercent(invoice, item)) / 100);
}

function computeTotals(invoice: InvoiceRecord) {
  const subTotal = invoice.items.reduce((sum, item) => sum + lineTaxable(item), 0);
  const lineIgstTotal = invoice.items.reduce((sum, item) => sum + lineIgstAmount(item), 0);
  // Invoice-level "Tax" mode applies as IGST on the taxable subtotal
  const invoiceIgst =
    invoice.taxMode === "none" && invoice.taxPercent > 0
      ? (subTotal * invoice.taxPercent) / 100
      : 0;
  const igstTotal = invoiceIgst > 0 ? invoiceIgst : lineIgstTotal;
  const igstPercent =
    invoiceIgst > 0
      ? invoice.taxPercent
      : invoice.items.length > 0
        ? invoice.items.reduce((s, i) => s + (i.taxPercent || 0), 0) / invoice.items.length
        : 0;
  const shipping = Number(invoice.shippingCharges) || 0;
  const adjustment = Number(invoice.adjustment) || 0;
  let total = subTotal + igstTotal + shipping + adjustment;
  if (invoice.taxMode === "tds" && invoice.taxPercent > 0) {
    total -= (subTotal * invoice.taxPercent) / 100;
  } else if (invoice.taxMode === "tcs" && invoice.taxPercent > 0) {
    total += (subTotal * invoice.taxPercent) / 100;
  }
  if (invoice.roundOff) total = Math.round(total);
  return {
    subTotal,
    igstTotal,
    igstPercent,
    shipping,
    adjustment,
    total: Math.max(0, total),
  };
}

function termsLabel(terms: string) {
  return TERMS_LABEL[terms] || terms || "-";
}

function customerDisplayName(
  customer: InvoiceCustomerLike | null | undefined,
  fallback: string,
  invoiceCurrency?: string,
) {
  if (!customer) return fallback || "-";
  const name = customer.displayName || customer.companyName || fallback || "-";
  const currency = invoiceCurrency || customer.currency || "INR";
  return `${name} (${currency})`;
}

function detectImageFormat(dataUrl: string): "PNG" | "JPEG" | "WEBP" | null {
  if (dataUrl.startsWith("data:image/png")) return "PNG";
  if (dataUrl.startsWith("data:image/jpeg") || dataUrl.startsWith("data:image/jpg")) {
    return "JPEG";
  }
  if (dataUrl.startsWith("data:image/webp")) return "WEBP";
  return null;
}

function loadImageElement(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load logo image"));
    img.src = dataUrl;
  });
}

function loadImageSize(dataUrl: string): Promise<{ width: number; height: number }> {
  return loadImageElement(dataUrl).then((img) => ({
    width: img.naturalWidth || img.width || 1,
    height: img.naturalHeight || img.height || 1,
  }));
}

/** Convert any browser-decodable image (PNG/JPEG/WebP/SVG) to a PNG data URL for jsPDF. */
async function toPdfCompatiblePngDataUrl(dataUrl: string): Promise<string> {
  const img = await loadImageElement(dataUrl);
  const width = Math.max(1, img.naturalWidth || img.width || 1);
  const height = Math.max(1, img.naturalHeight || img.height || 1);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not prepare logo for PDF");
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  return canvas.toDataURL("image/png");
}

/** Fit image into a max box while preserving aspect ratio (object-fit: contain). */
function fitWithinBox(
  naturalWidth: number,
  naturalHeight: number,
  maxWidth: number,
  maxHeight: number,
) {
  const ratio = naturalWidth / Math.max(naturalHeight, 1);
  let width = maxWidth;
  let height = width / ratio;
  if (height > maxHeight) {
    height = maxHeight;
    width = height * ratio;
  }
  return { width, height };
}

/** Typography helpers — cleaner hierarchy than scattered magic numbers. */
const FONT = {
  title: 24,
  orgName: 12,
  body: 9,
  small: 8,
  table: 8.5,
  tableHeader: 7.5,
  meta: 9,
  total: 10.5,
} as const;

export function buildInvoiceHtml(invoice: InvoiceRecord, options: InvoiceExportOptions = {}) {
  const org = resolveOrganizationProfileForInvoice(options.organization);
  const customer = options.customer;
  const useCurrentDate = options.useCurrentDate !== false;
  const totals = computeTotals(invoice);
  const currencyCode = invoice.currency || "INR";
  const moneySymbol = currencySymbol(currencyCode);
  const orgAddress = formatOrganizationAddress(org);
  const billToAddress = customer
    ? formatCustomerBillingAddress(customer)
    : [];
  const gstLabel = org.taxIdType || "GSTIN";
  const gstValue = org.taxIdValue?.trim();
  const bankLines = formatOrganizationBankLines(org);

  const rows = invoice.items
    .map((item, index) => {
      const taxable = lineTaxable(item);
      const igstPct = resolveLineIgstPercent(invoice, item);
      const igst = resolveLineIgstAmount(invoice, item);
      return `
      <tr>
        <td class="center">${index + 1}</td>
        <td>${escapeHtml(item.itemDetails || "-")}</td>
        <td class="center">${escapeHtml(displayHsnSac(invoice.hsnSac))}</td>
        <td class="num">${Number(item.quantity).toFixed(2)}</td>
        <td class="num">${escapeHtml(formatHtmlAmount(item.rate))}</td>
        <td class="num">${igstPct}%</td>
        <td class="num">${escapeHtml(formatHtmlAmount(igst))}</td>
        <td class="num">${escapeHtml(formatHtmlAmount(taxable))}</td>
      </tr>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(invoice.invoiceNumber)}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: "Segoe UI", "Helvetica Neue", Helvetica, Arial, sans-serif; color: #212529; margin: 0; padding: 16px; font-size: 12px; line-height: 1.45; -webkit-font-smoothing: antialiased; }
    .sheet { border: 1px solid #b4b4b4; padding: 18px 20px 16px; }
    .top { display: grid; grid-template-columns: 120px 1fr 120px; gap: 14px; align-items: start; }
    .logo-wrap { width: 110px; height: 72px; display: flex; align-items: center; justify-content: flex-start; }
    .logo { max-width: 110px; max-height: 72px; width: auto; height: auto; object-fit: contain; object-position: left center; }
    .org-name { font-size: 16px; font-weight: 700; margin: 0 0 4px; letter-spacing: 0.01em; }
    .org-meta { color: #444; line-height: 1.5; font-size: 11.5px; }
    .invoice-title { font-size: 30px; font-weight: 700; text-align: right; margin: 0; letter-spacing: -0.02em; }
    .divider { border: none; border-top: 1px solid #b4b4b4; margin: 14px 0; }
    .details { display: grid; grid-template-columns: 110px 1fr; gap: 4px 10px; width: 360px; }
    .details .label { color: #555; }
    .details .value { font-weight: 600; }
    .bill-bar { background: #e8e8e8; padding: 6px 10px; font-weight: 700; margin-top: 12px; border: 1px solid #cfcfcf; }
    .bill-body { padding: 10px 4px 4px; line-height: 1.45; }
    .bill-name { font-weight: 700; margin-bottom: 4px; }
    table.items { width: 100%; border-collapse: collapse; margin-top: 14px; }
    table.items th, table.items td { border: 1px solid #cfcfcf; padding: 7px 8px; vertical-align: top; }
    table.items th { background: #e8e8e8; font-size: 11px; font-weight: 700; }
    .num { text-align: right; white-space: nowrap; }
    .center { text-align: center; }
    .bottom { display: grid; grid-template-columns: 1.2fr 0.9fr; gap: 18px; margin-top: 14px; }
    .words { font-style: italic; margin-top: 4px; }
    .section-label { font-weight: 700; margin-top: 12px; }
    .notes, .bank { white-space: pre-wrap; line-height: 1.45; }
    .totals { width: 100%; border-collapse: collapse; }
    .totals td { padding: 4px 0; }
    .totals .num { font-weight: 600; }
    .totals .grand td { font-weight: 700; font-size: 13px; padding-top: 8px; border-top: 1px solid #cfcfcf; }
    .totals .paid td { color: #dc2626; font-weight: 600; }
    .totals .balance td { font-weight: 700; font-size: 13px; }
    @media print {
      body { padding: 0; }
      @page { margin: 10mm; }
    }
  </style>
</head>
<body>
  <div class="sheet">
    <div class="top">
      <div class="logo-wrap">${
        org.logoDataUrl?.trim().startsWith("data:image/")
          ? `<img class="logo" src="${org.logoDataUrl.replace(/"/g, "%22")}" alt="Logo" />`
          : ""
      }</div>
      <div>
        <div class="org-name">${escapeHtml(org.name || "Organization")}</div>
        <div class="org-meta">
          ${orgAddress.map((line) => escapeHtml(line)).join("<br/>")}
          ${gstValue ? `<br/>${escapeHtml(gstLabel)} ${escapeHtml(gstValue)}` : ""}
        </div>
      </div>
      <h1 class="invoice-title">Invoice</h1>
    </div>
    <hr class="divider" />
    <div class="details">
      <div class="label">#</div><div class="value">${escapeHtml(invoice.invoiceNumber)}</div>
      <div class="label">Invoice Date</div><div class="value">${escapeHtml(formatInvoiceDate(invoice.invoiceDate, useCurrentDate))}</div>
      ${
        invoice.periodStart && invoice.periodEnd
          ? `<div class="label">Period</div><div class="value">${escapeHtml(
              `${formatInvoiceDate(invoice.periodStart, false)} – ${formatInvoiceDate(invoice.periodEnd, false)}`,
            )}</div>`
          : ""
      }
      <div class="label">Terms</div><div class="value">${escapeHtml(termsLabel(invoice.terms))}</div>
      <div class="label">Due Date</div><div class="value">${escapeHtml(formatInvoiceDate(invoice.dueDate, false))}</div>
      <div class="label">Payment Status</div><div class="value">${escapeHtml(invoiceStatusLabel(invoice.status))}</div>
    </div>
    <div class="bill-bar">Bill To</div>
    <div class="bill-body">
      <div class="bill-name">${escapeHtml(customerDisplayName(customer, invoice.customerName, currencyCode))}</div>
      ${billToAddress.map((line) => escapeHtml(line)).join("<br/>") || "-"}
    </div>
    <table class="items">
      <thead>
        <tr>
          <th style="width:28px">#</th>
          <th>Item &amp; Description</th>
          <th style="width:70px">HSN/SAC</th>
          <th style="width:70px">Qty (Hours)</th>
          <th style="width:80px">Rate</th>
          <th style="width:50px">IGST %</th>
          <th style="width:70px">IGST Amt</th>
          <th style="width:90px">Amount</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="bottom">
      <div>
        <div><strong>Total In Words:</strong></div>
        <div class="words">${escapeHtml(amountInCurrencyWords(totals.total, currencyCode))}</div>
        ${
          invoice.customerNotes?.trim()
            ? `<div class="section-label">Notes</div><div class="notes">${escapeHtml(invoice.customerNotes)}</div>`
            : ""
        }
        ${
          bankLines.length > 0
            ? `<div class="section-label">Bank Details:</div>
        <div class="bank">
${bankLines.map((line) => escapeHtml(line)).join("\n")}
        </div>`
            : ""
        }
      </div>
      <div>
        <table class="totals">
          <tr><td>Sub Total</td><td class="num">${escapeHtml(moneySymbol)}${escapeHtml(formatHtmlAmount(totals.subTotal))}</td></tr>
          <tr><td>IGST (${escapeHtml(String(totals.igstPercent || 0))}%)</td><td class="num">${escapeHtml(moneySymbol)}${escapeHtml(formatHtmlAmount(totals.igstTotal))}</td></tr>
          ${
            totals.shipping
              ? `<tr><td>Shipping</td><td class="num">${escapeHtml(moneySymbol)}${escapeHtml(formatHtmlAmount(totals.shipping))}</td></tr>`
              : ""
          }
          ${
            totals.adjustment
              ? `<tr><td>Adjustment</td><td class="num">${escapeHtml(moneySymbol)}${escapeHtml(formatHtmlAmount(totals.adjustment))}</td></tr>`
              : ""
          }
          <tr class="grand"><td>Total</td><td class="num">${escapeHtml(formatMoney(totals.total, currencyCode))}</td></tr>
          ${
            invoicePaidAmount(invoice) > 0
              ? `<tr class="paid text-semibold"><td>Payment Made</td><td class="num text-semibold">(-) ${escapeHtml(formatHtmlAmount(invoicePaidAmount(invoice)))}</td></tr>
          <tr class="balance"><td>Balance Due</td><td class="num">${escapeHtml(formatMoney(invoiceBalanceDue(invoice), currencyCode))}</td></tr>`
              : `<tr class="grand"><td>Balance Due</td><td class="num">${escapeHtml(formatMoney(invoiceBalanceDue(invoice), currencyCode))}</td></tr>`
          }
        </table>
      </div>
    </div>
  </div>
</body>
</html>`;
}

function ensurePageSpace(doc: jsPDF, y: number, needed = 20): number {
  const pageHeight = doc.internal.pageSize.getHeight();
  if (y + needed > pageHeight - 14) {
    doc.addPage();
    return 16;
  }
  return y;
}

/** Downloads a Zoho-style invoice PDF. */
export async function downloadInvoiceAsPdf(
  invoice: InvoiceRecord,
  options: InvoiceExportOptions = {},
) {
  const org = resolveOrganizationProfileForInvoice(options.organization);
  const customer = options.customer;
  const useCurrentDate = options.useCurrentDate !== false;
  const totals = computeTotals(invoice);
  const currencyCode = invoice.currency || "INR";
  const bankLines = formatOrganizationBankLines(org);

  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 12;
  const contentWidth = pageWidth - margin * 2;
  let y = margin;

  // Outer border
  doc.setDrawColor(BORDER.r, BORDER.g, BORDER.b);
  doc.setLineWidth(0.3);
  doc.rect(margin - 2, margin - 2, contentWidth + 4, doc.internal.pageSize.getHeight() - margin * 2 + 4);

  // Logo — preserve original aspect ratio (no stretch)
  const logoMaxW = 32;
  const logoMaxH = 20;
  let logoDrawn = false;
  let logoDrawW = 0;
  const logoSrc = org.logoDataUrl?.trim() ?? "";
  if (logoSrc.startsWith("data:image/")) {
    try {
      const format = detectImageFormat(logoSrc);
      // Native PNG/JPEG when possible; otherwise rasterize (SVG/WebP/etc.) to PNG.
      const pdfImage =
        format === "PNG" || format === "JPEG"
          ? logoSrc
          : await toPdfCompatiblePngDataUrl(logoSrc);
      const pdfFormat = format === "JPEG" ? "JPEG" : "PNG";
      const { width: nw, height: nh } = await loadImageSize(pdfImage);
      const fitted = fitWithinBox(nw, nh, logoMaxW, logoMaxH);
      logoDrawW = fitted.width;
      const logoY = y + Math.max(0, (logoMaxH - fitted.height) / 2);
      doc.addImage(pdfImage, pdfFormat, margin, logoY, fitted.width, fitted.height);
      logoDrawn = true;
    } catch {
      logoDrawn = false;
    }
  }

  // Org details (to the right of logo)
  const orgX = margin + (logoDrawn ? logoDrawW + 6 : 0);
  const orgMaxWidth = pageWidth - margin - 42 - orgX;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(FONT.orgName);
  doc.setTextColor(INK.r, INK.g, INK.b);
  doc.text(asciiSafe(org.name || "Organization"), orgX, y + 5);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(FONT.small);
  doc.setTextColor(MUTED.r, MUTED.g, MUTED.b);
  let orgY = y + 10;
  for (const line of formatOrganizationAddress(org)) {
    const wrapped = doc.splitTextToSize(asciiSafe(line), Math.max(orgMaxWidth, 60));
    doc.text(wrapped, orgX, orgY);
    orgY += wrapped.length * 3.8;
  }
  if (org.taxIdValue?.trim()) {
    doc.setFont("helvetica", "bold");
    doc.text(
      asciiSafe(`${org.taxIdType || "GSTIN"} ${org.taxIdValue.trim()}`),
      orgX,
      orgY,
    );
    orgY += 3.8;
    doc.setFont("helvetica", "normal");
  }

  // Invoice title
  doc.setFont("helvetica", "bold");
  doc.setFontSize(FONT.title);
  doc.setTextColor(INK.r, INK.g, INK.b);
  doc.text("Invoice", pageWidth - margin, y + 9, { align: "right" });

  y = Math.max(y + logoMaxH + 6, orgY + 3);
  doc.setDrawColor(BORDER.r, BORDER.g, BORDER.b);
  doc.setLineWidth(0.25);
  doc.line(margin, y, pageWidth - margin, y);
  y += 8;

  // Invoice meta
  const metaRows: Array<[string, string]> = [
    ["#", asciiSafe(invoice.invoiceNumber)],
    ["Invoice Date", formatInvoiceDate(invoice.invoiceDate, useCurrentDate)],
    ...(invoice.periodStart && invoice.periodEnd
      ? [
          [
            "Period",
            `${formatInvoiceDate(invoice.periodStart, false)} - ${formatInvoiceDate(invoice.periodEnd, false)}`,
          ] as [string, string],
        ]
      : []),
    ["Terms", asciiSafe(termsLabel(invoice.terms))],
    ["Due Date", formatInvoiceDate(invoice.dueDate, false)],
    ["Payment Status", asciiSafe(invoiceStatusLabel(invoice.status))],
  ];
  doc.setFontSize(FONT.meta);
  metaRows.forEach(([label, value], i) => {
    const rowY = y + i * 5.4;
    doc.setFont("helvetica", "normal");
    doc.setTextColor(MUTED.r, MUTED.g, MUTED.b);
    doc.text(label, margin, rowY);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(INK.r, INK.g, INK.b);
    doc.text(value, margin + 28, rowY);
  });
  y += metaRows.length * 5.4 + 4;

  // Bill To bar
  doc.setFillColor(HEADER_BG.r, HEADER_BG.g, HEADER_BG.b);
  doc.rect(margin, y, contentWidth, 7, "F");
  doc.setDrawColor(BORDER.r, BORDER.g, BORDER.b);
  doc.rect(margin, y, contentWidth, 7);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(FONT.body);
  doc.setTextColor(INK.r, INK.g, INK.b);
  doc.text("Bill To", margin + 2.5, y + 4.8);
  y += 11;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(FONT.body + 0.5);
  doc.text(asciiSafe(customerDisplayName(customer, invoice.customerName, currencyCode)), margin + 1, y);
  y += 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(FONT.body);
  doc.setTextColor(MUTED.r, MUTED.g, MUTED.b);
  const billLines = customer ? formatCustomerBillingAddress(customer) : [];
  if (billLines.length === 0) {
    doc.text("-", margin + 1, y);
    y += 5;
  } else {
    for (const line of billLines) {
      doc.text(asciiSafe(line), margin + 1, y);
      y += 4.2;
    }
  }
  y += 4;

  // Table header
  const cols = [
    { key: "#", w: 8, align: "center" as const },
    { key: "Item & Description", w: 58, align: "left" as const },
    { key: "HSN/SAC", w: 18, align: "center" as const },
    { key: "Qty (Hours)", w: 14, align: "right" as const },
    { key: "Rate", w: 22, align: "right" as const },
    { key: "IGST %", w: 14, align: "right" as const },
    { key: "IGST Amt", w: 20, align: "right" as const },
    { key: "Amount", w: 24, align: "right" as const },
  ];
  // Adjust last column to fill width
  const used = cols.reduce((s, c) => s + c.w, 0);
  cols[cols.length - 1]!.w += contentWidth - used;

  const drawTableHeader = (atY: number) => {
    doc.setFillColor(HEADER_BG.r, HEADER_BG.g, HEADER_BG.b);
    doc.rect(margin, atY, contentWidth, 7, "F");
    doc.setDrawColor(BORDER.r, BORDER.g, BORDER.b);
    doc.rect(margin, atY, contentWidth, 7);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(FONT.tableHeader);
    doc.setTextColor(INK.r, INK.g, INK.b);
    let x = margin;
    cols.forEach((col) => {
      const textX =
        col.align === "left" ? x + 1.5 : col.align === "center" ? x + col.w / 2 : x + col.w - 1.5;
      doc.text(col.key, textX, atY + 4.6, { align: col.align });
      doc.line(x, atY, x, atY + 7);
      x += col.w;
    });
    doc.line(margin + contentWidth, atY, margin + contentWidth, atY + 7);
  };

  drawTableHeader(y);
  y += 7;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(FONT.table);

  invoice.items.forEach((item, index) => {
    const taxable = lineTaxable(item);
    const igstPct = resolveLineIgstPercent(invoice, item);
    const igst = resolveLineIgstAmount(invoice, item);
    const itemLines = doc.splitTextToSize(asciiSafe(item.itemDetails || "-"), cols[1]!.w - 3);
    const rowHeight = Math.max(8, itemLines.length * 3.8 + 3);
    y = ensurePageSpace(doc, y, rowHeight + 2);
    if (y === 16) {
      drawTableHeader(y);
      y += 7;
    }

    const values = [
      String(index + 1),
      itemLines,
      displayHsnSac(invoice.hsnSac),
      Number(item.quantity).toFixed(2),
      formatPdfAmount(item.rate),
      `${igstPct}%`,
      formatPdfAmount(igst),
      formatPdfAmount(taxable),
    ];

    doc.setDrawColor(BORDER.r, BORDER.g, BORDER.b);
    doc.rect(margin, y, contentWidth, rowHeight);
    let x = margin;
    values.forEach((value, i) => {
      const col = cols[i]!;
      doc.line(x, y, x, y + rowHeight);
      const textY = y + 4.5;
      if (i === 1) {
        doc.setTextColor(INK.r, INK.g, INK.b);
        doc.text(value as string[], x + 1.5, textY);
      } else {
        const textX =
          col.align === "left"
            ? x + 1.5
            : col.align === "center"
              ? x + col.w / 2
              : x + col.w - 1.5;
        doc.setTextColor(INK.r, INK.g, INK.b);
        doc.text(String(value), textX, textY, { align: col.align });
      }
      x += col.w;
    });
    doc.line(margin + contentWidth, y, margin + contentWidth, y + rowHeight);
    y += rowHeight;
  });

  y += 8;
  y = ensurePageSpace(doc, y, 70);

  const leftWidth = contentWidth * 0.58;
  const rightX = margin + leftWidth + 6;
  const rightWidth = contentWidth - leftWidth - 6;
  let leftY = y;
  let rightY = y;

  // Total in words
  doc.setFont("helvetica", "bold");
  doc.setFontSize(FONT.body);
  doc.setTextColor(INK.r, INK.g, INK.b);
  doc.text("Total In Words:", margin, leftY);
  leftY += 5;
  doc.setFont("times", "italic");
  doc.setFontSize(FONT.body);
  const words = doc.splitTextToSize(
    asciiSafe(amountInCurrencyWords(totals.total, currencyCode)),
    leftWidth,
  );
  doc.text(words, margin, leftY);
  leftY += words.length * 4 + 4;

  if (invoice.customerNotes?.trim()) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(FONT.body);
    doc.text("Notes", margin, leftY);
    leftY += 4.5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(FONT.small + 0.5);
    const noteLines = doc.splitTextToSize(asciiSafe(invoice.customerNotes), leftWidth);
    doc.text(noteLines, margin, leftY);
    leftY += noteLines.length * 3.8 + 4;
  }

  if (bankLines.length > 0) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(FONT.body);
    doc.text("Bank Details:", margin, leftY);
    leftY += 5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(FONT.small + 0.5);
    bankLines.forEach((line) => {
      doc.text(asciiSafe(line), margin, leftY);
      leftY += 4.1;
    });
  }

  // Totals
  const pdfMoney = (value: number) => {
    const symbol = currencyPdfPrefix(currencyCode).trimEnd();
    const amount = formatPdfAmount(value);
    // Keep symbol tight against amount for $ / A$ style; space after letter codes
    const needsSpace = /[A-Za-z.]$/.test(symbol);
    return `${symbol}${needsSpace ? " " : ""}${amount}`;
  };
  const summaryRows: Array<[string, string, boolean?]> = [
    ["Sub Total", pdfMoney(totals.subTotal)],
    [`IGST (${totals.igstPercent || 0}%)`, pdfMoney(totals.igstTotal)],
  ];
  if (totals.shipping) summaryRows.push(["Shipping", pdfMoney(totals.shipping)]);
  if (totals.adjustment) summaryRows.push(["Adjustment", pdfMoney(totals.adjustment)]);
  summaryRows.push(["Total", pdfMoney(totals.total), true]);
  const paidAmount = invoicePaidAmount(invoice);
  if (paidAmount > 0) {
    summaryRows.push(["Payment Made", `(-) ${formatPdfAmount(paidAmount)}`, false]);
  }
  summaryRows.push(["Balance Due", pdfMoney(invoiceBalanceDue(invoice)), true]);

  summaryRows.forEach(([label, value, bold]) => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(bold ? FONT.total : FONT.body);
    if (label === "Payment Made") {
      doc.setTextColor(220, 38, 38);
    } else {
      doc.setTextColor(INK.r, INK.g, INK.b);
    }
    doc.text(label, rightX, rightY);
    doc.text(value, rightX + rightWidth, rightY, { align: "right" });
    rightY += bold ? 6.5 : 5.5;
  });

  doc.save(`${safeFilename(invoice.invoiceNumber)}.pdf`);
}

export function printInvoice(invoice: InvoiceRecord, options: InvoiceExportOptions = {}) {
  const html = buildInvoiceHtml(invoice, options);
  const iframe = document.createElement("iframe");
  iframe.setAttribute("title", `Print ${invoice.invoiceNumber}`);
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  iframe.style.opacity = "0";
  iframe.style.pointerEvents = "none";
  document.body.appendChild(iframe);

  const frameWindow = iframe.contentWindow;
  const frameDoc = frameWindow?.document;
  if (!frameWindow || !frameDoc) {
    document.body.removeChild(iframe);
    window.alert("Unable to open the print preview. Please try again.");
    return;
  }

  frameDoc.open();
  frameDoc.write(html);
  frameDoc.close();

  const cleanup = () => iframe.remove();
  const triggerPrint = () => {
    try {
      frameWindow.focus();
      frameWindow.print();
    } finally {
      window.setTimeout(cleanup, 1000);
    }
  };

  if (frameDoc.readyState === "complete") {
    window.setTimeout(triggerPrint, 150);
  } else {
    iframe.onload = () => window.setTimeout(triggerPrint, 150);
  }
}

/** Downloads the HTML invoice preview as a PDF so the file matches on-screen preview. */
export async function downloadInvoicePreviewAsPdf(
  invoice: InvoiceRecord,
  options: InvoiceExportOptions = {},
) {
  const html = buildInvoiceHtml(invoice, options);
  const iframe = document.createElement("iframe");
  iframe.setAttribute("title", `Download ${invoice.invoiceNumber}`);
  iframe.style.position = "fixed";
  iframe.style.left = "-10000px";
  iframe.style.top = "0";
  iframe.style.width = "210mm";
  iframe.style.height = "297mm";
  iframe.style.border = "0";
  iframe.style.opacity = "0";
  iframe.style.pointerEvents = "none";
  document.body.appendChild(iframe);

  const frameDoc = iframe.contentWindow?.document;
  if (!frameDoc) {
    iframe.remove();
    await downloadInvoiceAsPdf(invoice, options);
    return;
  }

  frameDoc.open();
  frameDoc.write(html);
  frameDoc.close();

  try {
    await new Promise<void>((resolve) => {
      const started = Date.now();
      const tick = () => {
        const images = [...(frameDoc.images ?? [])];
        const ready = images.length === 0 || images.every((image) => image.complete);
        if (ready || Date.now() - started > 4000) {
          resolve();
          return;
        }
        window.setTimeout(tick, 80);
      };
      window.setTimeout(tick, 120);
    });

    const { default: html2canvas } = await import("html2canvas");
    const target = frameDoc.body;
    const canvas = await html2canvas(target, {
      scale: 2,
      useCORS: true,
      backgroundColor: "#ffffff",
      windowWidth: target.scrollWidth,
      windowHeight: target.scrollHeight,
    });
    const imgData = canvas.toDataURL("image/png");
    const pdf = new jsPDF({ unit: "mm", format: "a4" });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const imgWidth = pageWidth;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;
    let heightLeft = imgHeight;
    let position = 0;
    pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;
    while (heightLeft > 2) {
      position = heightLeft - imgHeight;
      pdf.addPage();
      pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
    }
    pdf.save(`${safeFilename(invoice.invoiceNumber)}.pdf`);
  } catch {
    await downloadInvoiceAsPdf(invoice, options);
  } finally {
    iframe.remove();
  }
}

export function downloadInvoiceAsCsv(invoice: InvoiceRecord) {
  const headers = [
    "Invoice Number",
    "Customer",
    "Invoice Date",
    "Due Date",
    "Status",
    "Item",
    "HSN/SAC",
    "Quantity",
    "Rate",
    "Discount %",
    "Tax %",
    "Taxable Amount",
    "IGST Amount",
    "Total",
  ];
  const totals = computeTotals(invoice);
  const lines = invoice.items.map((item) =>
    [
      invoice.invoiceNumber,
      invoice.customerName,
      invoice.invoiceDate,
      invoice.dueDate,
      invoiceStatusLabel(invoice.status),
      item.itemDetails,
      displayHsnSac(invoice.hsnSac),
      item.quantity,
      item.rate,
      item.discountPercent,
      item.taxPercent,
      lineTaxable(item).toFixed(2),
      lineIgstAmount(item).toFixed(2),
      totals.total.toFixed(2),
    ]
      .map((value) => `"${String(value).replace(/"/g, '""')}"`)
      .join(","),
  );
  const csv = [headers.join(","), ...lines].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${safeFilename(invoice.invoiceNumber)}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
