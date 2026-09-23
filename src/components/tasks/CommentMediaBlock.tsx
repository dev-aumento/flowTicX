import { useState } from "react";
import { Download, Loader2, Play, X } from "lucide-react";
import { trpc } from "@/providers/trpc";
import {
  downloadFileFromBase64,
  getTaskFileBadge,
  isImageMimeType,
  isVideoMimeType,
} from "@/lib/task-files";
import type { CommentMediaRef } from "@/lib/rich-comment";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const TILE = "h-[150px] w-[150px] shrink-0";

type CommentMediaBlockProps = {
  media: CommentMediaRef;
  /** @deprecated Prefer `variant`. */
  compact?: boolean;
  /** All variants render as a 150×150 grid tile. */
  variant?: "thumb" | "file" | "auto";
  className?: string;
};

export function CommentMediaBlock({
  media,
  className,
}: CommentMediaBlockProps) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const { data, isLoading, isError } = trpc.task.getAttachment.useQuery(
    { id: media.id },
    { enabled: media.id > 0 },
  );

  const isImage = isImageMimeType(media.mimeType, media.fileName);
  const isVideo = isVideoMimeType(media.mimeType, media.fileName);
  const badge = getTaskFileBadge(media.fileName, media.mimeType);
  const showAsFile = !isImage && !isVideo;

  if (isLoading) {
    return (
      <div
        className={cn(
          TILE,
          "inline-flex items-center justify-center rounded-xl border border-gray-200 bg-gray-50",
          className,
        )}
      >
        <Loader2 size={16} className="animate-spin text-gray-400" />
      </div>
    );
  }

  if (isError || !data?.dataBase64) {
    return (
      <div
        className={cn(
          TILE,
          "inline-flex items-center justify-center rounded-xl border border-gray-200 bg-gray-50 px-2 text-center text-[11px] text-gray-500 break-all",
          className,
        )}
      >
        {media.fileName} (unavailable)
      </div>
    );
  }

  const mimeType = media.mimeType || data.mimeType || "application/octet-stream";
  const dataUrl = `data:${mimeType};base64,${data.dataBase64}`;

  if (showAsFile) {
    return (
      <div
        className={cn(
          TILE,
          "relative inline-flex flex-col items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white p-3 shadow-sm",
          className,
        )}
        title={media.fileName}
      >
        <span
          className={cn(
            "inline-flex h-12 w-12 items-center justify-center rounded-lg text-[11px] font-bold",
            badge.badgeClass,
          )}
        >
          {badge.label}
        </span>
        <p className="line-clamp-2 w-full text-center text-[11px] font-semibold text-gray-800 break-all">
          {media.fileName}
        </p>
        <button
          type="button"
          onClick={() => downloadFileFromBase64(media.fileName, mimeType, data.dataBase64)}
          className="absolute bottom-2 right-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-[#2563EB] text-white hover:bg-[#1D4ED8]"
          aria-label={`Download ${media.fileName}`}
          title="Download"
        >
          <Download size={14} />
        </button>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setPreviewOpen(true)}
        className={cn(
          TILE,
          "group relative inline-flex items-center justify-center overflow-hidden rounded-xl border border-gray-200 bg-gray-50 shadow-sm hover:ring-2 hover:ring-[#2563EB]/40 focus:outline-none focus:ring-2 focus:ring-[#2563EB]/40",
          className,
        )}
        title={media.fileName}
        aria-label={`Preview ${media.fileName}`}
      >
        {isImage ? (
          <img
            src={dataUrl}
            alt={media.fileName}
            className="h-full w-full object-cover"
          />
        ) : (
          <>
            <video
              src={dataUrl}
              muted
              preload="metadata"
              className="h-full w-full object-cover"
            />
            <span className="absolute inset-0 flex items-center justify-center bg-black/35">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-gray-800">
                <Play size={14} className="ml-0.5" />
              </span>
            </span>
          </>
        )}
      </button>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="z-[160] max-w-[min(92vw,880px)] w-full p-0 overflow-hidden border-0 bg-transparent shadow-none [&>button]:hidden">
          <DialogTitle className="sr-only">{media.fileName}</DialogTitle>
          <div className="rounded-xl overflow-hidden bg-white shadow-2xl border border-gray-200">
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-100 bg-white">
              <p className="text-sm font-medium text-gray-800 truncate">{media.fileName}</p>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => downloadFileFromBase64(media.fileName, mimeType, data.dataBase64)}
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-medium bg-[#2563EB] text-white hover:bg-[#1D4ED8]"
                >
                  <Download size={14} />
                  Download
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewOpen(false)}
                  className="w-8 h-8 inline-flex items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100"
                  aria-label="Close preview"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            <div className="bg-gray-950 flex items-center justify-center max-h-[75vh]">
              {isImage ? (
                <img
                  src={dataUrl}
                  alt={media.fileName}
                  className="max-h-[75vh] max-w-full object-contain"
                />
              ) : (
                <video
                  src={dataUrl}
                  controls
                  autoPlay
                  className="max-h-[75vh] max-w-full"
                />
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
