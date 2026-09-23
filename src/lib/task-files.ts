export type TaskFileKind =
  | "pdf"
  | "word"
  | "excel"
  | "powerpoint"
  | "image"
  | "video"
  | "audio"
  | "archive"
  | "text"
  | "code"
  | "file";

export type TaskFileBadge = {
  kind: TaskFileKind;
  label: string;
  badgeClass: string;
  iconClass: string;
};

const EXT_MAP: Record<string, TaskFileKind> = {
  pdf: "pdf",
  doc: "word",
  docx: "word",
  xls: "excel",
  xlsx: "excel",
  csv: "excel",
  ppt: "powerpoint",
  pptx: "powerpoint",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  svg: "image",
  mp4: "video",
  mov: "video",
  webm: "video",
  mp3: "audio",
  wav: "audio",
  zip: "archive",
  rar: "archive",
  "7z": "archive",
  txt: "text",
  md: "text",
  json: "code",
  js: "code",
  ts: "code",
  tsx: "code",
  jsx: "code",
};

const BADGES: Record<TaskFileKind, Omit<TaskFileBadge, "kind">> = {
  pdf: { label: "PDF", badgeClass: "bg-red-500 text-white", iconClass: "text-red-500" },
  word: { label: "DOC", badgeClass: "bg-blue-600 text-white", iconClass: "text-blue-600" },
  excel: { label: "XLS", badgeClass: "bg-emerald-600 text-white", iconClass: "text-emerald-600" },
  powerpoint: { label: "PPT", badgeClass: "bg-orange-500 text-white", iconClass: "text-orange-500" },
  image: { label: "IMG", badgeClass: "bg-violet-500 text-white", iconClass: "text-violet-500" },
  video: { label: "VID", badgeClass: "bg-pink-500 text-white", iconClass: "text-pink-500" },
  audio: { label: "AUD", badgeClass: "bg-amber-500 text-white", iconClass: "text-amber-500" },
  archive: { label: "ZIP", badgeClass: "bg-gray-500 text-white", iconClass: "text-gray-500" },
  text: { label: "TXT", badgeClass: "bg-slate-500 text-white", iconClass: "text-slate-500" },
  code: { label: "CODE", badgeClass: "bg-indigo-500 text-white", iconClass: "text-indigo-500" },
  file: { label: "FILE", badgeClass: "bg-gray-400 text-white", iconClass: "text-gray-400" },
};

export function getFileExtension(fileName: string) {
  const parts = fileName.split(".");
  return parts.length > 1 ? parts.pop()!.toLowerCase() : "";
}

const EXT_MIME: Record<string, string> = {
  avif: "image/avif",
  bmp: "image/bmp",
  gif: "image/gif",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
  webp: "image/webp",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  m4v: "video/x-m4v",
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain",
  zip: "application/zip",
};

/** Prefer browser MIME; fall back to extension (drag-drop often omits type). */
export function resolveFileMimeType(file: Pick<File, "name" | "type">): string {
  const typed = file.type?.trim();
  if (typed && typed !== "application/octet-stream") return typed;
  const ext = getFileExtension(file.name);
  return EXT_MIME[ext] ?? (typed || "application/octet-stream");
}

export function isImageFileName(fileName: string) {
  return /\.(avif|bmp|gif|jpe?g|png|svg|webp)$/i.test(fileName);
}

export function isVideoFileName(fileName: string) {
  return /\.(mp4|mov|webm|m4v)$/i.test(fileName);
}

export function isImageMimeType(mimeType: string, fileName?: string) {
  if (mimeType.startsWith("image/")) return true;
  return fileName ? isImageFileName(fileName) : false;
}

export function isVideoMimeType(mimeType: string, fileName?: string) {
  if (mimeType.startsWith("video/")) return true;
  return fileName ? isVideoFileName(fileName) : false;
}

export function getTaskFileBadge(fileName: string, mimeType?: string): TaskFileBadge {
  const ext = getFileExtension(fileName);
  let kind = EXT_MAP[ext] ?? "file";

  if (mimeType?.startsWith("image/")) kind = "image";
  if (mimeType?.startsWith("video/")) kind = "video";
  if (mimeType?.startsWith("audio/")) kind = "audio";
  if (mimeType === "application/pdf") kind = "pdf";

  return { kind, ...BADGES[kind] };
}

export function truncateFileName(fileName: string, maxLength = 22) {
  if (fileName.length <= maxLength) return fileName;
  const ext = getFileExtension(fileName);
  const base = ext ? fileName.slice(0, -(ext.length + 1)) : fileName;
  const extSuffix = ext ? `.${ext}` : "";
  const keep = maxLength - extSuffix.length - 3;
  if (keep < 4) return `${fileName.slice(0, maxLength - 3)}...`;
  const head = Math.ceil(keep * 0.55);
  const tail = keep - head;
  return `${base.slice(0, head)}...${base.slice(-tail)}${extSuffix}`;
}

export function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const MAX_TASK_ATTACHMENT_BYTES = Number.POSITIVE_INFINITY;

/** Size checks disabled — task/comment attachments accept any file size. */
export function assertAttachmentFileSize(_file: File | { name: string; size: number }) {
  // Intentionally no-op: large files are stored in GridFS.
}

export async function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.includes(",") ? result.split(",")[1]! : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

/** Resolve pending attachment payload to base64 when submitting (File or preloaded). */
export async function resolveAttachmentBase64(file: {
  fileName: string;
  fileSize: number;
  dataBase64?: string;
  file?: File;
}): Promise<string> {
  if (file.dataBase64) return file.dataBase64;
  if (file.file) {
    assertAttachmentFileSize(file.file);
    return readFileAsBase64(file.file);
  }
  throw new Error(`Missing file data for "${file.fileName}".`);
}

export function base64ToBlob(dataBase64: string, mimeType: string) {
  const binary = atob(dataBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType || "application/octet-stream" });
}

export function downloadFileFromBase64(fileName: string, mimeType: string, dataBase64: string) {
  const blob = base64ToBlob(dataBase64, mimeType);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function openFileFromBase64(fileName: string, mimeType: string, dataBase64: string) {
  const blob = base64ToBlob(dataBase64, mimeType);
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener,noreferrer");
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function canPreviewInBrowser(mimeType: string, fileName: string) {
  const kind = getTaskFileBadge(fileName, mimeType).kind;
  return kind === "pdf" || kind === "image" || mimeType.startsWith("text/");
}

const DESCRIPTION_META_PREFIXES = [
  "Attachments:",
  "Status summary:",
  "CRM:",
  "Parent task:",
  "Related tasks:",
  "Reminder:",
];

export function getDisplayDescription(description?: string | null) {
  if (!description?.trim()) return "";
  return description
    .split("\n\n")
    .filter((block) => !DESCRIPTION_META_PREFIXES.some((prefix) => block.startsWith(prefix)))
    .filter((block) => !block.startsWith("☐ "))
    .join("\n\n")
    .trim();
}
