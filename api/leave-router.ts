import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { Collections } from "@db/mongo/collections";
import type { LeaveRequestDoc, NotificationDoc, PublicHolidayDoc, LeaveUsageOverrideDoc, UserDoc } from "@db/mongo/types";
import { createRouter, authedQuery } from "./middleware";
import { assertPlanFeature } from "./lib/plan-guard";
import { ensureSchema } from "./lib/migrate";
import { isAuthDisabled } from "./lib/dev-mode";
import { hasMongoConfigured, getCollection, insertDoc, updateById, findById } from "./queries/connection";
import { notifyLeaveManagers } from "./lib/notify-leave-managers";
import { belongsToUserOrg, orgFilter, requireOrganizationId } from "./lib/tenant";
import * as mock from "./lib/mock-store";
import {
  MONTHLY_PAID_LEAVES,
  TOTAL_PAID_LEAVES,
  accruedPaidLeavesForYear,
  annualPaidLeaveEntitlement,
  annualSickLeaveEntitlement,
  annualWfhEntitlement,
  canCancelLeaveRequest,
  canEditLeaveRequest,
  canManageLeaves,
  consumesPaidBalance,
  consumesSickBalance,
  formatLeaveDays,
  isInProbationPeriod,
  leaveBalanceUnits,
  leaveDayUnits,
  leaveDaysInYear,
  leaveYearsInRange,
  firstOverlappingLeaveDate,
  alreadyAppliedLeaveMessage,
  allowsHalfDayLeave,
  employeeLeaveReviewMessage,
  isHalfDayLeave,
  isWorkFromHomeLeave,
  leaveRequestNotificationTitle,
  leaveTypeLabel,
  leaveTypeShort,
  managerLeaveNotificationMessage,
  manualLeaveEntryMessage,
  paidLeaveLockPeriodLabel,
  resolveEmploymentType,
  toJoiningDateKey,
  roundLeaveUnits,
  type LeaveType,
} from "@/lib/leave-policy";
import { defaultHolidaysForYear } from "@/lib/public-holidays";
import { workZoneDateKey, workZoneDateParts } from "@/lib/timezone";

function useMock() {
  return isAuthDisabled() || !hasMongoConfigured();
}

const leaveTypeSchema = z.enum(["paid", "sick", "unpaid", "wfh"]);

function assertValidLeaveDuration(leaveType: string, isHalfDay: boolean) {
  if (isWorkFromHomeLeave(leaveType) && isHalfDay) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Work from home is full day only",
    });
  }
  if (isHalfDay && !allowsHalfDayLeave(leaveType)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Half day is not available for this leave type",
    });
  }
}

function assertLeaveManager(user: {
  role?: string | null;
  department?: string | null;
  permissions?: string[] | null;
}) {
  if (!canManageLeaves(user)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only HR and admins can manage leave requests",
    });
  }
}

async function computeUsage(
  userId: number,
  year: number,
  options?: { excludeRequestId?: number },
) {
  const col = await getCollection<LeaveRequestDoc>(Collections.leaveRequests);
  const requests = await col
    .find({
      userId,
      status: { $in: ["pending", "approved"] },
    })
    .toArray();

  let usedPaid = 0;
  let usedSick = 0;
  let usedWfh = 0;
  let pendingPaid = 0;
  let pendingSick = 0;
  let pendingWfh = 0;
  let approvedPaid = 0;
  let approvedSick = 0;
  let approvedWfh = 0;

  for (const req of requests) {
    if (options?.excludeRequestId != null && req.id === options.excludeRequestId) continue;

    // Only count units that fall in this calendar year.
    const units = leaveDaysInYear(
      req.startDate,
      req.endDate,
      year,
      req.leaveType,
      isHalfDayLeave(req),
    );
    if (units <= 0) continue;

    // Half-day paid → PL; half-day sick → SL; full days same.
    if (consumesPaidBalance(req.leaveType)) {
      if (req.status === "approved") {
        approvedPaid += units;
        usedPaid += units;
      } else {
        pendingPaid += units;
        usedPaid += units;
      }
    } else if (consumesSickBalance(req.leaveType)) {
      if (req.status === "approved") {
        approvedSick += units;
        usedSick += units;
      } else {
        pendingSick += units;
        usedSick += units;
      }
    } else if (isWorkFromHomeLeave(req.leaveType)) {
      if (req.status === "approved") {
        approvedWfh += units;
        usedWfh += units;
      } else {
        pendingWfh += units;
        usedWfh += units;
      }
    }
  }

  const user = await findById<UserDoc>(Collections.users, userId);
  const dateOfJoining = user?.dateOfJoining ?? null;
  const joiningKey = toJoiningDateKey(dateOfJoining);
  const employmentType = resolveEmploymentType(user);
  const onNoticePeriod = Boolean(user?.onNoticePeriod);
  // Employee Leaves balance: unlock 1 PL per eligible month so far (not full-year total).
  // Leave Management page computes annual entitlement separately on the client.
  const paidAccrued = accruedPaidLeavesForYear(
    year,
    new Date(),
    joiningKey,
    employmentType,
    onNoticePeriod,
  );
  const paidAnnual = annualPaidLeaveEntitlement(
    year,
    joiningKey,
    employmentType,
    onNoticePeriod,
  );
  const sickTotal = annualSickLeaveEntitlement(year, joiningKey);
  const wfhTotal = annualWfhEntitlement(year, joiningKey);

  return {
    year,
    paidTotal: paidAccrued,
    paidAnnualTotal: paidAnnual,
    sickTotal,
    wfhTotal,
    paidRemaining: roundLeaveUnits(Math.max(0, paidAccrued - usedPaid)),
    sickRemaining: roundLeaveUnits(Math.max(0, sickTotal - usedSick)),
    wfhRemaining: roundLeaveUnits(Math.max(0, wfhTotal - usedWfh)),
    paidUsed: roundLeaveUnits(approvedPaid),
    sickUsed: roundLeaveUnits(approvedSick),
    wfhUsed: roundLeaveUnits(approvedWfh),
    paidPending: roundLeaveUnits(pendingPaid),
    sickPending: roundLeaveUnits(pendingSick),
    wfhPending: roundLeaveUnits(pendingWfh),
    usedLeaves: roundLeaveUnits(approvedPaid + approvedSick),
    dateOfJoining: joiningKey ?? dateOfJoining,
    employmentType,
    onNoticePeriod,
    inProbation: isInProbationPeriod(joiningKey, new Date(), employmentType),
    paidLeaveLockLabel: paidLeaveLockPeriodLabel(employmentType),
  };
}

/** Ensure the user has no pending/approved leave overlapping these dates. */
async function assertNoOverlappingLeave(params: {
  userId: number;
  startDate: string;
  endDate: string;
  excludeRequestId?: number;
}) {
  const endDate = params.endDate;
  const col = await getCollection<LeaveRequestDoc>(Collections.leaveRequests);
  const existing = await col
    .find({
      userId: params.userId,
      status: { $in: ["pending", "approved"] },
      startDate: { $lte: endDate },
      endDate: { $gte: params.startDate },
      ...(params.excludeRequestId != null ? { id: { $ne: params.excludeRequestId } } : {}),
    })
    .toArray();

  for (const req of existing) {
    const conflict = firstOverlappingLeaveDate(params.startDate, endDate, req);
    if (conflict) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: alreadyAppliedLeaveMessage(conflict),
      });
    }
  }
}

/** Ensure PL/SL/WFH for each calendar year touched by the leave have enough remaining. */
async function assertYearScopedBalance(params: {
  userId: number;
  leaveType: string;
  startDate: string;
  endDate: string;
  isHalfDay: boolean;
  excludeRequestId?: number;
  forEmployee?: boolean;
}) {
  const tracksBalance =
    consumesPaidBalance(params.leaveType) ||
    consumesSickBalance(params.leaveType) ||
    isWorkFromHomeLeave(params.leaveType);
  if (!tracksBalance) {
    return;
  }

  const endDate = params.isHalfDay ? params.startDate : params.endDate;
  const short = leaveTypeShort(params.leaveType as LeaveType);
  const employeeSuffix = params.forEmployee ? " for this employee" : "";

  for (const year of leaveYearsInRange(params.startDate, endDate)) {
    const needed = leaveDaysInYear(
      params.startDate,
      endDate,
      year,
      params.leaveType,
      params.isHalfDay,
    );
    if (needed <= 0) continue;

    const usage = await computeUsage(params.userId, year, {
      excludeRequestId: params.excludeRequestId,
    });
    const remaining = consumesPaidBalance(params.leaveType)
      ? usage.paidRemaining
      : consumesSickBalance(params.leaveType)
        ? usage.sickRemaining
        : usage.wfhRemaining;

    if (needed > remaining) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Only ${remaining} ${short} day(s) remaining for ${year}${employeeSuffix}`,
      });
    }
  }
}

const applySchema = z.object({
  leaveType: leaveTypeSchema,
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().trim().min(3).max(1000),
  /** Half day deducts 0.5 from balance (if any) and requires 5h work that day. Not used for WFH. */
  isHalfDay: z.boolean().optional().default(false),
});

const reviewSchema = z.object({
  id: z.number(),
  status: z.enum(["approved", "rejected", "cancelled", "pending"]),
  reviewNote: z.string().trim().max(500).optional(),
});

const updateDetailsSchema = z
  .object({
    id: z.number(),
    reason: z.string().trim().max(1000),
    reviewNote: z.string().trim().max(500).optional().nullable(),
  })
  .superRefine((data, ctx) => {
    // Validated against leave type after load; keep schema flexible for WFH.
    if (data.reason.length > 0 && data.reason.length < 3) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Please enter a reason (at least 3 characters)",
        path: ["reason"],
      });
    }
  });

const updateMyRequestSchema = applySchema.extend({
  id: z.number(),
});

const manualEntrySchema = z
  .object({
    userId: z.number().int().positive(),
    leaveType: leaveTypeSchema,
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    reason: z.string().trim().max(1000).optional().default(""),
    isHalfDay: z.boolean().optional().default(false),
    status: z.enum(["approved", "rejected"]),
    reviewNote: z.string().trim().max(500).optional(),
  })
  .superRefine((data, ctx) => {
    // WFH does not require a reason; other leave types still do.
    if (!isWorkFromHomeLeave(data.leaveType) && data.reason.trim().length < 3) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Please enter a reason (at least 3 characters)",
        path: ["reason"],
      });
    }
  });

export const leaveRouter = createRouter({
  myBalance: authedQuery
    .input(z.object({ year: z.number().int().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const year = input?.year ?? workZoneDateParts(new Date()).year;
      if (useMock()) return mock.mockLeaveBalance(ctx.user.id, year);
      await ensureSchema();
      return computeUsage(ctx.user.id, year);
    }),

  myRequests: authedQuery.query(async ({ ctx }) => {
    if (useMock()) return mock.mockMyLeaveRequests(ctx.user.id);
    await ensureSchema();
    const col = await getCollection<LeaveRequestDoc>(Collections.leaveRequests);
    const requests = await col
      .find({ userId: ctx.user.id })
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray();
    return { requests };
  }),

  /** Approved leaves overlapping a date range (for work-hours required calculations). */
  approvedInRange: authedQuery
    .input(
      z.object({
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        userId: z.number().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const userId = input.userId ?? ctx.user.id;
      if (userId !== ctx.user.id && !canManageLeaves(ctx.user) && ctx.user.role !== "manager") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Cannot view another user's leave" });
      }

      if (useMock()) return mock.mockApprovedLeavesInRange(userId, input.startDate, input.endDate);

      await ensureSchema();
      const col = await getCollection<LeaveRequestDoc>(Collections.leaveRequests);
      const requests = await col
        .find({
          userId,
          status: "approved",
          startDate: { $lte: input.endDate },
          endDate: { $gte: input.startDate },
        })
        .toArray();

      return {
        leaves: requests.map((r) => ({
          id: r.id,
          leaveType: r.leaveType,
          startDate: r.startDate,
          endDate: r.endDate,
          days: r.days,
          isHalfDay: Boolean(r.isHalfDay) || r.leaveType === "half" || r.days === 0.5,
        })),
      };
    }),

  submitRequest: authedQuery.input(applySchema).mutation(async ({ ctx, input }) => {
    await assertPlanFeature(ctx.user, "leave");
    if (useMock()) return mock.mockApplyLeave(ctx.user.id, input);

    await ensureSchema();

    const isHalfDay = Boolean(input.isHalfDay) && !isWorkFromHomeLeave(input.leaveType);
    assertValidLeaveDuration(input.leaveType, isHalfDay);
    // Force exact 0.5 for half-day so PL/SL balances always deduct correctly.
    const days = isHalfDay
      ? 0.5
      : leaveDayUnits(input.leaveType, input.startDate, input.endDate, false);

    if (isHalfDay && input.startDate !== input.endDate) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Half day leave must be for a single day only",
      });
    }

    if (days <= 0) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "End date must be on or after the start date",
      });
    }

    const todayKey = workZoneDateKey(new Date());
    if (input.startDate < todayKey) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Leave cannot start in the past",
      });
    }

    const requestEndDate = isHalfDay ? input.startDate : input.endDate;
    await assertNoOverlappingLeave({
      userId: ctx.user.id,
      startDate: input.startDate,
      endDate: requestEndDate,
    });

    await assertYearScopedBalance({
      userId: ctx.user.id,
      leaveType: input.leaveType,
      startDate: input.startDate,
      endDate: input.endDate,
      isHalfDay,
    });

    const now = new Date();
    const request = await insertDoc<LeaveRequestDoc>(Collections.leaveRequests, {
      userId: ctx.user.id,
      organizationId: requireOrganizationId(ctx.user),
      leaveType: input.leaveType,
      isHalfDay,
      startDate: input.startDate,
      endDate: requestEndDate,
      days,
      reason: input.reason,
      status: "pending",
      reviewedBy: null,
      reviewedAt: null,
      reviewNote: null,
      createdAt: now,
      updatedAt: now,
    });

    const dateLabel =
      input.startDate === input.endDate
        ? input.startDate
        : `${input.startDate} → ${input.endDate}`;

    await notifyLeaveManagers({
      actor: ctx.user,
      type: "leave_request_pending",
      title: leaveRequestNotificationTitle(input.leaveType, "new"),
      message: managerLeaveNotificationMessage({
        actorName: ctx.user.name ?? ctx.user.email ?? "An employee",
        leaveType: input.leaveType,
        action: "submitted",
        days,
        dateLabel,
        isHalfDay,
      }),
      leaveRequestId: request.id,
    });

    const balanceYear = Number(input.startDate.slice(0, 4));
    return { request, balance: await computeUsage(ctx.user.id, balanceYear) };
  }),

  /** Employee edits their own pending leave. Re-opens as pending for HR. */
  updateMyRequest: authedQuery.input(updateMyRequestSchema).mutation(async ({ ctx, input }) => {
    if (useMock()) return mock.mockUpdateMyLeave(ctx.user.id, input);

    await ensureSchema();
    const existing = await findById<LeaveRequestDoc>(
      Collections.leaveRequests,
      input.id,
    );
    if (!existing) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Leave request not found" });
    }
    if (existing.userId !== ctx.user.id) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "You can only edit your own leave requests",
      });
    }

    const todayKey = workZoneDateKey(new Date());
    if (!canEditLeaveRequest(existing, todayKey)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          existing.status === "approved"
            ? "Approved leave cannot be edited"
            : "Only pending leave requests can be edited",
      });
    }

    const isHalfDay = Boolean(input.isHalfDay) && !isWorkFromHomeLeave(input.leaveType);
    assertValidLeaveDuration(input.leaveType, isHalfDay);
    const days = isHalfDay
      ? 0.5
      : leaveDayUnits(input.leaveType, input.startDate, input.endDate, false);

    if (isHalfDay && input.startDate !== input.endDate) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Half day leave must be for a single day only",
      });
    }
    if (days <= 0) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "End date must be on or after the start date",
      });
    }
    if (input.startDate < todayKey) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Leave cannot start in the past",
      });
    }

    const requestEndDate = isHalfDay ? input.startDate : input.endDate;
    await assertNoOverlappingLeave({
      userId: ctx.user.id,
      startDate: input.startDate,
      endDate: requestEndDate,
      excludeRequestId: existing.id,
    });

    await assertYearScopedBalance({
      userId: ctx.user.id,
      leaveType: input.leaveType,
      startDate: input.startDate,
      endDate: input.endDate,
      isHalfDay,
      excludeRequestId: existing.id,
    });

    const wasApproved = existing.status === "approved";
    const now = new Date();
    const updated = await updateById<LeaveRequestDoc>(
      Collections.leaveRequests,
      input.id,
      {
        leaveType: input.leaveType,
        isHalfDay,
        startDate: input.startDate,
        endDate: requestEndDate,
        days,
        reason: input.reason,
        status: "pending",
        reviewedBy: null,
        reviewedAt: null,
        reviewNote: wasApproved ? "Re-submitted after employee edit" : existing.reviewNote,
        updatedAt: now,
      },
    );

    const endDate = isHalfDay ? input.startDate : input.endDate;
    const dateLabel =
      input.startDate === endDate
        ? input.startDate
        : `${input.startDate} → ${endDate}`;

    await notifyLeaveManagers({
      actor: ctx.user,
      type: "leave_request_pending",
      title: leaveRequestNotificationTitle(
        input.leaveType,
        wasApproved ? "resubmitted" : "updated",
      ),
      message: managerLeaveNotificationMessage({
        actorName: ctx.user.name ?? ctx.user.email ?? "An employee",
        leaveType: input.leaveType,
        action: wasApproved ? "resubmitted" : "updated",
        days,
        dateLabel,
        isHalfDay,
      }),
      leaveRequestId: input.id,
    });

    const balanceYear = Number(input.startDate.slice(0, 4));
    return { request: updated, balance: await computeUsage(ctx.user.id, balanceYear) };
  }),

  /** HR/admin creates a leave entry for an employee (already approved or rejected). */
  createManualEntry: authedQuery.input(manualEntrySchema).mutation(async ({ ctx, input }) => {
    await assertPlanFeature(ctx.user, "leave");
    assertLeaveManager(ctx.user);
    if (useMock()) return mock.mockCreateManualLeave(ctx.user.id, input);

    await ensureSchema();

    const employee = await findById<UserDoc>(Collections.users, input.userId);
    if (!employee) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Employee not found" });
    }

    const isHalfDay = Boolean(input.isHalfDay) && !isWorkFromHomeLeave(input.leaveType);
    assertValidLeaveDuration(input.leaveType, isHalfDay);
    const days = isHalfDay
      ? 0.5
      : leaveDayUnits(input.leaveType, input.startDate, input.endDate, false);

    if (isHalfDay && input.startDate !== input.endDate) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Half day leave must be for a single day only",
      });
    }

    if (days <= 0) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "End date must be on or after the start date",
      });
    }

    const requestEndDate = isHalfDay ? input.startDate : input.endDate;
    // Block duplicate dates for approved entries (and still prevent stacking on pending).
    if (input.status === "approved") {
      await assertNoOverlappingLeave({
        userId: input.userId,
        startDate: input.startDate,
        endDate: requestEndDate,
      });
      await assertYearScopedBalance({
        userId: input.userId,
        leaveType: input.leaveType,
        startDate: input.startDate,
        endDate: input.endDate,
        isHalfDay,
        forEmployee: true,
      });
    }

    const now = new Date();
    const reviewNote =
      input.reviewNote?.trim() ||
      (input.status === "approved" ? "Added manually by HR" : "Rejected via manual entry");

    const request = await insertDoc<LeaveRequestDoc>(Collections.leaveRequests, {
      userId: input.userId,
      organizationId: requireOrganizationId(ctx.user),
      leaveType: input.leaveType,
      isHalfDay,
      startDate: input.startDate,
      endDate: requestEndDate,
      days,
      reason: input.reason?.trim() || (isWorkFromHomeLeave(input.leaveType) ? "Work from home" : ""),
      status: input.status,
      reviewedBy: ctx.user.id,
      reviewedAt: now,
      reviewNote,
      createdAt: now,
      updatedAt: now,
    });

    const dateLabel =
      input.startDate === (isHalfDay ? input.startDate : input.endDate)
        ? input.startDate
        : `${input.startDate} → ${input.endDate}`;

    await insertDoc<NotificationDoc>(Collections.notifications, {
      userId: input.userId,
      organizationId: requireOrganizationId(ctx.user),
      actorId: ctx.user.id,
      type: input.status === "approved" ? "leave_approved" : "leave_rejected",
      title: leaveRequestNotificationTitle(
        input.leaveType,
        input.status === "approved" ? "recorded" : "rejected",
      ),
      message: manualLeaveEntryMessage(input.leaveType, {
        status: input.status,
        days,
        dateLabel,
        isHalfDay,
        reviewNote,
      }),
      taskId: null,
      projectId: null,
      activityId: null,
      leaveRequestId: request.id,
      read: false,
      createdAt: now,
    });

    return { request };
  }),

  listPending: authedQuery.query(async ({ ctx }) => {
    assertLeaveManager(ctx.user);
    if (useMock()) return mock.mockListLeaveRequests();

    await ensureSchema();
    const col = await getCollection<LeaveRequestDoc>(Collections.leaveRequests);
    const requests = await col
      .find(orgFilter(ctx.user))
      .sort({ createdAt: -1 })
      .limit(200)
      .toArray();
    const userIds = [...new Set(requests.map((r) => r.userId))];
    const usersCol = await getCollection<UserDoc>(Collections.users);
    const users = await usersCol
      .find({ id: { $in: userIds }, ...orgFilter(ctx.user) })
      .project({ id: 1, name: 1, email: 1, avatar: 1, department: 1 })
      .toArray();
    const byId = new Map(users.map((u) => [u.id, u]));

    return {
      requests: requests.map((r) => ({
        ...r,
        employee: byId.get(r.userId) ?? null,
      })),
    };
  }),

  review: authedQuery.input(reviewSchema).mutation(async ({ ctx, input }) => {
    assertLeaveManager(ctx.user);
    if (useMock()) return mock.mockReviewLeave(ctx.user.id, input);

    await ensureSchema();
    const existing = await findById<LeaveRequestDoc>(
      Collections.leaveRequests,
      input.id,
    );
    if (!existing || !belongsToUserOrg(ctx.user, existing.organizationId)) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Leave request not found" });
    }
    if (existing.status === input.status) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `This leave request is already ${input.status}`,
      });
    }

    if (input.status === "approved") {
      await assertNoOverlappingLeave({
        userId: existing.userId,
        startDate: existing.startDate,
        endDate: existing.endDate,
        excludeRequestId: existing.id,
      });
      await assertYearScopedBalance({
        userId: existing.userId,
        leaveType: existing.leaveType,
        startDate: existing.startDate,
        endDate: existing.endDate,
        isHalfDay: isHalfDayLeave(existing),
        excludeRequestId: existing.id,
        forEmployee: true,
      });
    }

    const now = new Date();
    const normalizedHalf = Boolean(existing.isHalfDay) || existing.leaveType === "half" || existing.days === 0.5;
    const normalizedDays = leaveBalanceUnits(existing);
    const defaultNote =
      input.status === "approved"
        ? null
        : input.status === "rejected"
          ? null
          : input.status === "cancelled"
            ? "Cancelled by HR"
            : "Reset to pending by HR";
    const updated = await updateById<LeaveRequestDoc>(
      Collections.leaveRequests,
      input.id,
      {
        status: input.status,
        reviewedBy: input.status === "pending" ? null : ctx.user.id,
        reviewedAt: input.status === "pending" ? null : now,
        reviewNote:
          input.reviewNote?.trim() ||
          (input.status === "pending" ? null : defaultNote) ||
          existing.reviewNote,
        // Keep PL/SL units consistent for half-day paid/sick.
        isHalfDay: normalizedHalf,
        days: normalizedDays,
        endDate: normalizedHalf ? existing.startDate : existing.endDate,
        updatedAt: now,
      },
    );

    const notifType =
      input.status === "approved"
        ? "leave_approved"
        : input.status === "rejected"
          ? "leave_rejected"
          : input.status === "cancelled"
            ? "leave_cancelled"
            : "leave_request_pending";
    const title =
      input.status === "approved"
        ? leaveRequestNotificationTitle(existing.leaveType, "approved")
        : input.status === "rejected"
          ? leaveRequestNotificationTitle(existing.leaveType, "rejected")
          : input.status === "cancelled"
            ? leaveRequestNotificationTitle(existing.leaveType, "cancelled")
            : leaveRequestNotificationTitle(existing.leaveType, "pending");
    const message = employeeLeaveReviewMessage(existing.leaveType, {
      status:
        input.status === "approved"
          ? "approved"
          : input.status === "rejected"
            ? "rejected"
            : input.status === "cancelled"
              ? "cancelled"
              : "pending",
      startDate: existing.startDate,
      endDate: existing.endDate,
      reviewNote: input.reviewNote,
      isHalfDay: existing.isHalfDay,
      days: existing.days,
    });

    await insertDoc<NotificationDoc>(Collections.notifications, {
      userId: existing.userId,
      organizationId: requireOrganizationId(ctx.user),
      actorId: ctx.user.id,
      type: notifType,
      title,
      message,
      taskId: null,
      projectId: null,
      activityId: null,
      leaveRequestId: existing.id,
      read: false,
      createdAt: now,
    });

    return { request: updated };
  }),

  /** HR edits leave reason / review note without changing status. */
  updateDetails: authedQuery.input(updateDetailsSchema).mutation(async ({ ctx, input }) => {
    assertLeaveManager(ctx.user);
    if (useMock()) return mock.mockUpdateLeaveDetails(ctx.user.id, input);

    await ensureSchema();
    const existing = await findById<LeaveRequestDoc>(
      Collections.leaveRequests,
      input.id,
    );
    if (!existing || !belongsToUserOrg(ctx.user, existing.organizationId)) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Leave request not found" });
    }

    const isWfh = isWorkFromHomeLeave(existing.leaveType);
    const nextReason = input.reason.trim();
    if (!isWfh && nextReason.length < 3) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Please enter a reason (at least 3 characters)",
      });
    }

    const nextNote =
      input.reviewNote == null ? existing.reviewNote : input.reviewNote.trim() || null;

    const updated = await updateById<LeaveRequestDoc>(
      Collections.leaveRequests,
      input.id,
      {
        reason: isWfh ? nextReason || existing.reason || "Work from home" : nextReason,
        reviewNote: nextNote,
        updatedAt: new Date(),
      },
    );

    return { request: updated };
  }),

  /** Employee cancels their own pending or upcoming approved leave. */
  cancelRequest: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (useMock()) return mock.mockCancelLeave(ctx.user.id, input.id);

      await ensureSchema();
      const existing = await findById<LeaveRequestDoc>(
        Collections.leaveRequests,
        input.id,
      );
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Leave request not found" });
      }
      if (existing.userId !== ctx.user.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You can only cancel your own leave requests",
        });
      }

      const todayKey = workZoneDateKey(new Date());
      if (!canCancelLeaveRequest(existing, todayKey)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            existing.status === "approved"
              ? "Approved leave that has already started cannot be cancelled"
              : "Only pending or upcoming approved leaves can be cancelled",
        });
      }

      const now = new Date();
      const updated = await updateById<LeaveRequestDoc>(
        Collections.leaveRequests,
        input.id,
        {
          status: "cancelled",
          reviewedBy: ctx.user.id,
          reviewedAt: now,
          reviewNote: "Cancelled by employee",
          updatedAt: now,
        },
      );

      const dateLabel =
        existing.startDate === existing.endDate
          ? existing.startDate
          : `${existing.startDate} → ${existing.endDate}`;

      await notifyLeaveManagers({
        actor: ctx.user,
        type: "leave_cancelled",
        title: leaveRequestNotificationTitle(existing.leaveType, "cancelled"),
        message: managerLeaveNotificationMessage({
          actorName: ctx.user.name ?? ctx.user.email ?? "An employee",
          leaveType: existing.leaveType,
          action: "cancelled",
          days: existing.days,
          dateLabel,
          isHalfDay: Boolean(existing.isHalfDay),
        }),
        leaveRequestId: existing.id,
      });

      return {
        request: updated,
        balance: await computeUsage(ctx.user.id, Number(existing.startDate.slice(0, 4))),
      };
    }),

  listHolidays: authedQuery
    .input(z.object({ year: z.number().int().optional() }).optional())
    .query(async ({ ctx, input }) => {
      if (useMock()) return mock.mockListPublicHolidays(input?.year);

      await ensureSchema();
      const organizationId = requireOrganizationId(ctx.user);
      const col = await getCollection<PublicHolidayDoc>(Collections.publicHolidays);
      const count = await col.countDocuments({ organizationId });
      if (count === 0) {
        const year = workZoneDateParts(new Date()).year;
        const now = new Date();
        for (const h of defaultHolidaysForYear(year)) {
          await insertDoc<PublicHolidayDoc>(Collections.publicHolidays, {
            date: h.date,
            name: h.name,
            organizationId,
            createdBy: null,
            createdAt: now,
            updatedAt: now,
          });
        }
      }

      const year = input?.year;
      const filter: Record<string, unknown> = { organizationId };
      if (year != null) {
        filter.date = { $gte: `${year}-01-01`, $lte: `${year}-12-31` };
      }
      const holidays = await col.find(filter).sort({ date: 1 }).toArray();
      return { holidays };
    }),

  addHoliday: authedQuery
    .input(
      z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        name: z.string().trim().min(2).max(120),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertLeaveManager(ctx.user);
      if (useMock()) return mock.mockAddPublicHoliday(ctx.user.id, input);

      await ensureSchema();
      const organizationId = requireOrganizationId(ctx.user);
      const col = await getCollection<PublicHolidayDoc>(Collections.publicHolidays);
      const existing = await col.findOne({ date: input.date, organizationId });
      if (existing) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "A holiday is already set for this date",
        });
      }

      const now = new Date();
      const holiday = await insertDoc<PublicHolidayDoc>(Collections.publicHolidays, {
        date: input.date,
        name: input.name.trim(),
        organizationId,
        createdBy: ctx.user.id,
        createdAt: now,
        updatedAt: now,
      });

      // If this holiday falls in the next-week window, notify employees promptly.
      void import("./lib/holiday-reminders")
        .then(({ runHolidayReminderJob }) => runHolidayReminderJob())
        .catch((error) => {
          console.error("[holiday-reminder] post-add notify failed:", error);
        });

      return { holiday };
    }),

  deleteHoliday: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      assertLeaveManager(ctx.user);
      if (useMock()) return mock.mockDeletePublicHoliday(input.id);

      await ensureSchema();
      const col = await getCollection<PublicHolidayDoc>(Collections.publicHolidays);
      const result = await col.deleteOne({
        id: input.id,
        ...orgFilter(ctx.user),
      });
      if (result.deletedCount === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Holiday not found" });
      }
      return { success: true };
    }),

  listUsageOverrides: authedQuery
    .input(z.object({ year: z.number().int() }))
    .query(async ({ ctx, input }) => {
      assertLeaveManager(ctx.user);
      if (useMock()) return mock.mockListLeaveUsageOverrides(input.year);

      await ensureSchema();
      const col = await getCollection<LeaveUsageOverrideDoc>(Collections.leaveUsageOverrides);
      const overrides = await col
        .find({ year: input.year, ...orgFilter(ctx.user) })
        .toArray();
      return { overrides };
    }),

  setUsageOverride: authedQuery
    .input(
      z.object({
        userId: z.number().int().positive(),
        year: z.number().int(),
        month: z.number().int().min(1).max(12),
        /** Remaining paid leave for the month (0–monthly entitlement). */
        remainingPaid: z.number().min(0).max(MONTHLY_PAID_LEAVES),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertLeaveManager(ctx.user);
      if (useMock()) return mock.mockSetLeaveUsageOverride(ctx.user.id, input);

      await ensureSchema();

      const employee = await findById<UserDoc>(Collections.users, input.userId);
      if (!employee || !belongsToUserOrg(ctx.user, employee.organizationId)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Employee not found" });
      }

      const paidDaysUsed = Math.round((MONTHLY_PAID_LEAVES - input.remainingPaid) * 10) / 10;
      const col = await getCollection<LeaveUsageOverrideDoc>(Collections.leaveUsageOverrides);
      const existing = await col.findOne({
        userId: input.userId,
        year: input.year,
        month: input.month,
        ...orgFilter(ctx.user),
      });
      const now = new Date();

      // Clear override when remaining matches a "fully available" month with no used days stored as 0.
      if (paidDaysUsed <= 0) {
        if (existing) {
          await col.deleteOne({ id: existing.id });
          return { override: null };
        }
        return { override: null };
      }

      if (existing) {
        const updated = await updateById<LeaveUsageOverrideDoc>(
          Collections.leaveUsageOverrides,
          existing.id,
          {
            paidDaysUsed,
            updatedBy: ctx.user.id,
            updatedAt: now,
          },
        );
        return { override: updated };
      }

      const override = await insertDoc<LeaveUsageOverrideDoc>(Collections.leaveUsageOverrides, {
        userId: input.userId,
        organizationId: requireOrganizationId(ctx.user),
        year: input.year,
        month: input.month,
        paidDaysUsed,
        updatedBy: ctx.user.id,
        createdAt: now,
        updatedAt: now,
      });
      return { override };
    }),
});
