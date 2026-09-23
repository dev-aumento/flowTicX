import type { CreateTaskFormData } from "@/components/tasks/CreateTaskModal";

const STORAGE_KEY = "task-create-prefill";

export type TaskCreatePrefillMode = "template" | "clone";

export type TaskCreatePrefill = {
  mode: TaskCreatePrefillMode;
  sourceTitle: string;
  form: Partial<CreateTaskFormData>;
};

export function setTaskCreatePrefill(prefill: TaskCreatePrefill) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(prefill));
}

export function consumeTaskCreatePrefill(): TaskCreatePrefill | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(STORAGE_KEY);
    return JSON.parse(raw) as TaskCreatePrefill;
  } catch {
    sessionStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

export function resolveCloneTitle(submittedTitle: string, sourceTitle: string) {
  const trimmed = submittedTitle.trim();
  if (trimmed === sourceTitle.trim()) {
    return `${sourceTitle.trim()} (copy)`;
  }
  return trimmed;
}
