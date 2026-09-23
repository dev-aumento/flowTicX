import { formatWorkZoneDateTime } from "@/lib/timezone";

export type ProjectFunnelRole = "project_manager" | "assistant_manager" | "member";

export const PROJECT_ROLE_CONFIG: Record<
  ProjectFunnelRole,
  { label: string; bg: string; color: string }
> = {
  project_manager: {
    label: "Project manager",
    bg: "#DCFCE7",
    color: "#15803D",
  },
  assistant_manager: {
    label: "Project assistant manager",
    bg: "#FFEDD5",
    color: "#C2410C",
  },
  member: {
    label: "Project member",
    bg: "#DBEAFE",
    color: "#1D4ED8",
  },
};

export function formatProjectActiveDate(value?: string | Date | null) {
  return formatWorkZoneDateTime(value, {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function resolveProjectRole(
  projectCreatedBy: number | null | undefined,
  currentUserId: number | undefined,
  currentUserAppRole?: string | null,
): ProjectFunnelRole {
  if (currentUserId && projectCreatedBy === currentUserId) {
    return "project_manager";
  }
  if (currentUserAppRole === "manager" || currentUserAppRole === "admin") {
    return "assistant_manager";
  }
  return "member";
}

export function projectPerformancePercent(taskCount: number, completedCount: number) {
  if (taskCount === 0) return 0;
  return Math.round((completedCount / taskCount) * 100);
}
