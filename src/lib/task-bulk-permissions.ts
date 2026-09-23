import { hasPermission, type AppRole } from "@/lib/permissions";

type BulkUser = {
  role: AppRole;
  permissions?: string[];
} | null | undefined;

export function getTaskBulkPermissions(user: BulkUser) {
  const canBulkEdit =
    user?.role === "admin" ||
    user?.role === "manager" ||
    hasPermission(user, "tasks.edit_all") ||
    hasPermission(user, "tasks.edit_own");

  const canBulkDelete =
    user?.role === "admin" ||
    user?.role === "manager" ||
    hasPermission(user, "tasks.delete");

  return {
    canBulkEdit,
    canBulkDelete,
    taskSelectionEnabled: canBulkEdit || canBulkDelete,
  };
}
