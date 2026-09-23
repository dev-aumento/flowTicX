export const TASK_FAVORITES_KEY = "task-favorites";
export const TASK_PREFS_CHANGED_EVENT = "task-prefs-changed";

export function readFavoriteIds(): number[] {
  try {
    const stored = localStorage.getItem(TASK_FAVORITES_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

export function isTaskFavorite(taskId: number): boolean {
  return readFavoriteIds().includes(taskId);
}

export function readTaskPref<T>(taskId: number, key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`task-${key}-${taskId}`);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeTaskPref(taskId: number, key: string, value: unknown) {
  localStorage.setItem(`task-${key}-${taskId}`, JSON.stringify(value));
  window.dispatchEvent(
    new CustomEvent(TASK_PREFS_CHANGED_EVENT, { detail: { taskId, key } }),
  );
}

export function setTaskFavorite(taskId: number, favorite: boolean) {
  const favorites = readFavoriteIds();
  const next = favorite
    ? favorites.includes(taskId)
      ? favorites
      : [...favorites, taskId]
    : favorites.filter((id) => id !== taskId);
  localStorage.setItem(TASK_FAVORITES_KEY, JSON.stringify(next));
  window.dispatchEvent(
    new CustomEvent(TASK_PREFS_CHANGED_EVENT, { detail: { taskId, key: "favorite" } }),
  );
  return next;
}
