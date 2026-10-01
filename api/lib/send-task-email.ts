import { Collections } from "@db/mongo/collections";
import type { NotificationDoc, ProjectDoc, SafeUser, TaskDoc, UserDoc } from "@db/mongo/types";
import { formatDueLabel } from "@/lib/task-deadline";
import { formatWorkZoneDateTime } from "@/lib/timezone";
import { getAvatarColor, getInitials } from "@/lib/utils";
import { findById, getCollection } from "../queries/connection";
import { isMailConfigured, senderDisplayName, sendMail } from "./mail";
import { publicAppOrigin } from "./request-origin";

export type TaskEmailKind =
  | "assign"
  | "status"
  | "overdue"
  | "comment"
  | "mention"
  | "completed"
  | "participant"
  | "updated";

const TEXT = "#111827";
const BUTTON = "#2563EB";

export function taskEmailKind(
  type: NotificationDoc["type"],
  title: string,
): TaskEmailKind | null {
  if (type === "task_assigned") return "assign";
  if (type === "deadline_reminder") return "overdue";
  if (title === "Task marked finished") return "completed";
  if (title === "Task status changed") return "status";
  if (title === "New comment on task") return "comment";
  if (title === "You were mentioned in a comment") return "mention";
  if (title === "Added as participant") return "participant";
  if (
    title === "Task renamed" ||
    title === "Task stage changed" ||
    title === "Task marked urgent" ||
    title === "Task priority changed" ||
    title === "Task reassigned" ||
    title === "Task updated" ||
    title === "Task owner changed" ||
    title === "Task deadline updated" ||
    title === "Task assignee changed"
  ) {
    return "updated";
  }
  return null;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function plainText(value: string | null | undefined) {
  return String(value ?? "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/«[^»]*»/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function clip(value: string, max: number) {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1).trim()}…`;
}

function taskPath(taskId: number, projectName: string | null, activityId: number | null) {
  const slug = (projectName ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  const path = slug ? `/projects/${slug}/tasks/task=${taskId}/` : `/tasks/task=${taskId}/`;
  const query = activityId != null && activityId > 0 ? `?activity=${activityId}` : "";
  return `${path}${query}`;
}

function subjectFor(kind: TaskEmailKind, actorName: string, taskTitle: string) {
  if (kind === "assign") return `${actorName} assigned you “${taskTitle}”`;
  if (kind === "status") return `${actorName} updated the status of “${taskTitle}”`;
  if (kind === "overdue") return `“${taskTitle}” is overdue`;
  if (kind === "mention") return `${actorName} mentioned you on “${taskTitle}”`;
  if (kind === "completed") return `${actorName} marked “${taskTitle}” as finished`;
  if (kind === "participant") return `${actorName} added you as a participant on “${taskTitle}”`;
  if (kind === "updated") return `${actorName} updated “${taskTitle}”`;
  return `${actorName} commented on “${taskTitle}”`;
}

function headlineFor(kind: TaskEmailKind, actorName: string) {
  if (kind === "assign") return `${actorName} assigned this task to you`;
  if (kind === "status") return `${actorName} updated the task status`;
  if (kind === "overdue") return "This task is overdue";
  if (kind === "mention") return `${actorName} mentioned you`;
  if (kind === "completed") return `${actorName} marked this task as finished`;
  if (kind === "participant") return `${actorName} added you as a participant`;
  if (kind === "updated") return `${actorName} updated this task`;
  return `${actorName} added a comment`;
}

function commentBody(kind: TaskEmailKind, message: string) {
  if (kind !== "comment" && kind !== "mention") return "";
  const text = plainText(message);
  if (kind === "mention") {
    const quoted = text.match(/":\s*([\s\S]+)$/);
    if (quoted?.[1]) return quoted[1].trim();
  }
  const splitAt = text.indexOf(": ");
  if (splitAt >= 0) return text.slice(splitAt + 2).trim();
  return text;
}

function isActiveUser(status: string | null | undefined) {
  return String(status ?? "").toLowerCase() === "active";
}

function labelize(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

type AvatarImage = {
  html: string;
  attachment?: {
    filename: string;
    content: Buffer;
    cid: string;
    contentType: string;
  };
};

function avatarHtml(name: string, avatar: string | null, origin: string, size: number): AvatarImage {
  const initials = escapeHtml(getInitials(name));
  const color = getAvatarColor(name || "?");
  const fallback = `<table cellpadding="0" cellspacing="0" role="presentation"><tr><td width="${size}" height="${size}" align="center" valign="middle" bgcolor="${color}" style="width:${size}px;height:${size}px;border-radius:${size / 2}px;color:#ffffff;font-family:Arial,sans-serif;font-size:${Math.round(size * 0.36)}px;font-weight:700;line-height:${size}px;">${initials}</td></tr></table>`;

  if (!avatar?.trim()) return { html: fallback };

  if (avatar.startsWith("https://") || avatar.startsWith("http://")) {
    return {
      html: `<img src="${escapeHtml(avatar)}" width="${size}" height="${size}" alt="${initials}" style="display:block;width:${size}px;height:${size}px;border-radius:${size / 2}px;object-fit:cover;" />`,
    };
  }

  if (avatar.startsWith("/") && origin) {
    return {
      html: `<img src="${escapeHtml(`${origin}${avatar}`)}" width="${size}" height="${size}" alt="${initials}" style="display:block;width:${size}px;height:${size}px;border-radius:${size / 2}px;object-fit:cover;" />`,
    };
  }

  const dataUrl = avatar.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/);
  if (!dataUrl) return { html: fallback };
  const cid = "actor-avatar";
  return {
    html: `<img src="cid:${cid}" width="${size}" height="${size}" alt="${initials}" style="display:block;width:${size}px;height:${size}px;border-radius:${size / 2}px;object-fit:cover;" />`,
    attachment: {
      filename: "avatar",
      content: Buffer.from(dataUrl[2].replace(/\s/g, ""), "base64"),
      cid,
      contentType: dataUrl[1],
    },
  };
}

function detailRow(label: string, value: string) {
  if (!value) return "";
  return `<tr>
    <td style="padding:4px 16px 4px 0;font-family:Arial,sans-serif;font-size:13px;line-height:20px;color:${TEXT};white-space:nowrap;vertical-align:top;">${escapeHtml(label)}</td>
    <td style="padding:4px 0;font-family:Arial,sans-serif;font-size:13px;line-height:20px;font-weight:700;color:${TEXT};vertical-align:top;">${escapeHtml(value)}</td>
  </tr>`;
}

function buildEmail(input: {
  actorName: string;
  avatar: AvatarImage;
  headline: string;
  taskTitle: string;
  projectName: string;
  priority: string;
  due: string;
  description: string;
  comment: string;
  note: string;
  when: string;
  link: string;
  logoUrl: string;
}) {
  const button = input.link
    ? `<a href="${escapeHtml(input.link)}" style="display:inline-block;background:${BUTTON};color:#ffffff;font-family:Arial,sans-serif;font-size:14px;font-weight:700;line-height:20px;text-decoration:none;padding:10px 16px;border-radius:6px;">View in AASO</a>`
    : "";
  const footerLink = input.link
    ? `<tr><td style="padding:14px 20px 16px;border-top:1px solid #e5e7eb;font-family:Arial,sans-serif;font-size:14px;"><a href="${escapeHtml(input.link)}" style="color:${TEXT};text-decoration:none;">View in AASO</a></td></tr>`
    : "";
  const comment = input.comment
    ? `<p style="margin:14px 0 0;font-family:Arial,sans-serif;font-size:14px;line-height:22px;color:${TEXT};">${escapeHtml(input.comment)}</p>`
    : "";
  const note = input.note
    ? `<p style="margin:14px 0 0;font-family:Arial,sans-serif;font-size:14px;line-height:22px;color:${TEXT};">${escapeHtml(input.note)}</p>`
    : "";
  const logo = input.logoUrl
    ? `<img src="${escapeHtml(input.logoUrl)}" width="28" height="28" alt="" style="display:inline-block;vertical-align:middle;border:0;" />`
    : "";

  const html = `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f6f7f9;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7f9;">
    <tr>
      <td align="center" style="padding:28px 12px;">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;">
          <tr>
            <td style="padding:0 4px 18px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td valign="middle" style="font-family:Georgia,Times New Roman,serif;font-size:28px;line-height:32px;font-weight:700;color:${TEXT};">
                    ${logo}<span style="display:inline-block;vertical-align:middle;padding-left:8px;">aaso</span>
                  </td>
                  <td align="right" valign="middle">${input.avatar.html}</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:0 4px 4px;font-family:Arial,sans-serif;font-size:16px;line-height:24px;color:${TEXT};">Your unread notifications</td>
          </tr>
          <tr>
            <td style="padding:0 4px 2px;font-family:Arial,sans-serif;font-size:22px;line-height:28px;font-weight:700;color:${TEXT};">${escapeHtml(input.headline)}</td>
          </tr>
          <tr>
            <td style="padding:0 4px 16px;font-family:Arial,sans-serif;font-size:14px;line-height:20px;color:${TEXT};">${escapeHtml(input.projectName || "AASO")}</td>
          </tr>
          ${button ? `<tr><td style="padding:0 4px 22px;">${button}</td></tr>` : ""}
          <tr>
            <td>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;">
                <tr>
                  <td style="padding:18px 20px 8px;">
                    <table role="presentation" cellpadding="0" cellspacing="0">
                      <tr>
                        <td valign="top" style="padding-right:12px;">${input.avatar.html}</td>
                        <td valign="middle" style="font-family:Arial,sans-serif;font-size:16px;line-height:22px;font-weight:700;color:${TEXT};">${escapeHtml(input.headline)}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:6px 20px 4px;font-family:Arial,sans-serif;font-size:15px;line-height:22px;font-weight:700;color:${TEXT};">${escapeHtml(input.taskTitle)}</td>
                </tr>
                <tr>
                  <td style="padding:2px 20px 8px;font-family:Arial,sans-serif;font-size:13px;line-height:18px;color:${TEXT};">${escapeHtml(input.actorName)} · ${escapeHtml(input.when)}</td>
                </tr>
                <tr>
                  <td style="padding:4px 20px 8px;">
                    <table role="presentation" cellpadding="0" cellspacing="0">
                      ${detailRow("Priority", input.priority)}
                      ${detailRow("Due", input.due)}
                      ${detailRow("Project", input.projectName)}
                      ${input.description ? detailRow("Description", input.description) : ""}
                    </table>
                    ${comment}
                    ${note}
                  </td>
                </tr>
                ${footerLink}
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = [
    input.headline,
    input.taskTitle,
    input.projectName ? `Project: ${input.projectName}` : "",
    input.priority ? `Priority: ${input.priority}` : "",
    input.due ? `Due: ${input.due}` : "",
    input.description ? `Description: ${input.description}` : "",
    input.comment ? input.comment : "",
    input.note ? input.note : "",
    `${input.actorName} · ${input.when}`,
    input.link ? `View in AASO: ${input.link}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return { html, text };
}

export async function sendTaskNotificationEmails(input: {
  userIds: number[];
  taskId: number;
  actor: SafeUser | null;
  kind: TaskEmailKind;
  message: string;
  activityId?: number | null;
}) {
  const origin = publicAppOrigin();
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
  const projectName = project?.name?.trim() || "";

  let personName = input.actor?.name?.trim() || "";
  let personEmail = input.actor?.email?.trim() || "";
  let actorAvatar = input.actor?.avatar ?? null;
  if (input.actor?.id) {
    const actorUser = await findById<UserDoc>(Collections.users, input.actor.id);
    if (actorUser) {
      personName = actorUser.name?.trim() || personName;
      personEmail = actorUser.email?.trim() || personEmail;
      actorAvatar = actorUser.avatar ?? actorAvatar;
    }
  }
  const senderName = senderDisplayName(personName, personEmail);

  const link = origin ? `${origin}${taskPath(input.taskId, projectName, input.activityId ?? null)}` : "";
  const avatar = avatarHtml(senderName, actorAvatar, origin, 40);
  const due = task?.dueDate ? formatDueLabel(task.dueDate) : "No due date";
  const description = clip(plainText(task?.description), 360);
  const comment = clip(commentBody(input.kind, input.message), 500);
  const note =
    input.kind === "completed" || input.kind === "participant" || input.kind === "updated"
      ? clip(plainText(input.message), 500)
      : "";
  const priorityKey = task?.priority;
  const email = buildEmail({
    actorName: senderName,
    avatar,
    headline: headlineFor(input.kind, senderName),
    taskTitle,
    projectName,
    priority: priorityKey ? labelize(priorityKey) : "",
    due,
    description,
    comment,
    note,
    when: formatWorkZoneDateTime(new Date()),
    link,
    logoUrl: origin ? `${origin}/aaso-favicon.png` : "",
  });
  const subject = subjectFor(input.kind, senderName, taskTitle);

  await Promise.all(
    recipients.map(async (user) => {
      try {
        await sendMail({
          to: user.email!.trim(),
          fromName: personName,
          fromEmail: personEmail,
          subject,
          text: email.text,
          html: email.html,
          attachments: avatar.attachment ? [avatar.attachment] : undefined,
        });
      } catch (error) {
        console.error(`[task-email] could not email user ${user.id}:`, error);
      }
    }),
  );
}
