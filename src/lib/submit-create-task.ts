import type { CreateTaskFormData } from "@/components/tasks/CreateTaskModal";
import { resolveCloneTitle } from "@/lib/task-create-prefill";
import type { PendingTaskAttachment } from "@/components/tasks/TaskFilesSection";
import type { ProjectPipelineStageKey } from "@/lib/task-kanban";
import { buildRichCommentMessage } from "@/lib/rich-comment";
import { remapStagedMediaIds } from "@/lib/staged-task-media";
import { formatWorkZoneDateTime } from "@/lib/timezone";
import { defaultTaskDeadlineIso } from "@/lib/task-deadline";
import { resolveAttachmentBase64 } from "@/lib/task-files";

type CreateTaskInput = {
  title: string;
  description?: string;
  priority?: "low" | "medium" | "high" | "urgent";
  assigneeId?: number;
  createdBy?: number;
  projectId?: number | null;
  dueDate?: string;
  estimatedHours?: number;
  tags?: string[];
  stage?: ProjectPipelineStageKey;
};

type CreateTaskResult = { id: number };

type SubmitCreateTaskOptions = {
  formData: CreateTaskFormData;
  cloneSourceTitle?: string | null;
  createMutation: {
    mutateAsync: (input: CreateTaskInput) => Promise<CreateTaskResult>;
  };
  addParticipantMutation: {
    mutateAsync: (input: { taskId: number; userId: number }) => Promise<unknown>;
  };
  addObserverMutation: {
    mutateAsync: (input: { taskId: number; userId: number }) => Promise<unknown>;
  };
  updateMutation?: {
    mutateAsync: (input: { id: number; description?: string; createdBy?: number | null }) => Promise<unknown>;
  };
  createSubtaskMutation?: {
    mutateAsync: (input: { taskId: number; title: string }) => Promise<unknown>;
  };
  addCommentMutation?: {
    mutateAsync: (input: { taskId: number; message: string }) => Promise<unknown>;
  };
  addAttachmentMutation?: {
    mutateAsync: (input: {
      taskId: number;
      fileName: string;
      mimeType: string;
      fileSize: number;
      dataBase64: string;
      listedInFiles?: boolean;
    }) => Promise<{ id: number }>;
  };
};

function buildRichDescriptionBody(
  formData: CreateTaskFormData,
  mediaIdMap?: Map<number, number>,
) {
  const hasRich =
    formData.descriptionHtml.trim() || formData.descriptionMedia.length > 0;
  if (!hasRich) {
    return formData.description.trim();
  }

  let html = formData.descriptionHtml;
  let media = formData.descriptionMedia;

  // Remap temporary (negative) staging IDs to real attachment IDs before
  // buildRichCommentMessage strips pending tokens.
  if (mediaIdMap && mediaIdMap.size > 0) {
    html = remapStagedMediaIds(html, mediaIdMap);
    media = media.map((item) => ({
      ...item,
      id: mediaIdMap.get(item.id) ?? item.id,
    }));
  }

  return buildRichCommentMessage([], html, media);
}

function buildTaskDescription(
  formData: CreateTaskFormData,
  tasksById: Map<number, string>,
  mediaIdMap?: Map<number, number>,
) {
  const parentLabel = formData.parentTaskId
    ? tasksById.get(formData.parentTaskId)
    : undefined;

  const relatedLabels = formData.relatedTaskIds
    .map((id) => tasksById.get(id))
    .filter(Boolean);

  const customFieldLines = formData.customFields
    .filter((field) => field.key.trim() || field.value.trim())
    .map((field) => `${field.key.trim()}: ${field.value.trim()}`);

  const descriptionBody = buildRichDescriptionBody(formData, mediaIdMap);

  return [
    descriptionBody,
    formData.statusSummary.trim()
      ? `Status summary: ${formData.statusSummary.trim()}`
      : "",
    formData.crmItem.trim() ? `CRM: ${formData.crmItem.trim()}` : "",
    parentLabel ? `Parent task: ${parentLabel}` : "",
    relatedLabels.length > 0 ? `Related tasks: ${relatedLabels.join(", ")}` : "",
    formData.reminderDate.trim()
      ? `Reminder: ${formatWorkZoneDateTime(formData.reminderDate)}`
      : "",
    ...formData.checklistItems
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => `☐ ${item}`),
    ...customFieldLines,
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function uploadPendingAttachments(
  taskId: number,
  files: PendingTaskAttachment[],
  addAttachmentMutation: SubmitCreateTaskOptions["addAttachmentMutation"],
) {
  const mediaIdMap = new Map<number, number>();
  if (!addAttachmentMutation || files.length === 0) {
    return mediaIdMap;
  }

  const failures: string[] = [];

  for (const file of files) {
    try {
      const dataBase64 = await resolveAttachmentBase64(file);
      const uploaded = await addAttachmentMutation.mutateAsync({
        taskId,
        fileName: file.fileName,
        mimeType: file.mimeType,
        fileSize: file.fileSize,
        dataBase64,
        listedInFiles: file.listedInFiles !== false,
      });
      if (file.stagingMediaId != null) {
        mediaIdMap.set(file.stagingMediaId, uploaded.id);
      }
      if (file.previewUrl) {
        URL.revokeObjectURL(file.previewUrl);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : "upload failed";
      failures.push(`${file.fileName}: ${reason}`);
      console.error("Failed to upload attachment:", file.fileName, error);
    }
  }

  if (failures.length > 0 && failures.length === files.length) {
    throw new Error(
      `Could not upload attachments:\n${failures.slice(0, 5).join("\n")}${
        failures.length > 5 ? `\n…and ${failures.length - 5} more` : ""
      }`,
    );
  }

  if (failures.length > 0) {
    window.alert(
      `Task created, but ${failures.length} file(s) failed to upload:\n${failures
        .slice(0, 5)
        .join("\n")}${failures.length > 5 ? `\n…and ${failures.length - 5} more` : ""}`,
    );
  }

  return mediaIdMap;
}

export async function submitCreateTask({
  formData,
  cloneSourceTitle,
  createMutation,
  addParticipantMutation,
  addObserverMutation,
  updateMutation,
  createSubtaskMutation,
  addCommentMutation,
  addAttachmentMutation,
  tasksById = new Map(),
}: SubmitCreateTaskOptions & { tasksById?: Map<number, string> }) {
  if (!formData.title.trim()) return null;

  const tags = formData.tags
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  const title = cloneSourceTitle
    ? resolveCloneTitle(formData.title, cloneSourceTitle)
    : formData.title.trim();

  const task = await createMutation.mutateAsync({
    title,
    description: buildTaskDescription(formData, tasksById) || undefined,
    priority: formData.priority,
    assigneeId: formData.assigneeId,
    createdBy: formData.ownerId,
    projectId: formData.projectId ?? null,
    dueDate: formData.dueDate || defaultTaskDeadlineIso(),
    estimatedHours: formData.estimatedHours ? Number(formData.estimatedHours) : undefined,
    tags: tags.length > 0 ? tags : undefined,
    stage: formData.stage as ProjectPipelineStageKey | undefined,
  });

  const mediaIdMap = await uploadPendingAttachments(
    task.id,
    formData.pendingAttachments,
    addAttachmentMutation,
  );

  // Remap staged media IDs in the description after uploads.
  // Owner is set on create — do not re-send createdBy here (employees with
  // tasks.create may not have permission to change owner on update).
  const finalDescription = buildTaskDescription(formData, tasksById, mediaIdMap);
  if (updateMutation && finalDescription) {
    await updateMutation.mutateAsync({
      id: task.id,
      description: finalDescription,
    });
  }

  const sideEffects: Promise<unknown>[] = [
    ...formData.participantIds.map((participantId) =>
      addParticipantMutation.mutateAsync({ taskId: task.id, userId: participantId }),
    ),
    ...formData.observerIds.map((observerId) =>
      addObserverMutation.mutateAsync({ taskId: task.id, userId: observerId }),
    ),
  ];

  if (createSubtaskMutation) {
    for (const subtaskTitle of formData.subtaskTitles.map((t) => t.trim()).filter(Boolean)) {
      sideEffects.push(createSubtaskMutation.mutateAsync({ taskId: task.id, title: subtaskTitle }));
    }
  }

  if (addCommentMutation) {
    for (const message of formData.chatDrafts.map((d) => d.message.trim()).filter(Boolean)) {
      const remapped = remapStagedMediaIds(message, mediaIdMap);
      sideEffects.push(addCommentMutation.mutateAsync({ taskId: task.id, message: remapped }));
    }
  }

  if (sideEffects.length > 0) {
    const results = await Promise.allSettled(sideEffects);
    const failed = results.filter((result) => result.status === "rejected");
    if (failed.length > 0) {
      console.error("Some task side effects failed after create:", failed);
    }
  }

  return task;
}
