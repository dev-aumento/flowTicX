/** Flags that control what an invited staff-org client can see in their portal. */

export type ClientVisibilityUser = {
  role?: string | null;
  invitedStaffClient?: boolean | null;
  clientCanViewDueDate?: boolean | null;
  clientCanViewTimeTracking?: boolean | null;
  assignedEmployeeIds?: number[] | null;
};

export function isInvitedStaffClientUser(user: ClientVisibilityUser | null | undefined) {
  if (!user) return false;
  if (String(user.role ?? "").toLowerCase() !== "client") return false;
  if (user.invitedStaffClient === false) return false;
  return true;
}

export function clientCanViewDueDate(user: ClientVisibilityUser | null | undefined) {
  if (!isInvitedStaffClientUser(user)) return true;
  return user?.clientCanViewDueDate === true;
}

export function clientCanViewTimeTracking(user: ClientVisibilityUser | null | undefined) {
  if (!isInvitedStaffClientUser(user)) return true;
  return user?.clientCanViewTimeTracking === true;
}
