// Type exports — data is stored in MongoDB (see db/mongo/types.ts)
export type {
  UserDoc as User,
  SafeUser,
  EmployeeInviteDoc as EmployeeInvite,
  ProjectDoc as Project,
  TaskDoc as Task,
  TimeEntryDoc as TimeEntry,
  SubtaskDoc as Subtask,
  NotificationDoc as Notification,
  TaskActivityDoc as TaskActivity,
  WorkSessionDoc as WorkSession,
  TaskTagDoc as TaskTag,
  TaskAttachmentDoc as TaskAttachment,
  UserRole,
  UserStatus,
} from "./mongo/types";

export type InsertUser = Omit<import("./mongo/types").UserDoc, "id" | "createdAt" | "updatedAt" | "lastSignInAt">;
export type InsertProject = Omit<import("./mongo/types").ProjectDoc, "id" | "createdAt" | "updatedAt">;
export type InsertTask = Omit<import("./mongo/types").TaskDoc, "id" | "createdAt" | "updatedAt">;
export type InsertTimeEntry = Omit<import("./mongo/types").TimeEntryDoc, "id" | "createdAt" | "updatedAt">;
export type InsertEmployeeInvite = Omit<import("./mongo/types").EmployeeInviteDoc, "id" | "createdAt">;

// Legacy table name exports for gradual migration (routers should use Collections)
export const users = "users" as const;
export const employeeInvites = "employee_invites" as const;
export const projects = "projects" as const;
export const tasks = "tasks" as const;
export const timeEntries = "time_entries" as const;
export const subtasks = "subtasks" as const;
export const notifications = "notifications" as const;
export const taskActivity = "task_activity" as const;
export const workSessions = "work_sessions" as const;
export const taskTags = "task_tags" as const;
export const taskAttachments = "task_attachments" as const;
export const taskParticipants = "task_participants" as const;
export const taskTagRelations = "task_tag_relations" as const;
export const taskAssignees = "task_assignees" as const;
