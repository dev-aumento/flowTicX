import type { PendingTaskAttachment } from "@/components/tasks/TaskFilesSection";
import type { CommentMediaRef } from "@/lib/rich-comment";
import { isImageMimeType, isVideoMimeType } from "@/lib/task-files";

type AttachmentPayload = {
  mimeType: string;
  dataBase64: string;
};

export function attachmentToPreviewUrl(attachment: AttachmentPayload) {
  return `data:${attachment.mimeType};base64,${attachment.dataBase64}`;
}

export function createAttachmentPreviewResolver(
  fetchAttachment: (id: number) => Promise<AttachmentPayload | null | undefined>,
) {
  return async (media: CommentMediaRef): Promise<string | undefined> => {
    if (media.id <= 0) return undefined;
    if (
      !isImageMimeType(media.mimeType, media.fileName)
      && !isVideoMimeType(media.mimeType, media.fileName)
    ) {
      return undefined;
    }
    try {
      const attachment = await fetchAttachment(media.id);
      if (!attachment?.dataBase64) return undefined;
      return attachmentToPreviewUrl(attachment);
    } catch {
      return undefined;
    }
  };
}

export function createStagedAttachmentPreviewResolver(
  pendingAttachments: PendingTaskAttachment[],
  fetchAttachment?: (id: number) => Promise<AttachmentPayload | null | undefined>,
) {
  const fetchSaved = fetchAttachment
    ? createAttachmentPreviewResolver(fetchAttachment)
    : null;

  return async (media: CommentMediaRef): Promise<string | undefined> => {
    const pending = pendingAttachments.find((file) => file.stagingMediaId === media.id);
    if (pending?.previewUrl) {
      return pending.previewUrl;
    }
    if (pending?.dataBase64) {
      return attachmentToPreviewUrl({
        mimeType: pending.mimeType,
        dataBase64: pending.dataBase64,
      });
    }

    if (fetchSaved) {
      return fetchSaved(media);
    }

    return undefined;
  };
}
