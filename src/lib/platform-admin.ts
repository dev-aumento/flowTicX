import type { SubscriptionPlan, SubscriptionStatus } from "@db/mongo/types";
import {
  defaultEntitlement,
  deriveFeatureKeys,
  type PlanLimits,
} from "@/lib/plan-entitlements";

export type PlatformUser = {
  role?: string | null;
};

export function isPlatformUser(user: PlatformUser | null | undefined) {
  return String(user?.role ?? "").toLowerCase() === "platform";
}

export type PlanFeature = {
  key: string;
  label: string;
  description: string;
};

/** Product areas that can be turned on per subscription plan. */
export const PLAN_FEATURE_CATALOG: PlanFeature[] = [
  { key: "projects", label: "Projects", description: "Create and manage delivery projects" },
  { key: "tasks", label: "Tasks & workflows", description: "Task boards, assignees, and activity" },
  { key: "time_tracking", label: "Time tracking", description: "Clock-in, timesheets, and hours" },
  { key: "invoices", label: "Invoices", description: "Create and send customer invoices" },
  { key: "customers", label: "Customers", description: "Customer directory and billing contacts" },
  { key: "employees", label: "Employees", description: "Team directory and HR profiles" },
  { key: "leave", label: "Leave management", description: "Leave requests and balances" },
  { key: "attendance", label: "Attendance", description: "Daily attendance and locations" },
  { key: "analytics", label: "Analytics", description: "Workspace reports and insights" },
  { key: "finance", label: "Finance module", description: "Payments, expenses, and ledgers" },
  { key: "client_portal", label: "Client portal", description: "Asana-style client workspace" },
  { key: "files", label: "Files", description: "Attachments and workspace files" },
  { key: "meetings", label: "Meetings", description: "Meeting notes and events" },
  { key: "permissions", label: "Roles & permissions", description: "Fine-grained access control" },
];

export type PlanBillingInterval = "month" | "year";
export type PlanDisplayCurrency = "INR" | "USD";

export type PlatformPlan = {
  id?: number;
  slug: string;
  name: string;
  /** Price in INR for this billing period. */
  amount: number;
  /** Price in USD for this billing period. */
  amountUsd: number;
  billingInterval: PlanBillingInterval;
  description: string;
  durationDays: number;
  featureKeys: string[];
  sortOrder: number;
  limits: PlanLimits;
  highlightKeys: string[];
  badge: string | null;
  ctaLabel: string;
  storageLabel: string | null;
  entitlementsConfigured: boolean;
};

function catalogPlan(
  slug: string,
  name: string,
  amount: number,
  description: string,
  sortOrder: number,
): PlatformPlan {
  const entitlement = defaultEntitlement(slug);
  return {
    slug,
    name,
    amount,
    amountUsd: 0,
    billingInterval: "month",
    description,
    durationDays: 30,
    featureKeys: deriveFeatureKeys(entitlement.highlightKeys, entitlement.limits),
    sortOrder,
    limits: entitlement.limits,
    highlightKeys: entitlement.highlightKeys,
    badge: entitlement.badge,
    ctaLabel: entitlement.ctaLabel,
    storageLabel: entitlement.storageLabel,
    entitlementsConfigured: true,
  };
}

export const DEFAULT_PLATFORM_PLANS: PlatformPlan[] = [
  catalogPlan("trial", "Free", 0, "For freelancers and small teams exploring AASO", 1),
  catalogPlan("starter", "Starter", 2_783, "For boutique service agencies and growing consultancies", 2),
  catalogPlan("growth", "Growth", 5_662, "For scaling firms requiring pipeline automation and client billing", 3),
  catalogPlan("business", "Business", 9_501, "For established multi-team agencies and operational leaders", 4),
  catalogPlan("enterprise", "Enterprise", 19_098, "For high-throughput organizations with strict security needs", 5),
];

/** @deprecated Prefer catalog amount from saved plans. */
export const PLATFORM_PLANS = DEFAULT_PLATFORM_PLANS;
export const PLATFORM_PLAN_AMOUNT: Record<string, number> = Object.fromEntries(
  DEFAULT_PLATFORM_PLANS.map((plan) => [plan.slug, plan.amount]),
);

export function formatInr(amount: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatUsd(amount: number) {
  const hasCents = Math.round(amount * 100) % 100 !== 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: hasCents ? 2 : 0,
  }).format(amount);
}

export function formatPlanMoney(amount: number, currency: PlanDisplayCurrency) {
  return currency === "USD" ? formatUsd(amount) : formatInr(amount);
}

export function planBillingInterval(plan: {
  billingInterval?: string | null;
  durationDays?: number | null;
}): PlanBillingInterval {
  if (plan.billingInterval === "year" || plan.billingInterval === "month") {
    return plan.billingInterval;
  }
  const days = plan.durationDays ?? 30;
  return days > 0 && days % 365 === 0 ? "year" : "month";
}

export function durationDaysForInterval(interval: PlanBillingInterval) {
  return interval === "year" ? 365 : 30;
}

export function planIntervalLabel(interval: PlanBillingInterval) {
  return interval === "year" ? "Yearly" : "Monthly";
}

export function planChoiceLabel(plan: {
  name: string;
  billingInterval?: string | null;
  durationDays?: number | null;
}) {
  return `${plan.name} · ${planIntervalLabel(planBillingInterval(plan))}`;
}

export function planPriceForCurrency(
  plan: { amount: number; amountUsd?: number | null },
  currency: PlanDisplayCurrency,
) {
  return currency === "USD" ? plan.amountUsd ?? 0 : plan.amount;
}

/** India (IST or an Indian locale) sees INR. Everyone else sees USD. */
export function detectPlanCurrency(): PlanDisplayCurrency {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (zone === "Asia/Kolkata" || zone === "Asia/Calcutta") return "INR";
  } catch {
    return "INR";
  }
  if (typeof navigator !== "undefined" && /-IN$/i.test(navigator.language || "")) return "INR";
  return "USD";
}

export function planLabel(plan?: SubscriptionPlan | string | null, plans?: PlatformPlan[]) {
  const slug = String(plan ?? "").trim();
  const match = (plans ?? DEFAULT_PLATFORM_PLANS).find((item) => item.slug === slug);
  if (match) return match.name;
  if (!slug) return "Trial";
  return slug.replace(/[_-]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export function featureLabel(key: string) {
  return PLAN_FEATURE_CATALOG.find((feature) => feature.key === key)?.label ?? key;
}

export function statusLabel(status?: SubscriptionStatus | string | null) {
  if (status === "paid") return "Paid";
  if (status === "unpaid") return "Unpaid";
  if (status === "cancelled") return "Cancelled";
  return "Trial";
}

function addCalendarMonths(start: Date, months: number) {
  const next = new Date(start.getTime());
  const day = next.getDate();
  next.setMonth(next.getMonth() + months);
  // Clamp overflow (Jan 31 + 1 month should be Feb 28/29, not Mar 3).
  if (next.getDate() !== day) next.setDate(0);
  return next;
}

export function addPlanDuration(start: Date, plan: SubscriptionPlan | string, durationDays?: number) {
  const days =
    durationDays ??
    DEFAULT_PLATFORM_PLANS.find((item) => item.slug === plan)?.durationDays ??
    30;
  // Calendar units so a monthly plan is +1 month and an annual plan is +1 year,
  // not a fixed 30/365-day offset that drifts from the start date.
  if (days % 365 === 0) return addCalendarMonths(start, (days / 365) * 12);
  if (days % 30 === 0) return addCalendarMonths(start, days / 30);
  const next = new Date(start.getTime());
  next.setDate(next.getDate() + days);
  return next;
}

export function slugifyPlanName(name: string) {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || "plan";
}

export function toDateInputValue(value: Date | string | null | undefined) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function fromDateInputValue(value: string) {
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const [year, month, day] = trimmed.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function planPriceSuffix(days: number) {
  if (!Number.isFinite(days) || days <= 0) return "";
  if (days % 365 === 0) {
    const years = days / 365;
    return years === 1 ? "/ year" : `/ ${years} years`;
  }
  if (days % 30 === 0) {
    const months = days / 30;
    return months === 1 ? "/ month" : `/ ${months} months`;
  }
  return `/ ${days} days`;
}

export function formatPlanDuration(days: number) {
  if (!Number.isFinite(days) || days <= 0) return "—";
  if (days % 365 === 0) {
    const years = days / 365;
    return `${years} year${years === 1 ? "" : "s"}`;
  }
  if (days % 30 === 0) {
    const months = days / 30;
    return `${months} month${months === 1 ? "" : "s"}`;
  }
  return `${days} day${days === 1 ? "" : "s"}`;
}

export function formatPlanDate(value: Date | string | null | undefined) {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
