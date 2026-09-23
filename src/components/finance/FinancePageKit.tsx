import type { ReactNode } from "react";
import { Link } from "react-router";
import { Loader2, Plus, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/invoice-store";

export function FinancePageHeader({
  title,
  description,
  icon: Icon,
  onCreate,
  createLabel = "Add new",
  extra,
}: {
  title: string;
  description: string;
  icon: LucideIcon;
  onCreate?: () => void;
  createLabel?: string;
  extra?: ReactNode;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
      <div className="flex items-start gap-3 min-w-0">
        <div className="w-10 h-10 rounded-xl bg-blue-50 text-[#2563EB] flex items-center justify-center shrink-0">
          <Icon size={20} />
        </div>
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-[#1F2937]">{title}</h1>
          <p className="text-sm text-gray-500 mt-0.5">{description}</p>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {extra}
        {onCreate ? (
          <Button
            type="button"
            onClick={onCreate}
            className="bg-[#2563EB] hover:bg-[#1D4ED8] gap-1.5"
          >
            <Plus size={16} />
            {createLabel}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function FinanceEmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl py-16 px-6 text-center">
      <div className="w-12 h-12 rounded-xl bg-gray-50 text-gray-400 flex items-center justify-center mx-auto mb-3">
        <Icon size={22} />
      </div>
      <h2 className="text-base font-semibold text-gray-800">{title}</h2>
      <p className="text-sm text-gray-500 mt-1 max-w-md mx-auto">{description}</p>
      {onAction && actionLabel ? (
        <Button
          type="button"
          onClick={onAction}
          className="mt-4 bg-[#2563EB] hover:bg-[#1D4ED8] gap-1.5"
        >
          <Plus size={16} />
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}

export function FinanceLoading() {
  return (
    <div className="flex items-center justify-center min-h-[40vh]">
      <Loader2 className="w-8 h-8 animate-spin text-[#2563EB]" />
    </div>
  );
}

export function FinanceMoney({
  value,
  currency = "INR",
  className = "",
}: {
  value: number;
  currency?: string;
  className?: string;
}) {
  return <span className={className}>{formatMoney(value, currency)}</span>;
}

export function FinanceBackLink() {
  return (
    <Link to="/" className="text-sm text-[#2563EB] hover:underline mb-3 inline-block">
      ← Back to dashboard
    </Link>
  );
}

export function StatusBadge({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: "neutral" | "success" | "warning" | "danger" | "info";
}) {
  const styles = {
    neutral: "bg-gray-100 text-gray-600",
    success: "bg-emerald-50 text-emerald-700",
    warning: "bg-amber-50 text-amber-700",
    danger: "bg-red-50 text-red-600",
    info: "bg-blue-50 text-blue-700",
  }[tone];
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold capitalize ${styles}`}>
      {label}
    </span>
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-gray-600">{label}</span>
      {children}
    </label>
  );
}

export const inputClass =
  "w-full h-10 px-3 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]";

export const selectClass = inputClass;
