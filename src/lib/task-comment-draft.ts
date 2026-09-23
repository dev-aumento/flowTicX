import type { CommentMediaRef } from "@/lib/rich-comment";
import type { MentionUser } from "@/lib/task-comment-mentions";
import { isEditorContentEmpty } from "@/lib/rich-comment";

export type TaskCommentDraft = {
  html: string;
  media: CommentMediaRef[];
  mentions: MentionUser[];
  updatedAt: string;
};

const draftKey = (taskId: number) => `task-comment-draft-${taskId}`;

export function readTaskCommentDraft(taskId: number): TaskCommentDraft | null {
  try {
    const raw = localStorage.getItem(draftKey(taskId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TaskCommentDraft;
    if (!parsed || typeof parsed !== "object") return null;
    return {
      html: typeof parsed.html === "string" ? parsed.html : "",
      media: Array.isArray(parsed.media) ? parsed.media : [],
      mentions: Array.isArray(parsed.mentions) ? parsed.mentions : [],
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function writeTaskCommentDraft(
  taskId: number,
  draft: Omit<TaskCommentDraft, "updatedAt">,
) {
  const hasContent =
    draft.mentions.length > 0
    || !isEditorContentEmpty(draft.html)
    || draft.media.length > 0;

  if (!hasContent) {
    clearTaskCommentDraft(taskId);
    return;
  }

  const payload: TaskCommentDraft = {
    ...draft,
    updatedAt: new Date().toISOString(),
  };
  localStorage.setItem(draftKey(taskId), JSON.stringify(payload));
}

export function clearTaskCommentDraft(taskId: number) {
  localStorage.removeItem(draftKey(taskId));
}
