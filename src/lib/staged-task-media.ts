import type { PendingTaskAttachment } from "@/components/tasks/TaskFilesSection";
import type { CommentMediaRef } from "@/lib/rich-comment";
import { assertAttachmentFileSize } from "@/lib/task-files";

export type StagedTaskMedia = CommentMediaRef & {
  clientId: string;
};

let nextStagingMediaId = -1;

export function resetStagingMediaIds() {
  nextStagingMediaId = -1;
}

export async function stageTaskMediaFile(
  file: File,
  pendingAttachments: PendingTaskAttachment[],
  options?: { listedInFiles?: boolean },
): Promise<{ media: StagedTaskMedia; pendingAttachments: PendingTaskAttachment[] }> {
  assertAttachmentFileSize(file);
  const id = nextStagingMediaId--;
  const clientId = `staged-media-${id}-${Date.now()}`;
  const attachment: PendingTaskAttachment = {
    clientId,
    fileName: file.name,
    mimeType: file.type || "application/octet-stream",
    fileSize: file.size,
    file,
    previewUrl: URL.createObjectURL(file),
    stagingMediaId: id,
    // Comment / description embeds stay out of the Files section.
    listedInFiles: options?.listedInFiles ?? false,
  };

  return {
    media: {
      id,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      clientId,
    },
    pendingAttachments: [...pendingAttachments, attachment],
  };
}

export function remapStagedMediaIds(
  message: string,
  idMap: Map<number, number>,
) {
  return message.replace(/«media:(-?\d+)\|/g, (match, rawId) => {
    const mapped = idMap.get(Number(rawId));
    return mapped ? `«media:${mapped}|` : match;
  });
}
