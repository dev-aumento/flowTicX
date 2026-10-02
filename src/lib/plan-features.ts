import { isPlatformUser, PLAN_FEATURE_CATALOG } from "@/lib/platform-admin";

export const ALL_PLAN_FEATURE_KEYS = PLAN_FEATURE_CATALOG.map((feature) => feature.key);

const UNGATED_PREFIXES = ["/", "/feed", "/settings", "/admin/pricing"];

const FEATURE_PATHS: Array<{ feature: string; prefixes: string[] }> = [
  { feature: "projects", prefixes: ["/projects"] },
  { feature: "tasks", prefixes: ["/tasks", "/admin/tasks", "/admin/client-tasks", "/task-chats"] },
  { feature: "time_tracking", prefixes: ["/time-tracking"] },
  { feature: "invoices", prefixes: ["/admin/invoices"] },
  { feature: "customers", prefixes: ["/admin/customers"] },
  { feature: "employees", prefixes: ["/admin/employees"] },
  { feature: "hr", prefixes: ["/admin/departments", "/recent-employees"] },
  { feature: "leave", prefixes: ["/leaves", "/leave-management"] },
  { feature: "attendance", prefixes: ["/attendance-management", "/locations", "/qr-code"] },
  { feature: "analytics", prefixes: ["/analytics"] },
  { feature: "finance", prefixes: ["/finance"] },
  { feature: "permissions", prefixes: ["/admin/permissions"] },
  { feature: "files", prefixes: ["/client/files"] },
  { feature: "meetings", prefixes: ["/client/meetings"] },
  { feature: "client_portal", prefixes: ["/client/approvals", "/client/milestones", "/client/messages", "/client/reports", "/client/invoices"] },
];

export type PlanFeatureUser = {
  role?: string | null;
  planFeatures?: string[] | null;
};

function pathMatches(path: string, prefix: string) {
  if (prefix === "/") return path === "/" || path === "/feed";
  return path === prefix || path.startsWith(`${prefix}/`);
}

export function isUngatedPlanPath(path: string) {
  return UNGATED_PREFIXES.some((prefix) => pathMatches(path, prefix));
}

export function planFeatureForPath(path: string): string | null {
  for (const entry of FEATURE_PATHS) {
    if (entry.prefixes.some((prefix) => pathMatches(path, prefix))) return entry.feature;
  }
  return null;
}

export function hasPlanFeature(user: PlanFeatureUser | null | undefined, feature: string) {
  if (!user) return false;
  if (isPlatformUser(user)) return true;
  const features = user.planFeatures;
  if (features == null) return true;
  return features.includes(feature);
}

export function canAccessPlanRoute(user: PlanFeatureUser | null | undefined, path: string) {
  if (!user) return false;
  if (isPlatformUser(user)) return true;
  if (isUngatedPlanPath(path)) return true;
  if (path === "/admin/reports" || path.startsWith("/admin/reports/")) {
    return hasPlanFeature(user, "invoices") || hasPlanFeature(user, "customers");
  }
  const feature = planFeatureForPath(path);
  if (!feature) return true;
  return hasPlanFeature(user, feature);
}
