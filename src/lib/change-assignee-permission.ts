import { hasPermission } from "@/lib/permissions";

export const CHANGE_ASSIGNEE_PERMISSION = "tasks.change_assignee";

type ChangeAssigneeUser = Parameters<typeof hasPermission>[0] & {
  id?: number | null;
};

/**
 * Who may change a task's assignee:
 * - the current assignee (can reassign / clear themselves)
 * - users with `tasks.change_assignee`
 * - users with `tasks.edit_all` (includes admin)
 */
export function canChangeTaskAssignee(
  user: ChangeAssigneeUser | null | undefined,
  currentAssigneeId?: number | null,
) {
  if (!user) return false;
  if (hasPermission(user, CHANGE_ASSIGNEE_PERMISSION)) return true;
  if (hasPermission(user, "tasks.edit_all")) return true;
  if (
    currentAssigneeId != null &&
    user.id != null &&
    Number(currentAssigneeId) === Number(user.id)
  ) {
    return true;
  }
  return false;
}
