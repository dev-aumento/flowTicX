import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, authedQuery, employeesManageQuery, employeesDirectoryQuery } from "./middleware";
import { isAuthDisabled } from "./lib/dev-mode";
import * as mock from "./lib/mock-store";
import { getCollection, findById, updateById } from "./queries/connection";
import { findUsersByEmail, omitPasswordHash } from "./queries/users";
import { syncEmployeeFromUser, deactivateEmployeeByUserId, createEmployeeFromUser, deleteEmployeeByUserId, getEmployeeUserIdSet, isListedInEmployeeDirectory } from "./queries/employees";
import { Collections } from "@db/mongo/collections";
import type { UserDoc } from "@db/mongo/types";
import type { TaskDoc } from "@db/mongo/types";
import type { TimeEntryDoc } from "@db/mongo/types";
import { ensureSchema } from "./lib/migrate";
import { invalidateAuthUserCache } from "./lib/auth";
import { getEmployeeDefaultPermissions } from "./lib/employee-defaults";
import { hasMongoConfigured } from "./queries/mongo";
import {
  buildPersonalInfoUserPatch,
  personalInfoUpdateSchema,
  toPersonalInfoView,
  type PersonalInfoUpdateInput,
} from "./queries/personal-info";
import { assertPermission, assertAnyPermission, hasPermission } from "./lib/permissions";
import { orgFilter, belongsToUserOrg } from "./lib/tenant";
import { canManageNoticePeriod, isTaskAssignableUser } from "@/lib/leave-policy";
import { expireFinishedNoticePeriods } from "./lib/notice-period";
import { isInvitedStaffClient } from "./lib/client-projects";
import { assignedEmployeeIdsOf } from "./lib/client-visibility";

function canFullyEditEmployees(
  user: { role?: string | null; permissions?: string[] | null; department?: string | null },
) {
  return (
    hasPermission(user, "employees.manage") || hasPermission(user, "permissions.manage")
  );
}

/** Managers without employees.manage may only update the notice-period flag. */
function restrictPersonalInfoInputForCaller(
  caller: { role?: string | null; permissions?: string[] | null; department?: string | null },
  data: PersonalInfoUpdateInput,
): PersonalInfoUpdateInput {
  if (canFullyEditEmployees(caller)) return data;
  if (!canManageNoticePeriod(caller)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You do not have permission to update personal information",
    });
  }
  if (data.onNoticePeriod === undefined) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You can only update the notice period flag",
    });
  }
  return { onNoticePeriod: data.onNoticePeriod, noticePeriodDays: data.noticePeriodDays ?? null };
}

async function assertWorkEmailAvailable(
  email: string,
  userId: number,
  organizationId: number | null | undefined,
  lookup: (email: string) => Promise<Array<Pick<UserDoc, "id" | "organizationId">>> | Array<Pick<UserDoc, "id" | "organizationId">>,
) {
  const normalized = email.trim().toLowerCase();
  const matches = await lookup(normalized);
  const taken = matches.some(
    (user) =>
      user.id !== userId &&
      (organizationId == null || user.organizationId === organizationId),
  );
  if (taken) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "Another account in this workspace already uses this email.",
    });
  }
  return normalized;
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compareUsersBySortOrder(a: UserDoc, b: UserDoc) {
  const aOrder = a.sortOrder ?? a.id;
  const bOrder = b.sortOrder ?? b.id;
  if (aOrder !== bOrder) return aOrder - bOrder;
  return a.id - b.id;
}

export const userRouter = createRouter({
  listForPicker: authedQuery
    .input(z.object({ limit: z.number().default(500) }).optional())
    .query(async ({ input, ctx }) => {
      if (isAuthDisabled() || !hasMongoConfigured()) return mock.mockUserList();

      await ensureSchema();
      const limit = input?.limit ?? 500;
      const filter = { ...orgFilter(ctx.user), status: "active" as const };
      const col = await getCollection<UserDoc>(Collections.users);
      const [allUsers, employeeUserIds] = await Promise.all([
        col.find(filter).toArray(),
        getEmployeeUserIdSet(),
      ]);

      if (await isInvitedStaffClient(ctx.user)) {
        const selfDoc = allUsers.find((u) => u.id === ctx.user.id);
        const allowed = new Set(assignedEmployeeIdsOf(selfDoc ?? ctx.user));
        const assigned = allUsers
          .filter((u) => allowed.has(u.id) && isTaskAssignableUser(u))
          .sort(compareUsersBySortOrder);
        if (selfDoc && !assigned.some((u) => u.id === selfDoc.id)) {
          assigned.unshift(selfDoc);
        }
        return {
          users: assigned.slice(0, limit).map(omitPasswordHash),
          total: assigned.length,
        };
      }

      const visible = allUsers
        .filter((u) => isListedInEmployeeDirectory(u, employeeUserIds))
        .sort(compareUsersBySortOrder);

      const self = allUsers.find((u) => u.id === ctx.user.id);
      if (self && !visible.some((u) => u.id === self.id)) {
        visible.unshift(self);
      }

      return {
        users: visible.slice(0, limit).map(omitPasswordHash),
        total: visible.length,
      };
    }),

  list: employeesDirectoryQuery
    .input(
      z.object({
        search: z.string().optional(),
        role: z.string().optional(),
        status: z.string().optional(),
        page: z.number().default(1),
        limit: z.number().default(20),
      }).optional(),
    )
    .query(async ({ input, ctx }) => {
      if (isAuthDisabled() || !hasMongoConfigured()) return mock.mockUserList();

      await ensureSchema();
      await expireFinishedNoticePeriods(ctx.user.organizationId);
      const { search, role, status, page = 1, limit = 20 } = input || {};
      const skip = (page - 1) * limit;

      const filter: Record<string, unknown> = { ...orgFilter(ctx.user) };
      if (role) filter.role = role;
      if (status) filter.status = status;
      if (search) {
        const regex = new RegExp(escapeRegex(search), "i");
        filter.$or = [
          { name: regex },
          { email: regex },
          { department: regex },
          { position: regex },
        ];
      }

      const col = await getCollection<UserDoc>(Collections.users);
      const [allUsers, employeeUserIds] = await Promise.all([
        col.find(filter).toArray(),
        getEmployeeUserIdSet(),
      ]);

      // Hide employee-role users that were removed from the employees collection.
      // Only those orphaned employee accounts are deactivated (not finance/HR/admin/client).
      const visible: UserDoc[] = [];
      for (const user of allUsers) {
        if (isListedInEmployeeDirectory(user, employeeUserIds)) {
          // Heal account managers wrongly inactivated by the old orphan logic.
          if (user.role === "finance" && String(user.status).toLowerCase() === "inactive") {
            const healed = await updateById<UserDoc>(Collections.users, user.id, {
              status: "active",
              updatedAt: new Date(),
            });
            if (healed) {
              invalidateAuthUserCache(user.id);
              visible.push(healed);
              continue;
            }
          }
          visible.push(user);
          continue;
        }
        if (user.role === "employee" && user.status === "active") {
          await updateById<UserDoc>(Collections.users, user.id, {
            status: "inactive",
            updatedAt: new Date(),
          });
          invalidateAuthUserCache(user.id);
        }
      }

      visible.sort(compareUsersBySortOrder);

      return {
        users: visible.slice(skip, skip + limit).map(omitPasswordHash),
        total: visible.length,
      };
    }),

  listClients: authedQuery.query(async ({ ctx }) => {
    if (
      !hasPermission(ctx.user, "employees.manage") &&
      !hasPermission(ctx.user, "customers.manage") &&
      !hasPermission(ctx.user, "permissions.manage")
    ) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "You do not have permission to view clients",
      });
    }
    if (isAuthDisabled() || !hasMongoConfigured()) {
      const list = mock.mockUserList();
      return {
        users: list.users.filter((user) => user.role === "client"),
      };
    }

    await ensureSchema();
    const col = await getCollection<UserDoc>(Collections.users);
    const clients = await col
      .find({ ...orgFilter(ctx.user), role: "client" })
      .sort({ name: 1, id: 1 })
      .toArray();

    return { users: clients.map(omitPasswordHash) };
  }),

  reorder: employeesManageQuery
    .input(z.object({ orderedIds: z.array(z.number()).min(1) }))
    .mutation(async ({ input }) => {
      if (isAuthDisabled() || !hasMongoConfigured()) {
        return mock.mockReorderUsers(input.orderedIds);
      }

      await ensureSchema();
      const now = new Date();
      await Promise.all(
        input.orderedIds.map((id, index) =>
          updateById<UserDoc>(Collections.users, id, {
            sortOrder: index,
            updatedAt: now,
          }),
        ),
      );
      return { success: true };
    }),

  getById: employeesDirectoryQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      if (isAuthDisabled() || !hasMongoConfigured()) {
        const list = mock.mockUserList();
        return list.users.find((u) => u.id === input.id) ?? null;
      }
      await ensureSchema();
      const user = await findById<UserDoc>(Collections.users, input.id);
      return user ? omitPasswordHash(user) : null;
    }),

  getPersonalInfo: employeesDirectoryQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const canManageHead = hasPermission(ctx.user, "profile.head_of_department");

      if (isAuthDisabled() || !hasMongoConfigured()) {
        const view = mock.mockGetPersonalInfo(input.id, { includePrivateNotes: false });
        if (!canManageHead) {
          return {
            ...view,
            headOfDepartmentUserIds: [],
            headsOfDepartment: [],
          };
        }
        return view;
      }

      await ensureSchema();
      await expireFinishedNoticePeriods(ctx.user.organizationId);
      const user = await findById<UserDoc>(Collections.users, input.id);
      if (!user) {
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      }

      // Never expose private notes to admin/HR when viewing another employee.
      const view = await toPersonalInfoView(omitPasswordHash(user), {
        includePrivateNotes: false,
      });
      if (!canManageHead) {
        return {
          ...view,
          headOfDepartmentUserIds: [],
          headsOfDepartment: [],
        };
      }
      return view;
    }),

  updatePersonalInfo: employeesDirectoryQuery
    .input(z.object({ id: z.number() }).merge(personalInfoUpdateSchema))
    .mutation(async ({ ctx, input }) => {
      if (input.headOfDepartmentUserIds !== undefined) {
        assertPermission(ctx.user, "profile.head_of_department");
      }

      const canManageHead = hasPermission(ctx.user, "profile.head_of_department");
      const { id, ...rawData } = input;
      const data = restrictPersonalInfoInputForCaller(ctx.user, rawData);

      if (isAuthDisabled() || !hasMongoConfigured()) {
        if (data.email) {
          const current = mock.mockFindUserById(id);
          data.email = await assertWorkEmailAvailable(
            data.email,
            id,
            current?.organizationId,
            (email) => mock.mockFindUsersByEmail(email),
          );
        }
        const view = mock.mockUpdatePersonalInfo(id, data, { includePrivateNotes: false });
        if (!canManageHead) {
          return {
            ...view,
            headOfDepartmentUserIds: [],
            headsOfDepartment: [],
          };
        }
        return view;
      }

      await ensureSchema();
      const existing = await findById<UserDoc>(Collections.users, id);
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      }

      if (data.email) {
        data.email = await assertWorkEmailAvailable(
          data.email,
          id,
          existing.organizationId,
          (email) => findUsersByEmail(email),
        );
      }

      // Admin schema has no privateNotes — owner notes are never overwritten here.
      const patch = buildPersonalInfoUserPatch(data, existing, { allowEmailChange: true });
      const updated = await updateById<UserDoc>(Collections.users, id, patch);
      if (!updated) {
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      }

      invalidateAuthUserCache(id);
      await syncEmployeeFromUser(updated);
      const view = await toPersonalInfoView(omitPasswordHash(updated), {
        includePrivateNotes: false,
      });
      if (!canManageHead) {
        return {
          ...view,
          headOfDepartmentUserIds: [],
          headsOfDepartment: [],
        };
      }
      return view;
    }),

  update: employeesManageQuery
    .input(z.object({
      id: z.number(),
      name: z.string().optional(),
      role: z.enum(["admin", "manager", "employee", "hr", "client", "finance"]).optional(),
      status: z.enum(["active", "inactive", "suspended"]).optional(),
      department: z.string().nullable().optional(),
      position: z.string().nullable().optional(),
      phone: z.string().nullable().optional(),
      permissions: z.array(z.string()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      const isPermissionsOnly =
        data.permissions !== undefined &&
        data.name === undefined &&
        data.role === undefined &&
        data.status === undefined &&
        data.department === undefined &&
        data.position === undefined &&
        data.phone === undefined;

      if (isPermissionsOnly) {
        assertPermission(ctx.user, "permissions.manage");
      } else if (data.permissions !== undefined) {
        assertAnyPermission(ctx.user, ["employees.manage", "permissions.manage"]);
        if (
          data.name !== undefined ||
          data.role !== undefined ||
          data.status !== undefined ||
          data.department !== undefined ||
          data.position !== undefined ||
          data.phone !== undefined
        ) {
          assertPermission(ctx.user, "employees.manage");
        }
      } else {
        assertPermission(ctx.user, "employees.manage");
      }

      if (isAuthDisabled() || !hasMongoConfigured()) {
        return mock.mockAdminUpdateUser(input);
      }

      const existing = await findById<UserDoc>(Collections.users, id);
      if (!existing || !belongsToUserOrg(ctx.user, existing.organizationId)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      }
      if (existing.role === "admin" && data.permissions !== undefined) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Admin permissions cannot be changed here",
        });
      }

      const patch: Partial<UserDoc> = { updatedAt: new Date() };
      if (data.name !== undefined) patch.name = data.name;
      if (data.role !== undefined) patch.role = data.role;
      if (data.status !== undefined) patch.status = data.status;
      if (data.department !== undefined) patch.department = data.department;
      if (data.position !== undefined) patch.position = data.position;
      if (data.phone !== undefined) patch.phone = data.phone;
      if (data.permissions !== undefined) {
        const nextRole = data.role ?? existing.role;
        patch.permissions =
          String(nextRole ?? "").toLowerCase() === "client"
            ? data.permissions.filter((key) => key !== "invoices.manage")
            : data.permissions;
      }

      const updated = await updateById<UserDoc>(Collections.users, id, patch);
      if (updated) invalidateAuthUserCache(id);
      if (updated?.role === "employee") {
        const synced = await syncEmployeeFromUser(updated);
        if (!synced && updated.status === "active") {
          await createEmployeeFromUser(updated);
        } else if (updated.status !== "active") {
          await deactivateEmployeeByUserId(updated.id);
        }
      }
      return updated ? omitPasswordHash(updated) : null;
    }),

  updateClientAccess: employeesManageQuery
    .input(
      z.object({
        id: z.number(),
        clientCanViewTimeTracking: z.boolean(),
        clientCanViewDueDate: z.boolean(),
        assignedEmployeeIds: z.array(z.number()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (isAuthDisabled() || !hasMongoConfigured()) {
        return mock.mockAdminUpdateUser({
          id: input.id,
          clientCanViewTimeTracking: input.clientCanViewTimeTracking,
          clientCanViewDueDate: input.clientCanViewDueDate,
          assignedEmployeeIds: input.assignedEmployeeIds,
        });
      }

      const existing = await findById<UserDoc>(Collections.users, input.id);
      if (!existing || !belongsToUserOrg(ctx.user, existing.organizationId)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      }
      if (String(existing.role ?? "").toLowerCase() !== "client") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Portal access can only be set for invited clients",
        });
      }

      const orgUsers = await getCollection<UserDoc>(Collections.users);
      const requestedIds = assignedEmployeeIdsOf({
        assignedEmployeeIds: input.assignedEmployeeIds,
      });
      const staff = requestedIds.length
        ? await orgUsers
            .find({
              ...orgFilter(ctx.user),
              id: { $in: requestedIds },
            })
            .toArray()
        : [];
      const assignedEmployeeIds = staff
        .filter((u) => {
          const role = String(u.role ?? "").toLowerCase();
          return role !== "client" && role !== "platform" && isTaskAssignableUser(u);
        })
        .map((u) => u.id);

      const updated = await updateById<UserDoc>(Collections.users, input.id, {
        clientCanViewTimeTracking: input.clientCanViewTimeTracking,
        clientCanViewDueDate: input.clientCanViewDueDate,
        assignedEmployeeIds,
        updatedAt: new Date(),
      });
      if (updated) invalidateAuthUserCache(input.id);
      return updated ? omitPasswordHash(updated) : null;
    }),

  updateRole: employeesManageQuery
    .input(z.object({
      id: z.number(),
      role: z.enum(["admin", "manager", "employee", "hr", "client", "finance"]),
    }))
    .mutation(async ({ input, ctx }) => {
      if (String(ctx.user.role ?? "").toLowerCase() === "client") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Clients can invite teammates as employees, but cannot change roles.",
        });
      }
      if (isAuthDisabled() || !hasMongoConfigured()) {
        return mock.mockAdminUpdateUser({ id: input.id, role: input.role });
      }

      const { DEFAULT_PERMISSIONS_BY_ROLE } = await import("@db/mongo/types");
      const permissions =
        input.role === "employee"
          ? await getEmployeeDefaultPermissions()
          : DEFAULT_PERMISSIONS_BY_ROLE[input.role];
      const updated = await updateById<UserDoc>(Collections.users, input.id, {
        role: input.role,
        permissions,
        // Account managers must remain able to sign in at /finance/login.
        ...(input.role === "finance" ? { status: "active" as const } : {}),
        updatedAt: new Date(),
      });
      if (updated) {
        invalidateAuthUserCache(updated.id);
        if (updated.role === "employee") {
          await createEmployeeFromUser(updated);
        } else if (updated.role !== "finance") {
          // Keep employee profile rows for account managers so staff records stay linked;
          // other non-employee roles drop the employees-collection row.
          await deleteEmployeeByUserId(updated.id);
        }
      }
      return updated ? omitPasswordHash(updated) : null;
    }),

  delete: employeesManageQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      if (isAuthDisabled() || !hasMongoConfigured()) {
        return mock.mockAdminUpdateUser({ id: input.id, status: "inactive" });
      }

      await deleteEmployeeByUserId(input.id);
      const updated = await updateById<UserDoc>(Collections.users, input.id, {
        status: "inactive",
        updatedAt: new Date(),
      });
      if (updated) invalidateAuthUserCache(input.id);
      return { success: Boolean(updated) };
    }),

  stats: employeesManageQuery
    .input(z.object({
      id: z.number(),
      period: z.string().optional(),
    }))
    .query(async ({ input }) => {
      if (isAuthDisabled() || !hasMongoConfigured()) {
        return { totalHours: 0, tasksCompleted: 0, tasksInProgress: 0 };
      }
      await ensureSchema();
      const { id } = input;
      const timeCol = await getCollection<TimeEntryDoc>(Collections.timeEntries);
      const taskCol = await getCollection<TaskDoc>(Collections.tasks);

      const entries = await timeCol.find({ userId: id }).toArray();
      const totalMinutes = entries.reduce((sum, e) => sum + (e.duration ?? 0), 0);

      const [tasksCompleted, tasksInProgress] = await Promise.all([
        taskCol.countDocuments({ assigneeId: id, status: "done" }),
        taskCol.countDocuments({ assigneeId: id, status: "in_progress" }),
      ]);

      return {
        totalHours: Math.round((totalMinutes / 60) * 10) / 10,
        tasksCompleted,
        tasksInProgress,
      };
    }),
});
