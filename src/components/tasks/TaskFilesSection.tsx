import { useRef, useState } from "react";
import {
  Download,
  FileText,
  Image as ImageIcon,
  Loader2,
  MoreHorizontal,
  Paperclip,
  Plus,
  Trash2,
} from "lucide-react";
import { trpc } from "@/providers/trpc";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  canPreviewInBrowser,
  downloadFileFromBase64,
  formatFileSize,
  getTaskFileBadge,
  openFileFromBase64,
  assertAttachmentFileSize,
  readFileAsBase64,
  resolveFileMimeType,
  type TaskFileBadge,
} from "@/lib/task-files";
import { cn } from "@/lib/utils";

export type TaskAttachmentMeta = {
  id: number;
  fileName: string;
  mimeType: string;
  fileSize: number;
};

export type PendingTaskAttachment = {
  clientId: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  /** Preloaded base64 (legacy / already-read). Prefer `file` for create flow. */
  dataBase64?: string;
  /** Original browser File — read to base64 only when uploading. */
  file?: File;
  /** Object URL for image thumbnails without loading base64 into memory. */
  previewUrl?: string;
  stagingMediaId?: number;
  /** false = comment/description media only (hidden from Files section). */
  listedInFiles?: boolean;
};

type TaskFilesSectionProps = {
  taskId?: number;
  pendingFiles?: PendingTaskAttachment[];
  onPendingFilesChange?: (files: PendingTaskAttachment[]) => void;
  canManage?: boolean;
  className?: string;
};

export function TaskFilesSection({
  taskId,
  pendingFiles = [],
  onPendingFilesChange,
  canManage = true,
  className,
}: TaskFilesSectionProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const utils = trpc.useUtils();
  const [loadingId, setLoadingId] = useState<number | null>(null);

  const { data: savedFiles = [], isLoading } = trpc.task.listAttachments.useQuery(
    { taskId: taskId! },
    { enabled: Boolean(taskId) },
  );

  const addMutation = trpc.task.addAttachment.useMutation({
    onSuccess: () => {
      if (taskId) utils.task.listAttachments.invalidate({ taskId });
      if (taskId) utils.task.getById.invalidate({ id: taskId });
    },
  });

  const deleteMutation = trpc.task.deleteAttachment.useMutation({
    onSuccess: () => {
      if (taskId) utils.task.listAttachments.invalidate({ taskId });
      if (taskId) utils.task.getById.invalidate({ id: taskId });
    },
  });

  const files = taskId
    ? savedFiles
    : pendingFiles
        .filter((file) => file.listedInFiles !== false)
        .map((file) => ({
          id: file.clientId,
          fileName: file.fileName,
          mimeType: file.mimeType,
          fileSize: file.fileSize,
          pending: true as const,
          dataBase64: file.dataBase64,
          previewUrl: file.previewUrl,
        }));

  const handlePickFiles = async (fileList: FileList | null) => {
    if (!fileList?.length || !canManage) return;

    const failures: string[] = [];

    try {
      if (taskId) {
        for (const file of Array.from(fileList)) {
          try {
            assertAttachmentFileSize(file);
            const dataBase64 = await readFileAsBase64(file);
            await addMutation.mutateAsync({
              taskId,
              fileName: file.name,
              mimeType: resolveFileMimeType(file),
              fileSize: file.size,
              dataBase64,
            });
          } catch (error) {
            failures.push(
              error instanceof Error ? error.message : `Could not upload "${file.name}".`,
            );
          }
        }
        if (failures.length > 0) {
          window.alert(failures.join("\n"));
        }
        return;
      }

      // Create-task flow: keep File handles; preview via blob URLs (no bulk base64).
      const staged: PendingTaskAttachment[] = [];
      for (const file of Array.from(fileList)) {
        try {
          assertAttachmentFileSize(file);
          staged.push({
            clientId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
            fileName: file.name,
            mimeType: resolveFileMimeType(file),
            fileSize: file.size,
            file,
            previewUrl: URL.createObjectURL(file),
          });
        } catch (error) {
          failures.push(
            error instanceof Error ? error.message : `Could not stage "${file.name}".`,
          );
        }
      }
      if (staged.length > 0) {
        onPendingFilesChange?.([...pendingFiles, ...staged]);
      }
      if (failures.length > 0) {
        window.alert(failures.join("\n"));
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not upload file. Please try again.";
      window.alert(message);
    }
  };

  const handleOpen = async (file: {
    id: number | string;
    fileName: string;
    mimeType: string;
    pending?: boolean;
    dataBase64?: string;
    previewUrl?: string;
  }) => {
    if (file.pending && file.previewUrl) {
      window.open(file.previewUrl, "_blank", "noopener,noreferrer");
      return;
    }
    if (file.pending && file.dataBase64) {
      if (canPreviewInBrowser(file.mimeType, file.fileName)) {
        openFileFromBase64(file.fileName, file.mimeType, file.dataBase64);
      } else {
        downloadFileFromBase64(file.fileName, file.mimeType, file.dataBase64);
      }
      return;
    }

    if (typeof file.id !== "number") return;
    setLoadingId(file.id);
    try {
      const full = await utils.task.getAttachment.fetch({ id: file.id });
      if (!full?.dataBase64) return;
      if (canPreviewInBrowser(full.mimeType, full.fileName)) {
        openFileFromBase64(full.fileName, full.mimeType, full.dataBase64);
      } else {
        downloadFileFromBase64(full.fileName, full.mimeType, full.dataBase64);
      }
    } finally {
      setLoadingId(null);
    }
  };

  const handleDownload = async (file: {
    id: number | string;
    fileName: string;
    mimeType: string;
    pending?: boolean;
    dataBase64?: string;
    previewUrl?: string;
  }) => {
    if (file.pending && file.previewUrl) {
      const anchor = document.createElement("a");
      anchor.href = file.previewUrl;
      anchor.download = file.fileName;
      anchor.click();
      return;
    }
    if (file.pending && file.dataBase64) {
      downloadFileFromBase64(file.fileName, file.mimeType, file.dataBase64);
      return;
    }

    if (typeof file.id !== "number") return;
    setLoadingId(file.id);
    try {
      const full = await utils.task.getAttachment.fetch({ id: file.id });
      if (!full?.dataBase64) return;
      downloadFileFromBase64(full.fileName, full.mimeType, full.dataBase64);
    } finally {
      setLoadingId(null);
    }
  };

  const handleRemove = async (file: {
    id: number | string;
    pending?: boolean;
  }) => {
    if (file.pending) {
      const removing = pendingFiles.find((item) => item.clientId === file.id);
      if (removing?.previewUrl) URL.revokeObjectURL(removing.previewUrl);
      onPendingFilesChange?.(
        pendingFiles.filter((item) => item.clientId !== file.id),
      );
      return;
    }

    if (typeof file.id !== "number") return;
    await deleteMutation.mutateAsync({ id: file.id });
  };

  if (!canManage && files.length === 0) return null;

  return (
    <section className={cn("rounded-xl border border-gray-200 bg-white overflow-hidden", className)}>
      <div className="px-4 py-3 flex items-center justify-between border-b border-gray-100">
        <div className="flex items-center gap-2 text-sm font-semibold text-[#2563EB]">
          <Paperclip size={16} />
          <span>Files: {files.length}</span>
        </div>
        {canManage && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="*/*"
              className="sr-only"
              onChange={(e) => {
                void handlePickFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={addMutation.isPending}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors disabled:opacity-50"
              aria-label="Add files"
            >
              {addMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Plus size={18} />}
            </button>
          </>
        )}
      </div>

      <div className="p-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-8 text-gray-400">
            <Loader2 size={20} className="animate-spin" />
          </div>
        ) : files.length === 0 ? (
          <p className="text-sm text-gray-400 py-2">No files attached yet.</p>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-2">
            {files.map((file) => (
              <TaskFileCard
                key={file.id}
                fileId={file.id}
                fileName={file.fileName}
                mimeType={file.mimeType}
                fileSize={file.fileSize}
                dataBase64={"dataBase64" in file ? file.dataBase64 : undefined}
                previewUrl={"previewUrl" in file ? file.previewUrl : undefined}
                pending={"pending" in file ? file.pending : false}
                isLoading={loadingId === file.id}
                canManage={canManage}
                onOpen={() => void handleOpen(file)}
                onDownload={() => void handleDownload(file)}
                onRemove={() => void handleRemove(file)}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function TaskFileCard({
  fileId,
  fileName,
  mimeType,
  fileSize,
  dataBase64,
  previewUrl,
  pending = false,
  isLoading,
  canManage,
  onOpen,
  onDownload,
  onRemove,
}: {
  fileId: number | string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  dataBase64?: string;
  previewUrl?: string;
  pending?: boolean;
  isLoading?: boolean;
  canManage?: boolean;
  onOpen: () => void;
  onDownload: () => void;
  onRemove: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const badge = getTaskFileBadge(fileName, mimeType);
  const isImage = badge.kind === "image";

  return (
    <div className="group relative min-w-0 overflow-hidden rounded-lg border border-gray-200 bg-gray-50/60 p-2 hover:border-[#2563EB]/30 hover:bg-white transition-colors">
      <div className="absolute top-2 right-2 z-10">
        <Popover open={menuOpen} onOpenChange={setMenuOpen} modal>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="w-7 h-7 flex items-center justify-center rounded-md bg-white/90 border border-gray-200 text-gray-500 shadow-sm hover:bg-white hover:text-gray-800"
              aria-label="File options"
              title="File options"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal size={14} />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            side="bottom"
            sideOffset={6}
            className="z-[140] w-36 p-1.5 rounded-xl"
            onOpenAutoFocus={(event) => event.preventDefault()}
            onInteractOutside={() => setMenuOpen(false)}
            onPointerDownOutside={() => setMenuOpen(false)}
            onEscapeKeyDown={() => setMenuOpen(false)}
          >
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                onDownload();
              }}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-700 hover:bg-gray-100"
            >
              <Download size={14} />
              Download
            </button>
            {canManage ? (
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onRemove();
                }}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-red-600 hover:bg-red-50"
              >
                <Trash2 size={14} />
                Delete
              </button>
            ) : null}
          </PopoverContent>
        </Popover>
      </div>

      <button
        type="button"
        onClick={onOpen}
        disabled={isLoading}
        className="w-full min-w-0 text-left disabled:opacity-60"
        title={`Open ${fileName}`}
      >
        <div className="relative mx-auto mb-1.5 flex h-14 w-full items-center justify-center rounded-md border border-gray-200 bg-white overflow-hidden">
          {isImage ? (
            <TaskFilePreview
              fileId={fileId}
              fileName={fileName}
              mimeType={mimeType}
              dataBase64={dataBase64}
              previewUrl={previewUrl}
              pending={pending}
            />
          ) : (
            <FileTypePreview badge={badge} compact />
          )}
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/70">
              <Loader2 size={18} className="animate-spin text-[#2563EB]" />
            </div>
          )}
        </div>
        <p className="text-[11px] text-gray-700 text-center leading-snug px-0.5 w-full truncate">
          {fileName}
        </p>
        <p className="text-[10px] text-gray-400 text-center mt-0.5 truncate">{formatFileSize(fileSize)}</p>
      </button>
    </div>
  );
}

function TaskFilePreview({
  fileId,
  fileName,
  mimeType,
  dataBase64,
  previewUrl,
  pending,
}: {
  fileId: number | string;
  fileName: string;
  mimeType: string;
  dataBase64?: string;
  previewUrl?: string;
  pending?: boolean;
}) {
  const { data, isLoading } = trpc.task.getAttachment.useQuery(
    { id: fileId as number },
    { enabled: !pending && typeof fileId === "number" },
  );

  if (pending && previewUrl) {
    return (
      <img
        src={previewUrl}
        alt={fileName}
        className="h-full w-full object-cover"
      />
    );
  }

  if (pending && dataBase64) {
    return (
      <img
        src={`data:${mimeType};base64,${dataBase64}`}
        alt={fileName}
        className="h-full w-full object-cover"
      />
    );
  }

  if (isLoading) {
    return <Loader2 size={16} className="animate-spin text-gray-300" />;
  }

  if (data?.dataBase64) {
    return (
      <img
        src={`data:${mimeType};base64,${data.dataBase64}`}
        alt={fileName}
        className="h-full w-full object-cover"
      />
    );
  }

  return <ImageIcon size={22} className="text-gray-300" strokeWidth={1.5} />;
}

function FileTypePreview({ badge, compact = false }: { badge: TaskFileBadge; compact?: boolean }) {
  const Icon = badge.kind === "image" ? ImageIcon : FileText;
  return (
    <div className="relative flex items-center justify-center">
      <Icon size={compact ? 24 : 34} className={badge.iconClass} strokeWidth={1.5} />
      <span
        className={cn(
          "absolute -bottom-1 -right-1 rounded px-1.5 py-0.5 text-[10px] font-bold leading-none",
          badge.badgeClass,
        )}
      >
        {badge.label}
      </span>
    </div>
  );
}
