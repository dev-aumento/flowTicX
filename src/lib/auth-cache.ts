/** Auth snapshot for fast shell paint before auth.me returns. */

export type CachedAuthUser = {
  id: number;
  unionId: string;
  name: string | null;
  email: string | null;
  avatar: string | null;
  role: string;
  status: string;
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

const AUTH_CACHE_KEY = "tracker.auth.me.v4";

function storage(): Storage | null {
  try {
    return sessionStorage;
  } catch {
    return null;
  }
}

export function readAuthCache(): CachedAuthUser | undefined {
  try {
    const store = storage();
    if (!store) return undefined;

    const raw = store.getItem(AUTH_CACHE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as CachedAuthUser;
    if (!parsed?.id || !parsed?.role || !parsed?.status) return undefined;
    return {
      ...parsed,
      createdAt: new Date(parsed.createdAt),
      updatedAt: new Date(parsed.updatedAt),
      lastSignInAt: new Date(parsed.lastSignInAt),
    };
  } catch {
    return undefined;
  }
}

export function writeAuthCache(user: CachedAuthUser | null | undefined) {
  try {
    const store = storage();
    if (!store) return;

    if (!user) {
      sessionStorage.removeItem(AUTH_CACHE_KEY);
      localStorage.removeItem(AUTH_CACHE_KEY);
      return;
    }

    store.setItem(AUTH_CACHE_KEY, JSON.stringify(user));
    localStorage.removeItem(AUTH_CACHE_KEY);
  } catch {
    // Ignore quota / private-mode failures.
  }
}

export function clearAuthCache() {
  writeAuthCache(null);
}
