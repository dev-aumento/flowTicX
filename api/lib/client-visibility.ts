import { TRPCError } from "@trpc/server";
import { Collections } from "@db/mongo/collections";
import type { SafeUser, TaskDoc, UserDoc } from "@db/mongo/types";
import { findById } from "../queries/connection";
import { isInvitedStaffClient } from "./client-projects";
import { isTaskAssignableUser } from "@/lib/leave-policy";

export function assignedEmployeeIdsOf(user: {
  assignedEmployeeIds?: number[] | null;
}) {
  return [
    ...new Set(
      (user.assignedEmployeeIds ?? [])
        .map((id) => Number(id))
        .filter((id) => Number.isInteger(id) && id > 0),
    ),
  ];
}

export async function invitedClientMayViewDueDate(user: {
  role?: string | null;
  organizationId?: number | null;
  clientCanViewDueDate?: boolean | null;
}) {
  if (!(await isInvitedStaffClient(user))) return true;
  return user.clientCanViewDueDate === true;
}

export async function invitedClientMayViewTimeTracking(user: {
  role?: string | null;
  organizationId?: number | null;
  clientCanViewTimeTracking?: boolean | null;
}) {
  if (!(await isInvitedStaffClient(user))) return true;
  return user.clientCanViewTimeTracking === true;
}

export async function assertInvitedClientAssigneeAllowed(
  user: SafeUser,
  assigneeId: number | null | undefined,
) {
  if (!(await isInvitedStaffClient(user))) return;
  if (assigneeId == null) return;
  if (Number(assigneeId) === Number(user.id)) return;
  const fresh = await findById<UserDoc>(Collections.users, user.id);
  const allowed = new Set(assignedEmployeeIdsOf(fresh ?? user));
  if (!allowed.has(Number(assigneeId))) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This client can only assign work to employees assigned to them",
    });
  }
}

export async function assertTaskAssigneeAllowed(assigneeId: number | null | undefined) {
  if (assigneeId == null) return;
  const assignee = await findById<UserDoc>(Collections.users, Number(assigneeId));
  if (!assignee) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Assignee not found",
    });
  }
  if (!isTaskAssignableUser(assignee)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "HR and finance users cannot be added as assignees, participants, or observers",
    });
  }
}

export async function isClientCreatedTask(task: Pick<TaskDoc, "createdBy">) {
  if (task.createdBy == null) return false;
  const creator = await findById<UserDoc>(Collections.users, task.createdBy);
  return String(creator?.role ?? "").toLowerCase() === "client";
}

export function redactTaskForClient<T extends {
  dueDate?: unknown;
  actualHours?: unknown;
  estimatedHours?: unknown;
}>(
  task: T,
  opts: { hideDueDate: boolean; hideTimeTracking: boolean },
): T {
  const next = { ...task };
  if (opts.hideDueDate) next.dueDate = null;
  if (opts.hideTimeTracking) {
    next.actualHours = null;
    next.estimatedHours = null;
  }
  return next;
}
