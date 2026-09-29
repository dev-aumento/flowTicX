import { ROUTE_PERMISSIONS } from "@contracts/permissions";
import { isClientPortalUser } from "@/lib/client-portal";
import { isPlatformUser } from "@/lib/platform-admin";
import { canAccessPlanRoute } from "@/lib/plan-features";
import {
  canManageAttendance,
  canManageLeaves,
  isFinanceRoleOnly,
  isFinanceRestrictedPath,
  isHrDepartmentUser,
  isHrRestrictedPath,
  isAttendanceTrackableUser,
} from "@/lib/leave-policy";

export type AppRole = "admin" | "manager" | "employee" | "hr" | "client" | "finance" | "platform";

type PermissionUser = {
  role: AppRole;
  permissions?: string[];
  department?: string | null;
  clientWorkspace?: boolean | null;
  planFeatures?: string[] | null;
};

export function hasPermission(user: PermissionUser | null | undefined, permission: string) {
  if (!user) return false;
  if (user.role === "admin") return true;
  if (String(user.role ?? "").toLowerCase() === "client" && permission === "invoices.manage") {
    return false;
  }
  return user.permissions?.includes(permission) ?? false;
}

export function hasAnyPermission(
  user: PermissionUser | null | undefined,
  permissions: string[],
) {
  return permissions.some((permission) => hasPermission(user, permission));
}

/** Client's Tasks in the staff portal (employees/PMs can be granted this without all-tasks access). */
export function canViewClientTasks(user: PermissionUser | null | undefined) {
  return hasAnyPermission(user, ["tasks.view_client", "tasks.view_all"]);
}

export function canViewEmployeeDirectory(user: PermissionUser | null | undefined) {
  if (hasAnyPermission(user, ["employees.view", "employees.manage", "permissions.manage"])) {
    return true;
  }
  return String(user?.role ?? "").toLowerCase() === "manager";
}

export function canViewDepartments(user: PermissionUser | null | undefined) {
  if (
    hasAnyPermission(user, [
      "departments.view",
      "employees.view",
      "employees.manage",
      "permissions.manage",
    ])
  ) {
    return true;
  }
  return String(user?.role ?? "").toLowerCase() === "manager";
}

/** First route a user can open after login. */
export function getDefaultHomePath(user: PermissionUser | null | undefined): string {
  if (!user) return "/";
  if (isPlatformUser(user)) return "/platform";
  if (isClientPortalUser(user)) return "/";

  const candidates = ["/", "/admin/invoices", "/admin/customers", "/projects", "/admin/tasks", "/tasks"];
  for (const path of candidates) {
    if (canAccessRoute(user, path)) return path;
  }
  return "/settings";
}

function isClientRestrictedPath(path: string): boolean {
  if (path === "/leaves" || path.startsWith("/leaves")) return true;
  if (path === "/leave-management" || path.startsWith("/leave-management")) return true;
  if (path === "/attendance-management" || path.startsWith("/attendance-management")) return true;
  if (path === "/locations" || path.startsWith("/locations")) return true;
  if (path === "/qr-code" || path.startsWith("/qr-code")) return true;
  if (path === "/recent-employees" || path.startsWith("/recent-employees")) return true;
  if (path === "/time-tracking" || path.startsWith("/time-tracking")) return true;
  if (path === "/analytics" || path.startsWith("/analytics")) return true;
  if (path === "/admin/permissions" || path.startsWith("/admin/permissions")) return true;
  if (path === "/admin/manage-data" || path.startsWith("/admin/manage-data")) return true;
  if (path === "/admin/customers" || path.startsWith("/admin/customers")) return true;
  if (path === "/admin/reports" || path.startsWith("/admin/reports")) return true;
  if (path === "/admin/pricing" || path.startsWith("/admin/pricing")) return true;
  if (path === "/admin/client-tasks" || path.startsWith("/admin/client-tasks")) return true;
  if (path === "/admin/invoices" || path.startsWith("/admin/invoices")) return true;
  return false;
}

export function canAccessRoute(user: PermissionUser | null | undefined, path: string) {
  if (isPlatformUser(user)) {
    return path === "/platform" || path.startsWith("/platform/");
  }

  if (path === "/platform" || path.startsWith("/platform/")) {
    return false;
  }

  if (path === "/admin/pricing" || path.startsWith("/admin/pricing")) {
    return String(user?.role ?? "").toLowerCase() === "admin";
  }

  if (path === "/admin/manage-data" || path.startsWith("/admin/manage-data")) {
    if (isClientPortalUser(user) || isFinanceRoleOnly(user) || isHrDepartmentUser(user)) return false;
    const role = String(user?.role ?? "").toLowerCase();
    if (role === "admin" || role === "manager") return true;
    return hasAnyPermission(user, ["projects.manage", "permissions.manage"]);
  }

  if (!canAccessPlanRoute(user, path)) {
    return false;
  }

  if (isHrDepartmentUser(user) && isHrRestrictedPath(path)) {
    return false;
  }

  if (isFinanceRoleOnly(user) && isFinanceRestrictedPath(path)) {
    return false;
  }

  if (isClientPortalUser(user) && isClientRestrictedPath(path)) {
    return false;
  }

  if (path.startsWith("/client/") && path !== "/client/login") {
    return isClientPortalUser(user);
  }

  // Project managers can open the employees directory (notice period + directory view).
  if (
    path === "/admin/employees" ||
    path.startsWith("/admin/employees")
  ) {
    return canViewEmployeeDirectory(user);
  }

  if (path === "/admin/departments" || path.startsWith("/admin/departments")) {
    return canViewDepartments(user);
  }

  if (path === "/leave-management" || path.startsWith("/leave-management")) {
    return canManageLeaves(user);
  }

  if (path === "/leaves" || path.startsWith("/leaves")) {
    return isAttendanceTrackableUser(user);
  }

  if (
    path === "/attendance-management" ||
    path.startsWith("/attendance-management") ||
    path === "/locations" ||
    path.startsWith("/locations") ||
    path === "/qr-code" ||
    path.startsWith("/qr-code")
  ) {
    return canManageAttendance(user);
  }

  if (path === "/recent-employees" || path.startsWith("/recent-employees")) {
    return canManageLeaves(user) || hasPermission(user, "employees.manage");
  }

  const exact = ROUTE_PERMISSIONS[path];
  if (exact) {
    return Array.isArray(exact)
      ? hasAnyPermission(user, exact)
      : hasPermission(user, exact);
  }

  if (path.startsWith("/projects/")) {
    if (isHrDepartmentUser(user) || isFinanceRoleOnly(user)) return false;
    return hasAnyPermission(user, ["projects.view", "projects.manage"]);
  }

  if (
    path.startsWith("/tasks/task=") ||
    path.startsWith("/tasks/task/view/")
  ) {
    return canAccessRoute(user, "/tasks");
  }

  if (path.startsWith("/admin/tasks/")) {
    return canAccessRoute(user, "/admin/tasks");
  }

  if (path.startsWith("/admin/client-tasks/")) {
    return canAccessRoute(user, "/admin/client-tasks");
  }

  if (path === "/admin/reports" || path.startsWith("/admin/reports/")) {
    return hasAnyPermission(user, ["reports.view", "invoices.manage", "customers.manage"]);
  }

  if (path.startsWith("/admin/invoices") || path.startsWith("/admin/customers")) {
    const permission = path.startsWith("/admin/invoices")
      ? "invoices.manage"
      : "customers.manage";
    return hasPermission(user, permission);
  }

  if (path.startsWith("/finance/") || path === "/finance") {
    const role = String(user?.role ?? "").toLowerCase();
    return role === "finance" || role === "admin";
  }

  if (path.startsWith("/admin/")) {
    return String(user?.role ?? "").toLowerCase() === "admin";
  }

  return true;
}

/** Login path for the signed-in (or last-known) user. */
export function getLoginPathForUser(
  user: { role?: string | null; clientWorkspace?: boolean | null } | null | undefined,
): string {
  if (isPlatformUser(user)) return "/admin/login";
  if (isFinanceRoleOnly(user)) return "/finance/login";
  if (isClientPortalUser(user)) return "/client/login";
  return "/login";
}
