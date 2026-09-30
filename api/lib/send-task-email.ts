import { Collections } from "@db/mongo/collections";
import type { NotificationDoc, ProjectDoc, SafeUser, TaskDoc, UserDoc } from "@db/mongo/types";
import { findById, getCollection } from "../queries/connection";
import { isMailConfigured, sendMail } from "./mail";

export type TaskEmailKind = "assign" | "status" | "overdue" | "comment" | "mention";

export function taskEmailKind(
  type: NotificationDoc["type"],
  title: string,
): TaskEmailKind | null {
  if (type === "task_assigned") return "assign";
  if (type === "deadline_reminder") return "overdue";
  if (title === "Task status changed") return "status";
  if (title === "New comment on task") return "comment";
  if (title === "You were mentioned in a comment") return "mention";
  return null;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function taskUrl(taskId: number, projectName: string | null, activityId: number | null) {
  const base = process.env.APP_PUBLIC_URL?.trim().replace(/\/$/, "");
  if (!base) return null;
  const slug = (projectName ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  const path = slug
    ? `/projects/${slug}/tasks/task=${taskId}/`
    : `/tasks/task=${taskId}/`;
  const query = activityId != null && activityId > 0 ? `?activity=${activityId}` : "";
  return `${base}${path}${query}`;
}

function subjectFor(kind: TaskEmailKind, actorName: string, taskTitle: string) {
  if (kind === "assign") return `${actorName} assigned you “${taskTitle}”`;
  if (kind === "status") return `${actorName} updated the status of “${taskTitle}”`;
  if (kind === "overdue") return `“${taskTitle}” is overdue`;
  if (kind === "mention") return `${actorName} mentioned you on “${taskTitle}”`;
  return `${actorName} commented on “${taskTitle}”`;
}

function isActiveUser(status: string | null | undefined) {
  return String(status ?? "").toLowerCase() === "active";
}

export async function sendTaskNotificationEmails(input: {
  userIds: number[];
  taskId: number;
  actor: SafeUser | null;
  kind: TaskEmailKind;
  message: string;
  activityId?: number | null;
}) {
  if (!isMailConfigured() || input.userIds.length === 0) return;

  const usersCol = await getCollection<UserDoc>(Collections.users);
  const users = await usersCol
    .find({ id: { $in: input.userIds } })
    .project({ id: 1, email: 1, name: 1, status: 1 })
    .toArray();
  const recipients = users.filter(
    (user) => isActiveUser(user.status) && Boolean(user.email?.trim()),
  );
  if (recipients.length === 0) return;

  const task = await findById<TaskDoc>(Collections.tasks, input.taskId);
  const taskTitle = task?.title?.trim() || "a task";
  const project =
    task?.projectId != null ? await findById<ProjectDoc>(Collections.projects, task.projectId) : null;
  const actorName = input.actor?.name?.trim() || input.actor?.email?.trim() || "Someone";
  const subject = subjectFor(input.kind, actorName, taskTitle);
  const link = taskUrl(input.taskId, project?.name ?? null, input.activityId ?? null);
  const text = [input.message, link ? `Open the task: ${link}` : ""].filter(Boolean).join("\n\n");
  const html = [
    `<p style="margin:0 0 16px;font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#111827;">${escapeHtml(input.message)}</p>`,
    link
      ? `<p style="margin:0;font-family:Arial,sans-serif;"><a href="${escapeHtml(link)}" style="color:#2563EB;">Open the task</a></p>`
      : "",
  ].join("");

  await Promise.all(
    recipients.map(async (user) => {
      try {
        await sendMail({
          to: user.email!.trim(),
          subject,
          text,
          html,
        });
      } catch (error) {
        console.error(`[task-email] could not email user ${user.id}:`, error);
      }
    }),
  );
}
