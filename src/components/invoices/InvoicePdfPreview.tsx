import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileText } from "lucide-react";
import {
  buildInvoiceHtml,
  type InvoiceCustomerLike,
  type InvoiceExportOptions,
} from "@/lib/invoice-download";
import type { InvoiceRecord } from "@/lib/invoice-store";
import { cn } from "@/lib/utils";
import { useOrganizationBillingProfile } from "@/hooks/useOrganizationBillingProfile";
import type { OrganizationProfileForm } from "@/lib/organization-profile";

/** Desktop A4 width at 96dpi. Preview is scaled down on narrow screens; download stays this size. */
const A4_WIDTH_PX = 794;
const MIN_PAGE_HEIGHT_PX = 720;

type InvoicePdfPreviewProps = {
  invoice: InvoiceRecord | null;
  customer?: InvoiceCustomerLike | null;
  useCurrentDate?: boolean;
  className?: string;
  title?: string;
  /** Optional override; defaults to the server organization billing profile. */
  organization?: OrganizationProfileForm | null;
};

export function InvoicePdfPreview({
  invoice,
  customer = null,
  useCurrentDate = true,
  className,
  title = "PDF Preview",
  organization = null,
}: InvoicePdfPreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [pageHeight, setPageHeight] = useState(MIN_PAGE_HEIGHT_PX);
  const { profile: serverOrg } = useOrganizationBillingProfile({
    enabled: organization == null,
  });
  const resolvedOrg = organization ?? serverOrg;

  const options: InvoiceExportOptions = useMemo(
    () => ({ customer, useCurrentDate, organization: resolvedOrg }),
    [customer, useCurrentDate, resolvedOrg],
  );

  const html = useMemo(() => {
    if (!invoice) return null;
    try {
      return buildInvoiceHtml(invoice, options);
    } catch {
      return null;
    }
  }, [invoice, options]);

  const syncScale = useCallback(() => {
    const el = viewportRef.current;
    if (!el) return;
    const width = el.clientWidth;
    if (width <= 0) return;
    setScale(Math.min(1, width / A4_WIDTH_PX));
  }, []);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => syncScale());
    observer.observe(el);
    syncScale();
    return () => observer.disconnect();
  }, [html, syncScale]);

  useEffect(() => {
    const frame = iframeRef.current;
    if (!frame || !html) return;
    const doc = frame.contentDocument;
    if (!doc) return;
    doc.open();
    doc.write(html);
    doc.close();

    const measure = () => {
      const next = Math.max(
        doc.body?.scrollHeight ?? 0,
        doc.documentElement?.scrollHeight ?? 0,
        MIN_PAGE_HEIGHT_PX,
      );
      setPageHeight(next);
      syncScale();
    };

    const timer = window.setTimeout(measure, 50);
    frame.onload = measure;
    return () => {
      window.clearTimeout(timer);
      frame.onload = null;
    };
  }, [html, syncScale]);

  return (
    <div
      className={cn(
        "flex min-w-0 max-w-full flex-col overflow-hidden rounded-xl border border-gray-200 bg-gray-100 min-h-[420px]",
        className,
      )}
    >
      <div className="shrink-0 px-4 py-2.5 bg-white border-b border-gray-200 flex items-center gap-2">
        <FileText size={14} className="text-[#2563EB]" />
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-600">
          {title}
        </span>
      </div>
      <div className="min-h-0 min-w-0 flex-1 overflow-auto overflow-x-hidden bg-[#e5e7eb] p-3 sm:p-4">
        {html ? (
          <div ref={viewportRef} className="mx-auto w-full min-w-0 max-w-full">
            <div
              className="mx-auto overflow-hidden rounded-sm bg-white shadow-md"
              style={{
                width: A4_WIDTH_PX * scale,
                height: pageHeight * scale,
              }}
            >
              <iframe
                ref={iframeRef}
                title={title}
                className="border-0 bg-white"
                style={{
                  width: A4_WIDTH_PX,
                  height: pageHeight,
                  transform: `scale(${scale})`,
                  transformOrigin: "top left",
                }}
              />
            </div>
          </div>
        ) : (
          <div className="h-full min-h-[280px] flex flex-col items-center justify-center text-center px-6 text-gray-500">
            <FileText size={28} className="text-gray-300 mb-2" />
            <p className="text-sm font-medium">Preview unavailable</p>
            <p className="text-xs mt-1">
              Select a customer and add line items to see the invoice preview.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
