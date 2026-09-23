import { hasPermission } from "@/lib/permissions";
import { isClientPortalUser } from "@/lib/client-portal";

export const CREATE_PROJECT_PERMISSION = "projects.manage";

export const CREATE_PROJECT_DENIED_MESSAGE =
  "You don't have permission to create projects.";

export function canCreateProject(
  user: Parameters<typeof hasPermission>[0] & { clientWorkspace?: boolean | null },
) {
  return hasPermission(user, CREATE_PROJECT_PERMISSION) || isClientPortalUser(user);
}
