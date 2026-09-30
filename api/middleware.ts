import { ErrorMessages } from "@contracts/constants";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { hasPermission, canViewDepartments } from "./lib/permissions";
import { assertActiveSubscription } from "./lib/subscription-access";
import { runWithRequestOrigin } from "./lib/request-origin";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const createRouter = t.router;
export const publicQuery = t.procedure;

const requireAuth = t.middleware(async (opts) => {
  const { ctx, next } = opts;

    if (!ctx.user) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: ErrorMessages.unauthenticated,
      });
    }

    await assertActiveSubscription(ctx.user, {
      reqHeaders: ctx.req.headers,
      resHeaders: ctx.resHeaders,
    });

    return runWithRequestOrigin(ctx.req, () => next({ ctx: { ...ctx, user: ctx.user } }));
});

function requireRole(role: string) {
  return t.middleware(async (opts) => {
    const { ctx, next } = opts;

    if (!ctx.user || ctx.user.role !== role) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: ErrorMessages.insufficientRole,
      });
    }

    return next({ ctx: { ...ctx, user: ctx.user } });
  });
}

function requireManagerOrAbove() {
  return t.middleware(async (opts) => {
    const { ctx, next } = opts;

    if (!ctx.user || (ctx.user.role !== "admin" && ctx.user.role !== "manager")) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: ErrorMessages.insufficientRole,
      });
    }

    return next({ ctx: { ...ctx, user: ctx.user } });
  });
}

/** Admin or HR can review manual time approval requests. */
function requireAdminOrHr() {
  return t.middleware(async (opts) => {
    const { ctx, next } = opts;

    if (!ctx.user || (ctx.user.role !== "admin" && ctx.user.role !== "hr")) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: ErrorMessages.insufficientRole,
      });
    }

    return next({ ctx: { ...ctx, user: ctx.user } });
  });
}

/** Admin role, or any user granted `employees.manage` or `permissions.manage`. */
function requireEmployeesManage() {
  return t.middleware(async (opts) => {
    const { ctx, next } = opts;

    if (!ctx.user) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: ErrorMessages.unauthenticated,
      });
    }

    if (
      !hasPermission(ctx.user, "employees.manage") &&
      !hasPermission(ctx.user, "permissions.manage")
    ) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: ErrorMessages.insufficientRole,
      });
    }

    return next({ ctx: { ...ctx, user: ctx.user } });
  });
}

/**
 * Employee directory view/edit: employees.view / employees.manage / permissions.manage,
 * or project manager role. Full edits still require employees.manage.
 */
function requireEmployeesDirectoryAccess() {
  return t.middleware(async (opts) => {
    const { ctx, next } = opts;

    if (!ctx.user) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: ErrorMessages.unauthenticated,
      });
    }

    if (canViewDepartments(ctx.user)) {
      return next({ ctx: { ...ctx, user: ctx.user } });
    }

    throw new TRPCError({
      code: "FORBIDDEN",
      message: ErrorMessages.insufficientRole,
    });
  });
}

export const authedQuery = t.procedure.use(requireAuth);
export const platformQuery = authedQuery.use(requireRole("platform"));
export const adminQuery = authedQuery.use(requireRole("admin"));
export const adminOrHrQuery = authedQuery.use(requireAdminOrHr());
export const managerQuery = authedQuery.use(requireManagerOrAbove());
export const employeesManageQuery = authedQuery.use(requireEmployeesManage());
export const employeesDirectoryQuery = authedQuery.use(requireEmployeesDirectoryAccess());
