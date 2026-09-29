import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import { Invite } from "@contracts/constants";
import { Collections } from "@db/mongo/collections";
import type { EmployeeInviteDoc, InviteKind, NotificationDoc, UserDoc } from "@db/mongo/types";
import { createRouter, employeesManageQuery, publicQuery } from "./middleware";
import { ensureSchema } from "./lib/migrate";
import * as inviteMock from "./lib/invite-mock";
import { hashPassword } from "./lib/password";
import { createSessionForUser } from "./lib/auth";
import {
  findById,
  getCollection,
  hasMongoConfigured,
  insertDoc,
  updateById,
} from "./queries/connection";
import { createUser, findUserByEmail } from "./queries/users";
import {
  getOrganizationNameById,
  orgFilter,
  requireOrganizationId,
  resolveClientWorkspace,
} from "./lib/tenant";
import {
  CLIENT_WORKSPACE_MEMBER_PERMISSIONS,
  INVITED_CLIENT_PERMISSIONS,
  toSessionUser,
} from "./lib/client-workspace";
import { assertCanAddMember, assertCanInviteMember } from "./lib/plan-capacity";
import { getEmployeeDefaultPermissions } from "./lib/employee-defaults";
import { ensureCustomerFromClientUser } from "./lib/sync-customers-from-clients";

function inviteKindOf(invite: { inviteKind?: InviteKind | null } | null | undefined): InviteKind {
  return invite?.inviteKind === "client" ? "client" : "employee";
}

function inviteExpiryDate() {
  const date = new Date();
  date.setDate(date.getDate() + Invite.expiryDays);
  return date;
}

function buildInviteUrl(req: Request, token: string) {
  const origin = new URL(req.url).origin;
  return `${origin}/invite/${token}`;
}

async function expireStaleInvites() {
  const col = await getCollection<EmployeeInviteDoc>(Collections.employeeInvites);
  await col.updateMany(
    { status: "pending", expiresAt: { $lt: new Date() } },
    { $set: { status: "expired" } },
  );
}

async function getValidInvite(token: string) {
  await expireStaleInvites();
  const col = await getCollection<EmployeeInviteDoc>(Collections.employeeInvites);
  return col.findOne({ token });
}

async function notifyAdminsOfNewJoin(
  organizationId: number,
  newUserId: number,
  newUserName: string,
  newUserEmail: string,
  kind: InviteKind,
) {
  const usersCol = await getCollection<UserDoc>(Collections.users);
  const admins = await usersCol
    .find({
      organizationId,
      role: "admin",
      status: "active",
    })
    .toArray();

  if (admins.length === 0) return;

  const now = new Date();
  const isClient = kind === "client";
  const message = isClient
    ? `${newUserName || newUserEmail} accepted a client invite. Tasks they assign to your team will appear in Client's Tasks.`
    : `${newUserName || newUserEmail} accepted an invite. Review and assign their access level in Employees.`;

  await Promise.all(
    admins.map((admin) =>
      insertDoc<NotificationDoc>(Collections.notifications, {
        userId: admin.id,
        organizationId,
        actorId: newUserId,
        type: "employee_joined",
        title: isClient ? "New client joined" : "New employee joined",
        message,
        taskId: null,
        read: false,
        createdAt: now,
      }),
    ),
  );
}

function useInviteMock() {
  return !hasMongoConfigured();
}

export const inviteRouter = createRouter({
  create: employeesManageQuery
    .input(
      z.object({
        email: z.string().email().max(320),
        kind: z.enum(["employee", "client"]).default("employee"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const email = input.email.trim().toLowerCase();
      const organizationId = requireOrganizationId(ctx.user);
      const inviteKind: InviteKind = input.kind === "client" ? "client" : "employee";

      if (inviteKind === "client") {
        const orgIsClientWorkspace = await resolveClientWorkspace(organizationId);
        if (orgIsClientWorkspace) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "This workspace is already a client portal. Invite teammates instead.",
          });
        }
      }

      if (useInviteMock()) {
        const invite = inviteMock.mockCreateInvite(ctx.user.id, email, inviteKind);
        return {
          token: invite.token,
          url: buildInviteUrl(ctx.req, invite.token),
          expiresAt: invite.expiresAt,
          email: invite.email,
          inviteKind,
        };
      }

      await ensureSchema();
      await assertCanInviteMember(organizationId);

      const existingUser = await findUserByEmail(email);
      if (existingUser) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "An account with this email already exists",
        });
      }

      const col = await getCollection<EmployeeInviteDoc>(Collections.employeeInvites);
      const pendingForEmail = await col.findOne({
        email,
        organizationId,
        status: "pending",
        expiresAt: { $gt: new Date() },
      });
      if (pendingForEmail) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "A pending invite already exists for this email",
        });
      }

      const token = nanoid(Invite.tokenLength);
      const expiresAt = inviteExpiryDate();

      await insertDoc<EmployeeInviteDoc>(Collections.employeeInvites, {
        token,
        organizationId,
        invitedBy: ctx.user.id,
        email,
        department: null,
        inviteKind,
        expiresAt,
        status: "pending",
        acceptedUserId: null,
        acceptedAt: null,
        createdAt: new Date(),
      });

      return {
        token,
        url: buildInviteUrl(ctx.req, token),
        expiresAt,
        email,
        inviteKind,
      };
    }),

  list: employeesManageQuery.query(async ({ ctx }) => {
    if (useInviteMock()) {
      return {
        invites: inviteMock.mockListPendingInvites().map((invite) => ({
          id: invite.id,
          token: invite.token,
          email: invite.email,
          department: invite.department,
          inviteKind: inviteKindOf(invite),
          status: invite.status,
          expiresAt: invite.expiresAt,
          acceptedAt: null,
          createdAt: invite.createdAt,
          invitedByName: ctx.user.name,
          url: buildInviteUrl(ctx.req, invite.token),
        })),
      };
    }

    await ensureSchema();
    await expireStaleInvites();

    const col = await getCollection<EmployeeInviteDoc>(Collections.employeeInvites);
    const invites = await col
      .find({ ...orgFilter(ctx.user), status: "pending" })
      .sort({ createdAt: -1 })
      .limit(20)
      .toArray();

    const invitesWithMeta = await Promise.all(
      invites.map(async (invite) => {
        const inviter = await findById<UserDoc>(Collections.users, invite.invitedBy);
        return {
          id: invite.id,
          token: invite.token,
          email: invite.email,
          department: invite.department,
          inviteKind: inviteKindOf(invite),
          status: invite.status,
          expiresAt: invite.expiresAt,
          acceptedAt: invite.acceptedAt,
          createdAt: invite.createdAt,
          invitedByName: inviter?.name ?? null,
          url: buildInviteUrl(ctx.req, invite.token),
        };
      }),
    );

    return { invites: invitesWithMeta };
  }),

  revoke: employeesManageQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (useInviteMock()) {
        inviteMock.mockRevokeInvite(input.id);
        return { success: true };
      }

      await ensureSchema();
      const invite = await findById<EmployeeInviteDoc>(
        Collections.employeeInvites,
        input.id,
      );
      if (
        invite?.status === "pending" &&
        invite.organizationId === requireOrganizationId(ctx.user)
      ) {
        await updateById<EmployeeInviteDoc>(Collections.employeeInvites, input.id, {
          status: "revoked",
        });
      }
      return { success: true };
    }),

  validate: publicQuery
    .input(z.object({ token: z.string().min(1) }))
    .query(async ({ input }) => {
      if (useInviteMock()) {
        const invite = inviteMock.mockGetInvite(input.token);
        return {
          valid: !!invite,
          email: invite?.email ?? null,
          department: invite?.department ?? null,
          invitedByName: null,
          organizationName: "Aaso",
          expired: false,
          clientWorkspace: inviteKindOf(invite) === "client",
          inviteKind: inviteKindOf(invite),
        };
      }

      await ensureSchema();
      const invite = await getValidInvite(input.token);
      const organizationName = invite?.organizationId
        ? await getOrganizationNameById(invite.organizationId)
        : "Aaso";
      const clientWorkspace = invite?.organizationId
        ? await resolveClientWorkspace(invite.organizationId)
        : false;

      if (!invite || invite.status !== "pending") {
        return {
          valid: false,
          email: null,
          department: null,
          invitedByName: null,
          organizationName,
          expired: invite?.status === "expired",
          clientWorkspace,
          inviteKind: inviteKindOf(invite),
        };
      }

      if (invite.expiresAt < new Date()) {
        return {
          valid: false,
          email: null,
          department: null,
          invitedByName: null,
          organizationName,
          expired: true,
          clientWorkspace,
          inviteKind: inviteKindOf(invite),
        };
      }

      const inviter = await findById<UserDoc>(Collections.users, invite.invitedBy);

      return {
        valid: true,
        email: invite.email,
        department: invite.department,
        invitedByName: inviter?.name ?? null,
        organizationName,
        expired: false,
        clientWorkspace: clientWorkspace || inviteKindOf(invite) === "client",
        inviteKind: inviteKindOf(invite),
      };
    }),

  accept: publicQuery
    .input(
      z.object({
        token: z.string().min(1),
        name: z.string().min(1).max(255),
        email: z.string().email().max(320),
        password: z.string().min(8).max(128),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (!hasMongoConfigured()) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Database is not connected. Set MONGODB_STANDARD_HOSTS in .env and restart the dev server.",
        });
      }

      await ensureSchema();
      const invite = await getValidInvite(input.token);

      if (!invite || invite.status !== "pending") {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: invite?.status === "expired"
            ? "This invite link has expired"
            : "This invite link is invalid or has already been used",
        });
      }

      if (invite.expiresAt < new Date()) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This invite link has expired",
        });
      }

      if (invite.organizationId == null) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This invite is not linked to an organization",
        });
      }

      await assertCanAddMember(invite.organizationId);

      const email = input.email.toLowerCase();
      if (invite.email && invite.email.toLowerCase() !== email) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Please use the email address this invite was sent for",
        });
      }

      const existing = await findUserByEmail(email);
      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "An account with this email already exists",
        });
      }

      const passwordHash = await hashPassword(input.password);
      const now = new Date();
      const inviteKind = inviteKindOf(invite);
      const clientWorkspace = await resolveClientWorkspace(invite.organizationId);
      const isInvitedClient = inviteKind === "client";
      const permissions = isInvitedClient
        ? [...INVITED_CLIENT_PERMISSIONS]
        : clientWorkspace
          ? [
              ...new Set([
                ...(await getEmployeeDefaultPermissions()),
                ...CLIENT_WORKSPACE_MEMBER_PERMISSIONS,
              ]),
            ]
          : undefined;

      const user = await createUser({
        unionId: `invite_${nanoid()}`,
        organizationId: invite.organizationId,
        name: input.name,
        email,
        passwordHash,
        avatar: null,
        role: isInvitedClient ? "client" : "employee",
        status: "active" as UserDoc["status"],
        department: invite.department,
        position: isInvitedClient ? "Client" : null,
        phone: null,
        permissions,
      }, { inviteId: isInvitedClient ? null : invite.id });

      await updateById<EmployeeInviteDoc>(Collections.employeeInvites, invite.id, {
        status: "accepted",
        acceptedUserId: user.id,
        acceptedAt: now,
      });

      if (isInvitedClient) {
        await ensureCustomerFromClientUser(invite.organizationId, user, invite.invitedBy);
      }

      await notifyAdminsOfNewJoin(
        invite.organizationId,
        user.id,
        input.name,
        email,
        inviteKind,
      );
      const sessionToken = await createSessionForUser(
        user.id,
        ctx.req.headers,
        ctx.resHeaders,
      );

      return {
        user: await toSessionUser(user, isInvitedClient || clientWorkspace),
        token: sessionToken,
      };
    }),
});
