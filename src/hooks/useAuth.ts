import { useCallback, useEffect, useMemo } from "react";
import { useNavigate } from "react-router";
import { AUTH_DISABLED, LOGIN_PATH } from "@/const";
import { trpc } from "@/providers/trpc";
import { clearAuthCache, readAuthCache, writeAuthCache } from "@/lib/auth-cache";
import { mergeProfilePrefs } from "@/lib/profile-prefs";
import { getDefaultHomePath, getLoginPathForUser } from "@/lib/permissions";
import { isPlanEndedMessage, writePlanEndedNotice } from "@/lib/plan-ended";
import { ALL_PLAN_FEATURE_KEYS } from "@/lib/plan-features";

type AuthUser = {
  id: number;
  unionId: string;
  name: string | null;
  email: string | null;
  avatar: string | null;
  role: "admin" | "manager" | "employee" | "hr" | "client" | "finance" | "platform";
  status: "active" | "inactive" | "suspended";
  department: string | null;
  position: string | null;
  phone: string | null;
  permissions: string[];
  createdAt: Date;
  updatedAt: Date;
  lastSignInAt: Date;
  clientWorkspace?: boolean;
  invitedStaffClient?: boolean;
  clientCanViewTimeTracking?: boolean;
  clientCanViewDueDate?: boolean;
  assignedEmployeeIds?: number[];
  plan?: string | null;
  planName?: string | null;
  planStatus?: string | null;
  planFeatures?: string[] | null;
};

const DEV_USER: AuthUser = {
  id: 1,
  unionId: "admin_union_001",
  name: "Sandeep",
  email: "sandeep@aumentoinfoway.com",
  avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Sandeep",
  role: "admin",
  status: "active",
  department: "Management",
  position: "Project Manager",
  phone: null,
  permissions: [],
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignInAt: new Date(),
  plan: "enterprise",
  planName: "Enterprise",
  planStatus: "paid",
  planFeatures: ALL_PLAN_FEATURE_KEYS,
};

type UseAuthOptions = {
  redirectOnUnauthenticated?: boolean;
  redirectPath?: string;
};

export function useAuth(_options?: UseAuthOptions) {
  const navigate = useNavigate();
  const utils = trpc.useUtils();

  const cachedUser = useMemo(() => readAuthCache(), []);

  const {
    data: user,
    isPending,
    error,
    refetch,
  } = trpc.auth.me.useQuery(undefined, {
    staleTime: 30_000,
    gcTime: 30 * 60_000,
    retry: false,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    placeholderData: cachedUser as never,
  });

  const planEnded = isPlanEndedMessage(error?.message);

  useEffect(() => {
    if (planEnded) {
      writePlanEndedNotice(error?.message);
      clearAuthCache();
      if (window.location.pathname !== "/plan-ended") {
        navigate("/plan-ended", { replace: true });
      }
    }
  }, [planEnded, error?.message, navigate]);

  useEffect(() => {
    if (planEnded) return;
    if (user) {
      writeAuthCache(user);
      return;
    }
    if (!isPending) {
      clearAuthCache();
    }
  }, [user, isPending, planEnded]);

  const lookupWorkspacesMutation = trpc.auth.lookupWorkspaces.useMutation();

  const loginMutation = trpc.auth.login.useMutation({
    onSuccess: async (result) => {
      writeAuthCache(result.user);
      utils.auth.me.setData(undefined, result.user);
      await utils.invalidate();
      navigate(getDefaultHomePath(result.user));
    },
  });

  const registerAdminMutation = trpc.auth.registerAdmin.useMutation({
    onSuccess: async (result) => {
      writeAuthCache(result.user);
      utils.auth.me.setData(undefined, result.user);
      await utils.invalidate();
      navigate(getDefaultHomePath(result.user));
    },
  });

  const registerClientMutation = trpc.auth.registerClient.useMutation({
    onSuccess: async (result) => {
      writeAuthCache(result.user);
      utils.auth.me.setData(undefined, result.user);
      await utils.invalidate();
      navigate(getDefaultHomePath(result.user));
    },
  });

  const registerFinanceMutation = trpc.auth.registerFinance.useMutation({
    onSuccess: async (result) => {
      writeAuthCache(result.user);
      utils.auth.me.setData(undefined, result.user);
      await utils.invalidate();
      navigate(getDefaultHomePath(result.user));
    },
  });

  const registerPlatformMutation = trpc.auth.registerPlatform.useMutation({
    onSuccess: async (result) => {
      writeAuthCache(result.user);
      utils.auth.me.setData(undefined, result.user);
      await utils.invalidate();
      navigate(getDefaultHomePath(result.user));
    },
  });

  const logoutMutation = trpc.auth.logout.useMutation();
  const resetPasswordMutation = trpc.auth.resetPassword.useMutation();

  const lookupWorkspaces = useCallback(
    (email: string) => {
      if (AUTH_DISABLED) {
        return Promise.resolve({
          workspaces: [
            {
              organizationId: 1,
              organizationName: "Aaso",
              roleLabel: "Administrator",
            },
          ],
          portal: null as "client" | "finance" | "platform" | null,
          inactive: false,
        });
      }
      return lookupWorkspacesMutation.mutateAsync({ email });
    },
    [lookupWorkspacesMutation],
  );

  const login = useCallback(
    (
      email: string,
      password: string,
      options?: { portal?: "finance" | "client" | "platform"; organizationId?: number },
    ) => {
      if (AUTH_DISABLED) {
        return Promise.resolve({ user: DEV_USER });
      }
      return loginMutation.mutateAsync({
        email,
        password,
        portal: options?.portal,
        organizationId: options?.organizationId,
      });
    },
    [loginMutation],
  );

  const registerAdmin = useCallback(
    (input: {
      name: string;
      email: string;
      password: string;
      organizationName: string;
    }) => {
      if (AUTH_DISABLED) {
        return Promise.resolve({ user: DEV_USER, organizationName: input.organizationName });
      }
      return registerAdminMutation.mutateAsync(input);
    },
    [registerAdminMutation],
  );

  const registerClient = useCallback(
    (input: {
      name: string;
      email: string;
      password: string;
      organizationName: string;
    }) => {
      if (AUTH_DISABLED) {
        return Promise.resolve({
          user: { ...DEV_USER, role: "client" as const },
          organizationName: input.organizationName,
        });
      }
      return registerClientMutation.mutateAsync(input);
    },
    [registerClientMutation],
  );

  const registerFinance = useCallback(
    (input: {
      name: string;
      email: string;
      password: string;
      organizationName: string;
    }) => {
      if (AUTH_DISABLED) {
        return Promise.resolve({
          user: { ...DEV_USER, role: "finance" as const },
          organizationName: input.organizationName,
        });
      }
      return registerFinanceMutation.mutateAsync(input);
    },
    [registerFinanceMutation],
  );

  const registerPlatform = useCallback(
    (input: {
      name: string;
      email: string;
      password: string;
      organizationName?: string;
    }) => {
      if (AUTH_DISABLED) {
        return Promise.resolve({
          user: { ...DEV_USER, role: "platform" as const, department: "Platform", position: "Master Admin" },
          organizationName: input.organizationName ?? "Aaso",
        });
      }
      return registerPlatformMutation.mutateAsync(input);
    },
    [registerPlatformMutation],
  );

  const resetPassword = useCallback(
    (email: string, newPassword: string) => {
      if (AUTH_DISABLED) {
        return Promise.resolve({ success: true });
      }
      return resetPasswordMutation.mutateAsync({ email, newPassword });
    },
    [resetPasswordMutation],
  );

  const baseUser = AUTH_DISABLED ? (user ?? DEV_USER) : planEnded ? null : (user ?? null);
  // With placeholderData, isPending is false immediately on reload so the shell
  // can mount and fire page queries in parallel with the background auth refresh.
  const authResolved = !isPending || !!baseUser;
  // Prefer auth.me for access-control fields (department/role). Local profile
  // prefs must not override department — stale/null prefs were keeping HR users
  // from being recognized, so task/project nav stayed visible.
  const effectiveUser = useMemo(
    () =>
      baseUser
        ? mergeProfilePrefs(baseUser, ["name", "email", "position", "phone"])
        : null,
    [baseUser],
  );

  const logout = useCallback(() => {
    const loginPath = getLoginPathForUser(effectiveUser ?? readAuthCache()) || LOGIN_PATH;
    if (AUTH_DISABLED) {
      clearAuthCache();
      utils.auth.me.setData(undefined, undefined);
      navigate(loginPath, { replace: true });
      return;
    }
    logoutMutation.mutate(undefined, {
      onSuccess: async () => {
        clearAuthCache();
        utils.auth.me.setData(undefined, undefined);
        await utils.invalidate();
        navigate(loginPath, { replace: true });
      },
      onError: async () => {
        clearAuthCache();
        utils.auth.me.setData(undefined, undefined);
        await utils.invalidate();
        navigate(loginPath, { replace: true });
      },
    });
  }, [effectiveUser, logoutMutation, navigate, utils]);

  return useMemo(
    () => ({
      user: effectiveUser,
      isAuthenticated: !!effectiveUser,
      isLoading: !authResolved || logoutMutation.isPending,
      isLoggingIn: loginMutation.isPending,
      isLookingUpWorkspaces: lookupWorkspacesMutation.isPending,
      isRegistering:
        registerAdminMutation.isPending ||
        registerClientMutation.isPending ||
        registerFinanceMutation.isPending ||
        registerPlatformMutation.isPending,
      isResettingPassword: resetPasswordMutation.isPending,
      loginError: loginMutation.error,
      error,
      login,
      lookupWorkspaces,
      registerAdmin,
      registerClient,
      registerFinance,
      registerPlatform,
      resetPassword,
      logout,
      refresh: refetch,
    }),
    [
      effectiveUser,
      authResolved,
      logoutMutation.isPending,
      loginMutation.isPending,
      lookupWorkspacesMutation.isPending,
      registerAdminMutation.isPending,
      registerClientMutation.isPending,
      registerFinanceMutation.isPending,
      registerPlatformMutation.isPending,
      resetPasswordMutation.isPending,
      loginMutation.error,
      error,
      login,
      lookupWorkspaces,
      registerAdmin,
      registerClient,
      registerFinance,
      registerPlatform,
      resetPassword,
      logout,
      refetch,
    ],
  );
}
