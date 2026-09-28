import { createRouter, authedQuery, publicQuery } from "./middleware";
import { clearSessionCookie, createSessionForUser, invalidateAuthUserCache } from "./lib/auth";
import { ensureSchema } from "./lib/migrate";
import { isAuthDisabled } from "./lib/dev-mode";
import * as mock from "./lib/mock-store";
import { updateById, findById, getCollection } from "./queries/connection";
import { hashPassword, verifyPassword } from "./lib/password";
import { createUser, findUserByEmail, findUserById, findUsersByEmail, updateLastSignIn } from "./queries/users";
import { hasMongoConfigured } from "./queries/mongo";
import { DEFAULT_PERMISSIONS_BY_ROLE } from "@db/mongo/types";
import { syncEmployeeFromUser } from "./queries/employees";
import {
  buildPersonalInfoUserPatch,
  selfPersonalInfoUpdateSchema,
  toPersonalInfoView,
} from "./queries/personal-info";
import { assertPermission, hasPermission } from "./lib/permissions";
import { getOrganizationName } from "./lib/organization";
import { createOrganization, getOrganizationNameById } from "./lib/tenant";
import {
  healPortalUser,
  isClientWorkspaceUser,
  toSessionUser,
} from "./lib/client-workspace";
import { assertActiveSubscription } from "./lib/subscription-access";
import { findPlatformPlan } from "./lib/platform-plans";
import { queuePlanNotification } from "./lib/notify-plan";
import { ALL_PERMISSION_KEYS } from "@contracts/permissions";
import { Collections } from "@db/mongo/collections";
import type { OrganizationDoc, UserDoc } from "@db/mongo/types";
import { TRPCError } from "@trpc/server";
import {
  consumeClientLoginCode,
  createClientLoginTicket,
  createLoginCode,
  issueClientLoginCode,
  readClientLoginTicket,
  resendClientLoginCode,
} from "./lib/client-login-challenge";
import { isLoginEmailConfigured, sendClientLoginCodeEmail } from "./lib/send-login-code";
import { nanoid } from "nanoid";
import { z } from "zod";
import { canManageNoticePeriod } from "@/lib/leave-policy";
import type { SelfPersonalInfoUpdateInput } from "./queries/personal-info";

const profileUpdateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  department: z.string().max(100).nullable().optional(),
  position: z.string().max(100).nullable().optional(),
  phone: z.string().max(20).nullable().optional(),
  avatar: z.string().max(3_000_000).nullable().optional(),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(8).max(128),
});

function splitName(fullName: string) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: null as string | null, lastName: null as string | null };
  if (parts.length === 1) return { firstName: parts[0], lastName: null as string | null };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

function useMemoryStore() {
  return !hasMongoConfigured();
}

function workspaceRoleLabel(user: { role?: string | null; position?: string | null }) {
  const position = user.position?.trim();
  if (position) return position;
  switch (String(user.role ?? "").toLowerCase()) {
    case "admin":
      return "Administrator";
    case "manager":
      return "Project Manager";
    case "hr":
      return "HR";
    case "finance":
      return "Account Manager";
    case "client":
      return "Client";
    case "platform":
      return "Platform Admin";
    default:
      return "Team Member";
  }
}

async function findLoginUser(email: string, organizationId?: number) {
  const normalized = email.trim().toLowerCase();
  const matches = useMemoryStore()
    ? mock.mockFindUsersByEmail(normalized)
    : await findUsersByEmail(normalized);
  if (organizationId != null && organizationId > 0) {
    return matches.find((user) => user.organizationId === organizationId) ?? null;
  }
  return matches[0] ?? null;
}

async function listLoginWorkspaces(candidates: UserDoc[]) {
  const workspaces: Array<{
    organizationId: number;
    organizationName: string;
    roleLabel: string;
  }> = [];
  let portal: "client" | "finance" | "platform" | null = null;
  let sawInactive = false;

  for (const user of candidates) {
    if (String(user.status).toLowerCase() !== "active") {
      sawInactive = true;
      continue;
    }
    const role = String(user.role ?? "").toLowerCase();
    if (role === "platform") {
      portal ??= "platform";
      continue;
    }

    const organizationName = useMemoryStore()
      ? mock.mockGetOrganizationName()
      : await getOrganizationNameById(user.organizationId);
    workspaces.push({
      organizationId: user.organizationId && user.organizationId > 0 ? user.organizationId : 0,
      organizationName,
      roleLabel: workspaceRoleLabel(user),
    });
  }

  workspaces.sort((a, b) => a.organizationName.localeCompare(b.organizationName));

  return {
    workspaces,
    portal: workspaces.length > 0 ? null : portal,
    inactive: workspaces.length === 0 && portal == null && sawInactive,
  };
}

async function clientAccountsForPassword(email: string, password: string) {
  const normalized = email.trim().toLowerCase();
  const matches = useMemoryStore()
    ? mock.mockFindUsersByEmail(normalized)
    : await findUsersByEmail(normalized);
  const passwordMatches: UserDoc[] = [];
  for (const user of matches) {
    if (!user.passwordHash) continue;
    if (String(user.status).toLowerCase() !== "active") continue;
    if (!(await verifyPassword(password, user.passwordHash))) continue;
    passwordMatches.push(user);
  }
  if (passwordMatches.length === 0) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Invalid email or password",
    });
  }

  const clients: UserDoc[] = [];
  for (const user of passwordMatches) {
    if (await isClientWorkspaceUser(user)) clients.push(user);
  }
  if (clients.length === 0) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This account is not a client workspace. Use the main sign-in page.",
    });
  }
  return { email: normalized, clients };
}

async function describeClientWorkspaces(users: UserDoc[]) {
  const workspaces = [];
  for (const user of users) {
    const organizationName = useMemoryStore()
      ? mock.mockGetOrganizationName()
      : await getOrganizationNameById(user.organizationId);
    workspaces.push({
      userId: user.id,
      organizationId: user.organizationId && user.organizationId > 0 ? user.organizationId : 0,
      organizationName,
      roleLabel: workspaceRoleLabel(user),
    });
  }
  workspaces.sort((a, b) => a.organizationName.localeCompare(b.organizationName));
  return workspaces;
}

async function emailClientLoginCode(email: string, code: string) {
  try {
    const sent = await sendClientLoginCodeEmail(email, code);
    const previewCode =
      !sent.delivered && process.env.NODE_ENV !== "production" ? code : undefined;
    return { delivered: sent.delivered, previewCode };
  } catch (error) {
    console.error("[client-login] Failed to email sign-in code:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Unable to email the sign-in code. Please try again.",
    });
  }
}

async function platformAdminExists() {
  if (useMemoryStore()) return mock.mockHasUserWithRole("platform");
  const userCol = await getCollection<UserDoc>(Collections.users);
  const existing = await userCol.findOne({ role: "platform" });
  return !!existing;
}

async function assertPlatformSignupAvailable() {
  if (await platformAdminExists()) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "A platform administrator already exists. Sign in at /admin/login.",
    });
  }
}

async function assertLoginPortal(
  user: { role?: string | null; organizationId?: number | null },
  portal?: "finance" | "client" | "platform",
) {
  const normalized = String(user.role ?? "").toLowerCase();
  if (portal === "platform" && normalized !== "platform") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This portal is for Aaso platform administrators. Use the main login instead.",
    });
  }
  if (normalized === "platform" && portal !== "platform") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Platform administrators sign in at /admin/login",
    });
  }
  if (portal === "finance" && normalized !== "finance") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This portal is for account managers only. Use the main login instead.",
    });
  }
  if (normalized === "finance" && portal && portal !== "finance") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Account managers sign in at /finance/login",
    });
  }

  const clientWorkspace = await isClientWorkspaceUser(user);
  if (portal === "client" && !clientWorkspace) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This portal is for client workspaces. Staff accounts sign in at /login.",
    });
  }
}

async function registerMemoryUser(
  input: {
    name: string;
    email: string;
    password: string;
    organizationName: string;
    role: "admin" | "client" | "finance" | "platform";
  },
  ctx: { req: Request; resHeaders: Headers },
) {
  const email = input.email.trim().toLowerCase();
  if (mock.mockFindUserByEmail(email)) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "An account with this email already exists",
    });
  }

  const passwordHash = await hashPassword(input.password);
  const roleDefaults = {
    admin: {
      department: "Management",
      position: "Administrator",
      permissions: [...ALL_PERMISSION_KEYS],
    },
    client: {
      department: "Client",
      position: "Client",
      permissions: [...DEFAULT_PERMISSIONS_BY_ROLE.client],
    },
    finance: {
      department: "Finance",
      position: "Account Manager",
      permissions: [...DEFAULT_PERMISSIONS_BY_ROLE.finance],
    },
    platform: {
      department: "Platform",
      position: "Master Admin",
      permissions: [...DEFAULT_PERMISSIONS_BY_ROLE.platform],
    },
  }[input.role];

  const user = mock.mockCreateRegisteredUser({
    name: input.name,
    email,
    passwordHash,
    role: input.role,
    organizationName: input.organizationName,
    department: roleDefaults.department,
    position: roleDefaults.position,
    permissions: roleDefaults.permissions,
  });

  const token = await createSessionForUser(user.id, ctx.req.headers, ctx.resHeaders);
  return {
    user: await toSessionUser(user, input.role === "client"),
    organizationName: mock.mockGetOrganizationName(),
    token,
  };
}

export const authRouter = createRouter({
  me: publicQuery.query(async ({ ctx }) => {
    if (!ctx.user) return null;
    await assertActiveSubscription(ctx.user, {
      reqHeaders: ctx.req.headers,
      resHeaders: ctx.resHeaders,
    });
    if (hasMongoConfigured() && !isAuthDisabled()) {
      try {
        const fresh = await findById<UserDoc>(Collections.users, ctx.user.id);
        if (fresh) {
          const healed = await healPortalUser(fresh);
          await assertActiveSubscription(healed, {
            reqHeaders: ctx.req.headers,
            resHeaders: ctx.resHeaders,
          });
          return toSessionUser(healed);
        }
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        return toSessionUser(ctx.user);
      }
    }
    return toSessionUser(ctx.user);
  }),

  organizationName: publicQuery.query(async ({ ctx }) => {
    if (isAuthDisabled()) return { name: "Aaso" };
    if (useMemoryStore()) {
      return { name: mock.mockGetOrganizationName() };
    }
    try {
      await ensureSchema();
      if (ctx.user?.organizationId) {
        return { name: await getOrganizationNameById(ctx.user.organizationId) };
      }
      return { name: await getOrganizationName() };
    } catch {
      return { name: "Aaso" };
    }
  }),

  platformSignupAvailable: publicQuery.query(async () => {
    try {
      if (!useMemoryStore()) await ensureSchema();
      return { available: !(await platformAdminExists()) };
    } catch {
      return { available: false };
    }
  }),

  registerAdmin: publicQuery
    .input(
      z.object({
        name: z.string().min(1).max(255),
        email: z.string().email().max(320),
        password: z.string().min(8).max(128),
        organizationName: z.string().min(1).max(200),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (useMemoryStore()) {
        return registerMemoryUser({ ...input, role: "admin" }, ctx);
      }

      try {
        await ensureSchema();
      } catch (error) {
        console.error("[auth] Database setup failed:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            "Database setup failed. Check MONGODB_URI and ensure MongoDB is reachable.",
        });
      }

      const email = input.email.trim().toLowerCase();
      const existing = await findUserByEmail(email);
      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "An account with this email already exists",
        });
      }

      const passwordHash = await hashPassword(input.password);
      const { firstName, lastName } = splitName(input.name);
      const org = await createOrganization(input.organizationName, null);

      const user = await createUser({
        unionId: `admin_${nanoid()}`,
        organizationId: org.id,
        name: input.name.trim(),
        email,
        passwordHash,
        avatar: null,
        role: "admin",
        status: "active" as UserDoc["status"],
        department: "Management",
        position: "Administrator",
        phone: null,
        firstName,
        lastName,
        permissions: [...ALL_PERMISSION_KEYS],
      });

      await updateById<OrganizationDoc>(Collections.organizations, org.id, {
        createdBy: user.id,
        updatedAt: new Date(),
      });

      const catalog = await findPlatformPlan(org.plan ?? "trial");
      queuePlanNotification({
        kind: "joined",
        organizationId: org.id,
        organizationName: org.name,
        planName: catalog?.name ?? "Trial",
        actorId: user.id,
      });

      const token = await createSessionForUser(
        user.id,
        ctx.req.headers,
        ctx.resHeaders,
      );

      return {
        user: await toSessionUser(user, false),
        organizationName: org.name,
        token,
      };
    }),

  registerClient: publicQuery
    .input(
      z.object({
        name: z.string().min(1).max(255),
        email: z.string().email().max(320),
        password: z.string().min(8).max(128),
        organizationName: z.string().min(1).max(200),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (useMemoryStore()) {
        return registerMemoryUser({ ...input, role: "client" }, ctx);
      }

      try {
        await ensureSchema();
      } catch (error) {
        console.error("[auth] Database setup failed:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            "Database setup failed. Check MONGODB_URI and ensure MongoDB is reachable.",
        });
      }

      const email = input.email.trim().toLowerCase();
      const existing = await findUserByEmail(email);
      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "An account with this email already exists",
        });
      }

      const passwordHash = await hashPassword(input.password);
      const { firstName, lastName } = splitName(input.name);
      const org = await createOrganization(input.organizationName, null, {
        workspaceType: "client",
      });

      const user = await createUser({
        unionId: `client_${nanoid()}`,
        organizationId: org.id,
        name: input.name.trim(),
        email,
        passwordHash,
        avatar: null,
        role: "client",
        status: "active" as UserDoc["status"],
        department: "Client",
        position: "Client",
        phone: null,
        firstName,
        lastName,
      });

      await updateById<OrganizationDoc>(Collections.organizations, org.id, {
        createdBy: user.id,
        updatedAt: new Date(),
      });

      const catalog = await findPlatformPlan(org.plan ?? "trial");
      queuePlanNotification({
        kind: "joined",
        organizationId: org.id,
        organizationName: org.name,
        planName: catalog?.name ?? "Trial",
        actorId: user.id,
      });

      const token = await createSessionForUser(
        user.id,
        ctx.req.headers,
        ctx.resHeaders,
      );

      return {
        user: await toSessionUser(user, true),
        organizationName: org.name,
        token,
      };
    }),

  registerPlatform: publicQuery
    .input(
      z.object({
        name: z.string().min(1).max(255),
        email: z.string().email().max(320),
        password: z.string().min(8).max(128),
        organizationName: z.string().min(1).max(200).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (useMemoryStore()) {
        await assertPlatformSignupAvailable();
        return registerMemoryUser(
          {
            ...input,
            organizationName: input.organizationName?.trim() || "Aaso",
            role: "platform",
          },
          ctx,
        );
      }

      try {
        await ensureSchema();
      } catch (error) {
        console.error("[auth] Database setup failed:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            "Database setup failed. Check MONGODB_URI and ensure MongoDB is reachable.",
        });
      }

      await assertPlatformSignupAvailable();

      const email = input.email.trim().toLowerCase();
      const existing = await findUserByEmail(email);
      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "An account with this email already exists",
        });
      }

      const passwordHash = await hashPassword(input.password);
      const { firstName, lastName } = splitName(input.name);
      const org = await createOrganization(
        input.organizationName?.trim() || "Aaso",
        null,
        { workspaceType: "platform" },
      );

      const user = await createUser({
        unionId: `platform_${nanoid()}`,
        organizationId: org.id,
        name: input.name.trim(),
        email,
        passwordHash,
        avatar: null,
        role: "platform",
        status: "active" as UserDoc["status"],
        department: "Platform",
        position: "Master Admin",
        phone: null,
        firstName,
        lastName,
        permissions: [...DEFAULT_PERMISSIONS_BY_ROLE.platform],
      });

      await updateById<OrganizationDoc>(Collections.organizations, org.id, {
        createdBy: user.id,
        updatedAt: new Date(),
      });

      const token = await createSessionForUser(
        user.id,
        ctx.req.headers,
        ctx.resHeaders,
      );

      return {
        user: await toSessionUser(user, false),
        organizationName: org.name,
        token,
      };
    }),

  getPersonalInfo: authedQuery.query(async ({ ctx }) => {
    const canManageHead = hasPermission(ctx.user, "profile.head_of_department");

    if (isAuthDisabled() || useMemoryStore()) {
      const view = mock.mockGetPersonalInfo(ctx.user.id, { includePrivateNotes: true });
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
    const user = await findById<UserDoc>(Collections.users, ctx.user.id);
    if (!user) {
      throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
    }
    const view = await toPersonalInfoView(user, { includePrivateNotes: true });
    if (!canManageHead) {
      return {
        ...view,
        headOfDepartmentUserIds: [],
        headsOfDepartment: [],
      };
    }
    return view;
  }),

  updatePersonalInfo: authedQuery
    .input(selfPersonalInfoUpdateSchema)
    .mutation(async ({ ctx, input }) => {
      if (input.headOfDepartmentUserIds !== undefined) {
        assertPermission(ctx.user, "profile.head_of_department");
      }

      const canManageHead = hasPermission(ctx.user, "profile.head_of_department");
      const sanitized: SelfPersonalInfoUpdateInput = { ...input };
      if (!canManageNoticePeriod(ctx.user)) {
        delete sanitized.onNoticePeriod;
      }

      if (isAuthDisabled() || useMemoryStore()) {
        const view = mock.mockUpdatePersonalInfo(ctx.user.id, sanitized, {
          includePrivateNotes: true,
        });
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

      const patch = buildPersonalInfoUserPatch(sanitized, ctx.user);

      const updated = await updateById<UserDoc>(Collections.users, ctx.user.id, patch);
      if (!updated) {
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      }

      invalidateAuthUserCache(ctx.user.id);
      await syncEmployeeFromUser(updated);
      const view = await toPersonalInfoView(updated, { includePrivateNotes: true });
      if (!canManageHead) {
        return {
          ...view,
          headOfDepartmentUserIds: [],
          headsOfDepartment: [],
        };
      }
      return view;
    }),

  updateProfile: authedQuery
    .input(profileUpdateSchema)
    .mutation(async ({ ctx, input }) => {
      if (isAuthDisabled() || useMemoryStore()) {
        const updated = mock.mockUpdateUserProfile(ctx.user.id, input);
        return toSessionUser(updated, String(ctx.user.role).toLowerCase() === "client");
      }

      try {
        await ensureSchema();
      } catch (error) {
        console.error("[auth] Database setup failed:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Database is not available. Check your MongoDB connection.",
        });
      }

      const updated = await updateById<UserDoc>(Collections.users, ctx.user.id, {
        ...input,
        updatedAt: new Date(),
      });

      if (!updated) {
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      }

      invalidateAuthUserCache(ctx.user.id);
      await syncEmployeeFromUser(updated);

      return toSessionUser(updated);
    }),

  changePassword: authedQuery
    .input(changePasswordSchema)
    .mutation(async ({ ctx, input }) => {
      if (isAuthDisabled()) {
        return { success: true };
      }

      if (useMemoryStore()) {
        const user = mock.mockFindUserById(ctx.user.id);
        if (!user?.passwordHash) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Password change is not available for this account",
          });
        }
        const currentValid = await verifyPassword(input.currentPassword, user.passwordHash);
        if (!currentValid) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Current password is incorrect",
          });
        }
        if (input.currentPassword === input.newPassword) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "New password must be different from your current password",
          });
        }
        mock.mockSetPasswordHash(user.id, await hashPassword(input.newPassword));
        invalidateAuthUserCache(user.id);
        return { success: true };
      }

      try {
        await ensureSchema();
      } catch (error) {
        console.error("[auth] Database setup failed:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Database is not available. Check your MongoDB connection.",
        });
      }

      const user = await findById<UserDoc>(Collections.users, ctx.user.id);
      if (!user?.passwordHash) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Password change is not available for this account",
        });
      }

      const currentValid = await verifyPassword(input.currentPassword, user.passwordHash);
      if (!currentValid) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Current password is incorrect",
        });
      }

      if (input.currentPassword === input.newPassword) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "New password must be different from your current password",
        });
      }

      const passwordHash = await hashPassword(input.newPassword);
      const updated = await updateById<UserDoc>(Collections.users, ctx.user.id, {
        passwordHash,
        updatedAt: new Date(),
      });

      if (!updated) {
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      }

      invalidateAuthUserCache(ctx.user.id);
      await syncEmployeeFromUser(updated);

      return { success: true };
    }),

  resetPassword: publicQuery
    .input(
      z.object({
        email: z.string().email().max(320),
        newPassword: z.string().min(8).max(128),
      }),
    )
    .mutation(async ({ input }) => {
      if (isAuthDisabled()) {
        return { success: true };
      }

      if (useMemoryStore()) {
        const email = input.email.trim().toLowerCase();
        const user = mock.mockFindUserByEmail(email);
        if (!user) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "No account found with this email",
          });
        }
        if (user.status !== "active") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Account is not active",
          });
        }
        mock.mockSetPasswordHash(user.id, await hashPassword(input.newPassword));
        invalidateAuthUserCache(user.id);
        return { success: true };
      }

      try {
        await ensureSchema();
      } catch (error) {
        console.error("[auth] Database setup failed:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Database is not available. Check your MongoDB connection.",
        });
      }

      const email = input.email.trim().toLowerCase();
      const user = await findUserByEmail(email);
      if (!user) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No account found with this email",
        });
      }

      if (user.status !== "active") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Account is not active",
        });
      }

      const passwordHash = await hashPassword(input.newPassword);
      const updated = await updateById<UserDoc>(Collections.users, user.id, {
        passwordHash,
        updatedAt: new Date(),
      });

      if (!updated) {
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      }

      invalidateAuthUserCache(user.id);
      await syncEmployeeFromUser(updated);

      return { success: true };
    }),

  registerFinance: publicQuery
    .input(
      z.object({
        name: z.string().min(1).max(255),
        email: z.string().email().max(320),
        password: z.string().min(8).max(128),
        organizationName: z.string().min(1).max(200),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (useMemoryStore()) {
        return registerMemoryUser({ ...input, role: "finance" }, ctx);
      }

      try {
        await ensureSchema();
      } catch (error) {
        console.error("[auth] Database setup failed:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            "Database setup failed. Check MONGODB_URI and ensure MongoDB is reachable.",
        });
      }

      const email = input.email.trim().toLowerCase();
      const existing = await findUserByEmail(email);
      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "An account with this email already exists",
        });
      }

      const passwordHash = await hashPassword(input.password);
      const { firstName, lastName } = splitName(input.name);
      const org = await createOrganization(input.organizationName, null);

      const user = await createUser({
        unionId: `finance_${nanoid()}`,
        organizationId: org.id,
        name: input.name.trim(),
        email,
        passwordHash,
        avatar: null,
        role: "finance",
        status: "active" as UserDoc["status"],
        department: "Finance",
        position: "Account Manager",
        phone: null,
        firstName,
        lastName,
      });

      await updateById<OrganizationDoc>(Collections.organizations, org.id, {
        createdBy: user.id,
        updatedAt: new Date(),
      });

      const catalog = await findPlatformPlan(org.plan ?? "trial");
      queuePlanNotification({
        kind: "joined",
        organizationId: org.id,
        organizationName: org.name,
        planName: catalog?.name ?? "Trial",
        actorId: user.id,
      });

      const token = await createSessionForUser(
        user.id,
        ctx.req.headers,
        ctx.resHeaders,
      );

      return {
        user: await toSessionUser(user, false),
        organizationName: org.name,
        token,
      };
    }),

  lookupWorkspaces: publicQuery
    .input(z.object({ email: z.string().email().max(320) }))
    .mutation(async ({ input }) => {
      const email = input.email.trim().toLowerCase();
      if (useMemoryStore()) {
        return listLoginWorkspaces(mock.mockFindUsersByEmail(email));
      }

      try {
        await ensureSchema();
        return listLoginWorkspaces(await findUsersByEmail(email));
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error("[auth] Workspace lookup failed:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Unable to look up workspaces right now. Please try again.",
        });
      }
    }),

  lookupClientWorkspaces: publicQuery
    .input(z.object({ email: z.string().email().max(320) }))
    .mutation(async ({ input }) => {
      const email = input.email.trim().toLowerCase();
      try {
        const users = useMemoryStore()
          ? mock.mockFindUsersByEmail(email)
          : await findUsersByEmail(email);
        if (!useMemoryStore()) await ensureSchema();

        const clients: UserDoc[] = [];
        for (const user of users) {
          if (String(user.status).toLowerCase() !== "active") continue;
          if (await isClientWorkspaceUser(user)) clients.push(user);
        }

        if (clients.length === 0) {
          const listed = await listLoginWorkspaces(users);
          return {
            workspaces: [] as Array<{
              organizationId: number;
              organizationName: string;
              roleLabel: string;
            }>,
            portal: listed.portal,
            inactive: listed.inactive,
          };
        }

        const described = await describeClientWorkspaces(clients);
        return {
          workspaces: described.map(({ userId: _userId, ...workspace }) => workspace),
          portal: null as "client" | "finance" | "platform" | null,
          inactive: false,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error("[auth] Client workspace lookup failed:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Unable to look up workspaces right now. Please try again.",
        });
      }
    }),

  beginClientLogin: publicQuery
    .input(
      z.object({
        email: z.string().email().max(320),
        password: z.string().min(1).max(128),
      }),
    )
    .mutation(async ({ input }) => {
      if (!useMemoryStore()) await ensureSchema();
      const { email, clients } = await clientAccountsForPassword(input.email, input.password);
      const described = await describeClientWorkspaces(clients);
      const ticket = await createClientLoginTicket(
        email,
        described.map((workspace) => ({
          userId: workspace.userId,
          organizationId: workspace.organizationId,
        })),
      );
      return {
        ticket,
        workspaces: described.map(({ userId: _userId, ...workspace }) => workspace),
      };
    }),

  sendClientLoginCode: publicQuery
    .input(
      z.object({
        ticket: z.string().min(16).max(128),
        organizationId: z.number().int().nonnegative(),
      }),
    )
    .mutation(async ({ input }) => {
      const ticket = await readClientLoginTicket(input.ticket);
      if (!ticket) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Sign in again to continue.",
        });
      }
      const membership = ticket.memberships.find(
        (item) => item.organizationId === input.organizationId,
      );
      if (!membership) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Select a workspace to continue.",
        });
      }
      const code = createLoginCode();
      const challenge = await issueClientLoginCode({
        email: ticket.email,
        userId: membership.userId,
        organizationId: membership.organizationId,
        code,
      });
      const delivery = await emailClientLoginCode(ticket.email, code);
      if (!delivery.delivered && !delivery.previewCode) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: isLoginEmailConfigured()
            ? "Unable to email the sign-in code. Please try again."
            : "Sign-in codes can't be emailed yet. Ask your administrator to configure outgoing email.",
        });
      }
      return {
        challengeId: challenge.id,
        email: ticket.email,
        delivered: delivery.delivered,
        previewCode: delivery.previewCode,
        resendInSeconds: 30,
      };
    }),

  resendClientLoginCode: publicQuery
    .input(z.object({ challengeId: z.string().min(16).max(128) }))
    .mutation(async ({ input }) => {
      const code = createLoginCode();
      const result = await resendClientLoginCode(input.challengeId, code);
      if (result.error === "cooldown") {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: `Wait ${result.retryAfterSeconds}s before requesting another code.`,
        });
      }
      if (result.error === "expired" || result.error === "missing" || !result.record) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "This code expired. Sign in again.",
        });
      }
      const delivery = await emailClientLoginCode(result.record.email, code);
      if (!delivery.delivered && !delivery.previewCode) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Sign-in codes can't be emailed yet. Ask your administrator to configure outgoing email.",
        });
      }
      return {
        challengeId: result.record.id,
        email: result.record.email,
        delivered: delivery.delivered,
        previewCode: delivery.previewCode,
        resendInSeconds: 30,
      };
    }),

  verifyClientLogin: publicQuery
    .input(
      z.object({
        challengeId: z.string().min(16).max(128),
        code: z.string().regex(/^\d{6}$/),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const result = await consumeClientLoginCode(input.challengeId, input.code);
      if (result.error === "expired") {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "This code expired. Sign in again.",
        });
      }
      if (result.error === "locked") {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "Too many incorrect codes. Sign in again.",
        });
      }
      if (result.error !== null || !result.record) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "That code is incorrect.",
        });
      }

      const user = useMemoryStore()
        ? mock.mockFindUserById(result.record.userId)
        : await findUserById(result.record.userId);
      if (!user?.passwordHash || String(user.status).toLowerCase() !== "active") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Account is not active",
        });
      }
      if (!(await isClientWorkspaceUser(user))) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "This portal is for client workspaces.",
        });
      }

      const healed = useMemoryStore() ? user : await healPortalUser(user);
      await assertActiveSubscription(healed);
      if (!useMemoryStore()) await updateLastSignIn(user.id);
      else mock.mockUpdateLastSignIn(user.id);

      const token = await createSessionForUser(user.id, ctx.req.headers, ctx.resHeaders);
      return { user: await toSessionUser(healed), token };
    }),

  login: publicQuery
    .input(
      z.object({
        email: z.string().email(),
        password: z.string().min(1),
        /** Workspace chosen on the sign-in screen when an email belongs to more than one. */
        organizationId: z.number().int().positive().optional(),
        /** When set to finance, only finance-role accounts may sign in. */
        portal: z.enum(["finance", "client", "platform"]).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (useMemoryStore()) {
        const user = await findLoginUser(input.email, input.organizationId);
        if (!user?.passwordHash) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Invalid email or password",
          });
        }
        if (user.status !== "active") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Account is not active",
          });
        }
        const valid = await verifyPassword(input.password, user.passwordHash);
        if (!valid) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Invalid email or password",
          });
        }
        await assertLoginPortal(user, input.portal);
        await assertActiveSubscription(user);
        mock.mockUpdateLastSignIn(user.id);
        const token = await createSessionForUser(
          user.id,
          ctx.req.headers,
          ctx.resHeaders,
        );
        return { user: await toSessionUser(user), token };
      }

      try {
        await ensureSchema();

        const user = await findLoginUser(input.email, input.organizationId);

        if (!user?.passwordHash) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Invalid email or password",
          });
        }

        // Heal account managers wrongly marked inactive by the old employee-list orphan logic.
        if (
          user.role === "finance" &&
          String(user.status).toLowerCase() === "inactive"
        ) {
          const healed = await updateById<UserDoc>(Collections.users, user.id, {
            status: "active",
            updatedAt: new Date(),
          });
          if (healed) {
            invalidateAuthUserCache(user.id);
            Object.assign(user, healed);
          }
        }

        if (user.status !== "active") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Account is not active",
          });
        }

        const valid = await verifyPassword(input.password, user.passwordHash);
        if (!valid) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Invalid email or password",
          });
        }

        await assertLoginPortal(user, input.portal);

        const healed = await healPortalUser(user);
        Object.assign(user, healed);

        await assertActiveSubscription(user);

        await updateLastSignIn(user.id);
        const token = await createSessionForUser(
          user.id,
          ctx.req.headers,
          ctx.resHeaders,
        );

        return { user: await toSessionUser(user), token };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error("[auth] Login failed:", error);
        const message = error instanceof Error ? error.message : String(error);
        if (
          /electionId\/setVersion mismatch|primary marked stale|MongoServerSelectionError|not primary/i.test(
            message,
          )
        ) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message:
              "Database connection is updating after a cluster change. Please wait a few seconds and try again.",
          });
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            "Unable to sign in right now. Check the database connection and try again.",
        });
      }
    }),

  logout: publicQuery.mutation(async ({ ctx }) => {
    clearSessionCookie(ctx.req.headers, ctx.resHeaders);
    return { success: true };
  }),
});
