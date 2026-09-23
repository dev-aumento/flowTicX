const PROFILE_PREFS_KEY = "user-profile-prefs";

export type StoredProfilePrefs = {
  name?: string | null;
  email?: string | null;
  avatar?: string | null;
  department?: string | null;
  position?: string | null;
  phone?: string | null;
};

export function readProfilePrefs(userId: number): StoredProfilePrefs | null {
  try {
    const raw = localStorage.getItem(`${PROFILE_PREFS_KEY}-${userId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredProfilePrefs;
    // Department is authoritative from the server (admins can change it);
    // never re-apply a cached department over auth.me.
    if ("department" in parsed) {
      const { department: _ignored, ...rest } = parsed;
      return rest;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeProfilePrefs(userId: number, prefs: StoredProfilePrefs) {
  localStorage.setItem(`${PROFILE_PREFS_KEY}-${userId}`, JSON.stringify(prefs));
}

export function mergeProfilePrefs<T extends { id: number }>(
  user: T,
  fields: (keyof StoredProfilePrefs)[],
): T & StoredProfilePrefs {
  const prefs = readProfilePrefs(user.id);
  if (!prefs) return user;

  const merged = { ...user } as T & StoredProfilePrefs;
  for (const field of fields) {
    if (prefs[field] !== undefined) {
      (merged as StoredProfilePrefs)[field] = prefs[field];
    }
  }
  return merged;
}
