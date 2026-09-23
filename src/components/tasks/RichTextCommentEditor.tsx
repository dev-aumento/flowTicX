import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  Bold,
  List,
  ListOrdered,
  Link2,
  Image as ImageIcon,
  Film,
  Paperclip,
  Loader2,
} from "lucide-react";
import {
  applyMediaEmbedPreview,
  buildEditorBodyFromDraft,
  extractMediaFromBody,
  htmlContainsTable,
  hydrateRichEditorDom,
  insertMediaEmbedAtSelection,
  isPreviewableMedia,
  isProbablyUrl,
  isRichEditorDomEmpty,
  linkifyPlainTextToHtml,
  escapeHtmlText,
  normalizeExternalUrl,
  plainTextLooksLikeTable,
  plainTextTableToHtml,
  RICH_MEDIA_ID_ATTR,
  RICH_MEDIA_NAME_ATTR,
  RICH_MEDIA_MIME_ATTR,
  saveEditorSelection,
  sanitizeRichCommentHtml,
  serializeRichEditorDom,
  type CommentMediaRef,
} from "@/lib/rich-comment";
import { assertAttachmentFileSize, resolveFileMimeType } from "@/lib/task-files";
import { cn } from "@/lib/utils";

export type RichTextCommentEditorHandle = {
  getSerializedContent: () => { html: string; media: CommentMediaRef[] };
  /** True while a paste/upload is still replacing a temporary media id. */
  isUploading: () => boolean;
  /** Upload files and insert them as media embeds (same path as drag-and-drop). */
  attachFiles: (files: FileList | File[]) => Promise<void>;
};

type RichTextCommentEditorProps = {
  onChange: (html: string, media: CommentMediaRef[]) => void;
  onUploadMedia: (file: File) => Promise<CommentMediaRef>;
  resolveMediaPreviewUrl?: (media: CommentMediaRef) => Promise<string | undefined>;
  /** Fires when local paste/upload activity starts or finishes. */
  onUploadingChange?: (uploading: boolean) => void;
  initialHtml?: string;
  initialMedia?: CommentMediaRef[];
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  editorClassName?: string;
  /** Fixed editor body height in px (enables external resize handle). */
  editorHeight?: number;
};

function getPlainText(editor: HTMLElement) {
  return editor.innerText.replace(/\u00a0/g, " ");
}

function getCaretOffset(editor: HTMLElement) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return getPlainText(editor).length;

  const range = selection.getRangeAt(0);
  const preRange = range.cloneRange();
  preRange.selectNodeContents(editor);
  preRange.setEnd(range.endContainer, range.endOffset);
  return preRange.toString().length;
}

function deleteTextRange(editor: HTMLElement, start: number, end: number) {
  const selection = window.getSelection();
  if (!selection) return;

  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  let currentOffset = 0;
  let startNode: Text | null = null;
  let startOffset = 0;
  let endNode: Text | null = null;
  let endOffset = 0;

  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const nextOffset = currentOffset + node.length;

    if (!startNode && start >= currentOffset && start <= nextOffset) {
      startNode = node;
      startOffset = start - currentOffset;
    }

    if (!endNode && end >= currentOffset && end <= nextOffset) {
      endNode = node;
      endOffset = end - currentOffset;
      break;
    }

    currentOffset = nextOffset;
  }

  if (!startNode || !endNode) return;

  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  range.deleteContents();
  selection.removeAllRanges();
  selection.addRange(range);
}

function ToolbarButton({
  active,
  onClick,
  label,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        "w-8 h-8 flex items-center justify-center rounded-md text-gray-600 hover:bg-gray-100",
        active && "bg-blue-50 text-[#2563EB]",
      )}
    >
      {children}
    </button>
  );
}

export const RichTextCommentEditor = forwardRef<
  RichTextCommentEditorHandle,
  RichTextCommentEditorProps
>(function RichTextCommentEditor({
  onChange,
  onUploadMedia,
  resolveMediaPreviewUrl,
  onUploadingChange,
  initialHtml = "",
  initialMedia = [],
  disabled,
  placeholder = "Write a comment...",
  className,
  editorClassName,
  editorHeight,
}, ref) {
  const editorRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewUrlsRef = useRef<Record<number, string>>({});
  const [uploadingCount, setUploadingCount] = useState(0);
  const uploadingCountRef = useRef(0);
  const [isHydratingMedia, setIsHydratingMedia] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const dragDepthRef = useRef(0);
  const [isEmpty, setIsEmpty] = useState(
    () => !initialHtml.trim() && initialMedia.length === 0,
  );

  const readSerializedContent = () => {
    const editor = editorRef.current;
    if (!editor) return { html: "", media: [] as CommentMediaRef[] };
    return serializeRichEditorDom(editor);
  };

  const emitChange = () => {
    const editor = editorRef.current;
    if (!editor) return;
    const { html, media } = serializeRichEditorDom(editor);
    const empty = isRichEditorDomEmpty(editor);
    setIsEmpty(empty);
    onChange(html, media);
  };

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const resolveMediaPreviewUrlRef = useRef(resolveMediaPreviewUrl);
  resolveMediaPreviewUrlRef.current = resolveMediaPreviewUrl;

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    const body = buildEditorBodyFromDraft(initialHtml, initialMedia);
    const mediaRefs = extractMediaFromBody(body, initialMedia);
    let cancelled = false;

    const syncFromDom = () => {
      if (!editorRef.current || cancelled) return;
      const serialized = serializeRichEditorDom(editorRef.current);
      setIsEmpty(isRichEditorDomEmpty(editorRef.current));
      onChangeRef.current(serialized.html, serialized.media);
    };

    // Show embeds immediately (including PDFs/files) so edit/remove works
    // without waiting on attachment downloads.
    hydrateRichEditorDom(editor, body, previewUrlsRef.current);
    syncFromDom();

    const previewable = mediaRefs.filter(isPreviewableMedia);
    const resolver = resolveMediaPreviewUrlRef.current;
    if (!resolver || previewable.length === 0) {
      return () => {
        cancelled = true;
      };
    }

    setIsHydratingMedia(true);

    void (async () => {
      try {
        await Promise.all(
          previewable.map(async (media) => {
            try {
              const previewUrl = await resolver(media);
              if (!previewUrl || cancelled || !editorRef.current) return;
              previewUrlsRef.current[media.id] = previewUrl;
              applyMediaEmbedPreview(editorRef.current, media.id, previewUrl);
            } catch {
              /* ignore missing previews */
            }
          }),
        );
      } finally {
        if (!cancelled) {
          setIsHydratingMedia(false);
          syncFromDom();
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initialize once from initial props
  }, []);

  useEffect(() => {
    return () => {
      for (const url of Object.values(previewUrlsRef.current)) {
        if (url.startsWith("blob:")) {
          URL.revokeObjectURL(url);
        }
      }
    };
  }, []);

  useEffect(() => {
    onUploadingChange?.(uploadingCount > 0);
  }, [uploadingCount, onUploadingChange]);

  const focusEditor = () => {
    editorRef.current?.focus();
  };

  const runCommand = (command: string, value?: string) => {
    focusEditor();
    document.execCommand(command, false, value);
    emitChange();
  };

  const insertLink = () => {
    const url = window.prompt("Enter link URL");
    if (!url?.trim()) return;
    const normalized = normalizeExternalUrl(url);
    if (!/^https?:\/\//i.test(normalized)) {
      window.alert("Please enter a valid URL (e.g. https://example.com).");
      return;
    }
    runCommand("createLink", normalized);
  };

  const uploadAndAttach = async (file: File) => {
    assertAttachmentFileSize(file);
    const mimeType = resolveFileMimeType(file);
    const normalizedFile =
      mimeType !== file.type
        ? new File([file], file.name, { type: mimeType, lastModified: file.lastModified })
        : file;

    const editor = editorRef.current;
    const savedRange = editor ? saveEditorSelection(editor) : null;
    const isPreviewable = isPreviewableMedia({ mimeType, fileName: file.name });
    const previewUrl = isPreviewable ? URL.createObjectURL(normalizedFile) : undefined;
    // Temporary id so a preview can appear before the server upload finishes.
    const tempId = -(Date.now() + Math.floor(Math.random() * 100_000));

    uploadingCountRef.current += 1;
    setUploadingCount((count) => count + 1);

    if (previewUrl) {
      previewUrlsRef.current[tempId] = previewUrl;
    }

    if (editorRef.current) {
      insertMediaEmbedAtSelection(
        editorRef.current,
        { id: tempId, fileName: file.name, mimeType },
        previewUrl,
        savedRange,
      );
      const embed = editorRef.current.querySelector(`[${RICH_MEDIA_ID_ATTR}="${tempId}"]`);
      embed?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      setIsEmpty(false);
      emitChange();
    }

    try {
      const uploaded = await onUploadMedia(normalizedFile);
      if (previewUrl) {
        previewUrlsRef.current[uploaded.id] = previewUrl;
        delete previewUrlsRef.current[tempId];
      }

      const embed = editorRef.current?.querySelector(
        `[${RICH_MEDIA_ID_ATTR}="${tempId}"]`,
      ) as HTMLElement | null;

      if (embed) {
        embed.setAttribute(RICH_MEDIA_ID_ATTR, String(uploaded.id));
        embed.setAttribute(RICH_MEDIA_NAME_ATTR, uploaded.fileName);
        embed.setAttribute(RICH_MEDIA_MIME_ATTR, uploaded.mimeType || mimeType);
        emitChange();
      } else if (editorRef.current) {
        insertMediaEmbedAtSelection(editorRef.current, uploaded, previewUrl, null);
        setIsEmpty(false);
        emitChange();
      }
    } catch (error) {
      console.error("Failed to upload file:", error);
      const embed = editorRef.current?.querySelector(`[${RICH_MEDIA_ID_ATTR}="${tempId}"]`);
      embed?.remove();
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
        delete previewUrlsRef.current[tempId];
      }
      emitChange();
      const message =
        error instanceof Error ? error.message : "Could not upload file. Please try again.";
      window.alert(message);
    } finally {
      uploadingCountRef.current = Math.max(0, uploadingCountRef.current - 1);
      setUploadingCount((count) => Math.max(0, count - 1));
    }
  };

  useImperativeHandle(ref, () => ({
    getSerializedContent: readSerializedContent,
    isUploading: () => uploadingCountRef.current > 0,
    attachFiles: async (files) => {
      for (const file of Array.from(files)) {
        try {
          await uploadAndAttach(file);
        } catch {
          // uploadAndAttach already surfaces errors; keep uploading remaining files.
        }
      }
    },
  }));

  const collectClipboardImageFiles = (clipboard: DataTransfer) => {
    const files: File[] = [];

    if (clipboard.files?.length) {
      for (const file of Array.from(clipboard.files)) {
        files.push(file);
      }
    }

    for (const item of Array.from(clipboard.items ?? [])) {
      if (item.kind !== "file") continue;
      const file = item.getAsFile();
      if (file) files.push(file);
    }

    const unique = new Map<string, File>();
    for (const file of files) {
      unique.set(`${file.name}-${file.size}-${file.type}`, file);
    }
    return [...unique.values()];
  };

  const collectDroppedFiles = (dataTransfer: DataTransfer) => {
    const files: File[] = [];

    if (dataTransfer.files?.length) {
      for (const file of Array.from(dataTransfer.files)) {
        files.push(file);
      }
    }

    for (const item of Array.from(dataTransfer.items ?? [])) {
      if (item.kind !== "file") continue;
      const file = item.getAsFile();
      if (file) files.push(file);
    }

    const unique = new Map<string, File>();
    for (const file of files) {
      unique.set(`${file.name}-${file.size}-${file.type}`, file);
    }
    return [...unique.values()];
  };

  const dataTransferHasFiles = (dataTransfer: DataTransfer | null) => {
    if (!dataTransfer) return false;
    if (dataTransfer.types?.includes("Files")) return true;
    for (const item of Array.from(dataTransfer.items ?? [])) {
      if (item.kind === "file") return true;
    }
    return dataTransfer.files?.length > 0;
  };

  const dataUrlToFile = async (dataUrl: string, index: number) => {
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    const extension = blob.type.split("/")[1] || "png";
    return new File([blob], `pasted-image-${Date.now()}-${index}.${extension}`, {
      type: blob.type || "image/png",
    });
  };

  const remoteSrcToFile = async (src: string, index: number) => {
    const response = await fetch(src);
    if (!response.ok) {
      throw new Error(`Failed to fetch image (${response.status})`);
    }
    const blob = await response.blob();
    const mime =
      blob.type.startsWith("image/") || blob.type.startsWith("video/")
        ? blob.type
        : "image/png";
    const extension = mime.split("/")[1]?.split("+")[0] || "png";
    return new File([blob], `pasted-image-${Date.now()}-${index}.${extension}`, {
      type: mime,
    });
  };

  const collectHtmlImageFiles = async (html: string) => {
    if (!/<img\b/i.test(html)) return [] as File[];
    const doc = new DOMParser().parseFromString(html, "text/html");
    const files: File[] = [];
    let index = 0;

    for (const img of Array.from(doc.querySelectorAll("img"))) {
      const src = img.getAttribute("src")?.trim();
      if (!src) continue;

      try {
        if (src.startsWith("data:image/") || src.startsWith("data:video/")) {
          files.push(await dataUrlToFile(src, index++));
          continue;
        }
        // Website "Copy image" often provides blob: or https: srcs in text/html.
        if (src.startsWith("blob:") || /^https?:\/\//i.test(src)) {
          files.push(await remoteSrcToFile(src, index++));
        }
      } catch (error) {
        console.warn("Could not convert pasted image src to file:", src, error);
      }
    }

    return files;
  };

  const handleImagePick = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      await uploadAndAttach(file);
    }
    event.target.value = "";
  };

  const removeMediaEmbed = (id: number) => {
    const editor = editorRef.current;
    if (!editor) return;

    const embed = editor.querySelector(`[${RICH_MEDIA_ID_ATTR}="${id}"]`);
    embed?.remove();

    const previewUrl = previewUrlsRef.current[id];
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      delete previewUrlsRef.current[id];
    }

    emitChange();
  };

  const handleEditorClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (!target.closest("[data-rich-media-remove]")) return;
    event.preventDefault();

    const embed = target.closest(`[${RICH_MEDIA_ID_ATTR}]`);
    const mediaId = embed?.getAttribute(RICH_MEDIA_ID_ATTR);
    if (!mediaId) return;
    removeMediaEmbed(Number(mediaId));
  };

  const handleInput = () => {
    emitChange();
  };

  const htmlHasVisibleText = (value: string) => {
    if (htmlContainsTable(value)) return true;
    const text = value
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return text.length > 0;
  };

  const insertPastedHtmlOrText = (clipboard: DataTransfer, html: string) => {
    if (html.trim()) {
      const sanitized = sanitizeRichCommentHtml(html);
      if (sanitized && htmlHasVisibleText(sanitized)) {
        // Prefer real HTML structure (tables/lists). Only fall back to linkified
        // plain text when the paste is essentially unstructured text with a URL.
        const hasStructure =
          htmlContainsTable(sanitized) || /<(ul|ol|li)\b/i.test(sanitized);
        if (!hasStructure && !/<a\b/i.test(sanitized)) {
          const plain = clipboard.getData("text/plain");
          if (plain && /(?:https?:\/\/|www\.)/i.test(plain) && !plainTextLooksLikeTable(plain)) {
            document.execCommand(
              "insertHTML",
              false,
              sanitizeRichCommentHtml(linkifyPlainTextToHtml(plain)),
            );
            emitChange();
            return true;
          }
        }
        document.execCommand("insertHTML", false, sanitized);
        emitChange();
        return true;
      }
    }

    const text = clipboard.getData("text/plain");
    if (!text) return false;

    if (plainTextLooksLikeTable(text)) {
      const tableHtml = sanitizeRichCommentHtml(plainTextTableToHtml(text));
      if (tableHtml) {
        document.execCommand("insertHTML", false, tableHtml);
        emitChange();
        return true;
      }
    }

    if (isProbablyUrl(text.trim())) {
      const href = normalizeExternalUrl(text.trim());
      const label = escapeHtmlText(text.trim());
      document.execCommand(
        "insertHTML",
        false,
        `<a href="${escapeHtmlText(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`,
      );
      emitChange();
      return true;
    }

    if (/(?:https?:\/\/|www\.)/i.test(text)) {
      document.execCommand(
        "insertHTML",
        false,
        sanitizeRichCommentHtml(linkifyPlainTextToHtml(text)),
      );
      emitChange();
      return true;
    }

    document.execCommand("insertText", false, text);
    emitChange();
    return true;
  };

  const handlePaste = async (event: React.ClipboardEvent<HTMLDivElement>) => {
    const clipboard = event.clipboardData;
    if (!clipboard) return;

    const imageFiles = collectClipboardImageFiles(clipboard);
    if (imageFiles.length > 0) {
      event.preventDefault();
      for (const file of imageFiles) {
        await uploadAndAttach(file);
      }
      return;
    }

    const html = clipboard.getData("text/html");
    // preventDefault must run before any await, or the browser inserts raw <img> tags.
    if (/<img\b/i.test(html)) {
      event.preventDefault();

      // Webpage text copies often include icons/<img> tags. Prefer text when present.
      const sanitized = sanitizeRichCommentHtml(html);
      if (sanitized && htmlHasVisibleText(sanitized)) {
        insertPastedHtmlOrText(clipboard, html);
        return;
      }

      const htmlImageFiles = await collectHtmlImageFiles(html);
      if (htmlImageFiles.length > 0) {
        for (const file of htmlImageFiles) {
          await uploadAndAttach(file);
        }
        return;
      }

      // Image-only paste failed to fetch — still try plain text / URL, else explain.
      if (insertPastedHtmlOrText(clipboard, html)) return;

      window.alert(
        "Could not paste this image from the page. Try a screenshot, or save the image and attach it.",
      );
      return;
    }

    event.preventDefault();
    insertPastedHtmlOrText(clipboard, html);
  };

  const convertTrailingUrlToLink = () => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection || selection.rangeCount === 0 || !selection.isCollapsed) return;

    const range = selection.getRangeAt(0);
    if (!editor.contains(range.startContainer) || range.startContainer.nodeType !== Node.TEXT_NODE) {
      return;
    }

    const textNode = range.startContainer as Text;
    const textBefore = textNode.textContent?.slice(0, range.startOffset) ?? "";
    const match = textBefore.match(/(?:https?:\/\/|www\.)[^\s<>"'`]+$/i);
    if (!match) return;

    const urlText = match[0].replace(/[.,;:!?)\]]+$/g, "");
    if (!urlText || !isProbablyUrl(urlText)) return;

    const start = range.startOffset - match[0].length;
    const end = start + urlText.length;
    if (start < 0) return;

    const linkRange = document.createRange();
    linkRange.setStart(textNode, start);
    linkRange.setEnd(textNode, end);
    selection.removeAllRanges();
    selection.addRange(linkRange);

    const href = normalizeExternalUrl(urlText);
    document.execCommand("createLink", false, href);

    // Move caret after the link; trailing punctuation stays in the remaining text.
    selection.collapseToEnd();
    emitChange();
  };

  const handleEditorKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === " " || event.key === "Enter") {
      convertTrailingUrlToLink();
    }
  };

  const handleDragEnter = (event: React.DragEvent) => {
    if (disabled || !dataTransferHasFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current += 1;
    setIsDragOver(true);
  };

  const handleDragLeave = (event: React.DragEvent) => {
    if (disabled) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDragOver(false);
    }
  };

  const handleDragOver = (event: React.DragEvent) => {
    if (disabled || !dataTransferHasFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
  };

  const handleDrop = async (event: React.DragEvent) => {
    if (disabled) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = 0;
    setIsDragOver(false);

    const files = collectDroppedFiles(event.dataTransfer);
    if (files.length === 0) return;

    focusEditor();
    for (const file of files) {
      await uploadAndAttach(file);
    }
  };

  const showPlaceholder = isEmpty;

  return (
    <div
      className={cn(
        "space-y-2 rounded-lg transition-[box-shadow,background-color]",
        isDragOver && "bg-blue-50/80 ring-2 ring-[#2563EB]/35 ring-inset",
        className,
      )}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <div className="flex flex-wrap items-center gap-0.5 border-b border-gray-100 px-2 py-1.5">
        <ToolbarButton label="Bold" onClick={() => runCommand("bold")}>
          <Bold size={16} />
        </ToolbarButton>
        <ToolbarButton label="Bullet list" onClick={() => runCommand("insertUnorderedList")}>
          <List size={16} />
        </ToolbarButton>
        <ToolbarButton label="Numbered list" onClick={() => runCommand("insertOrderedList")}>
          <ListOrdered size={16} />
        </ToolbarButton>
        <ToolbarButton label="Insert link" onClick={insertLink}>
          <Link2 size={16} />
        </ToolbarButton>
        <ToolbarButton label="Insert image" onClick={() => imageInputRef.current?.click()}>
          <ImageIcon size={16} />
        </ToolbarButton>
        <ToolbarButton label="Insert video" onClick={() => videoInputRef.current?.click()}>
          <Film size={16} />
        </ToolbarButton>
        <ToolbarButton label="Attach any file" onClick={() => fileInputRef.current?.click()}>
          <Paperclip size={16} />
        </ToolbarButton>
        {uploadingCount > 0 ? (
          <span className="inline-flex items-center gap-1 px-2 text-xs text-gray-500">
            <Loader2 size={12} className="animate-spin" />
            Uploading...
          </span>
        ) : null}
      </div>

      <div className="relative min-w-0 max-w-full px-3 pb-3">
        {showPlaceholder ? (
          <div className="pointer-events-none absolute left-3 top-0 text-sm text-gray-400">
            {isDragOver ? "Drop file here..." : placeholder}
          </div>
        ) : null}
        {isDragOver && !showPlaceholder ? (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-md bg-blue-50/80 text-sm font-medium text-[#2563EB]">
            Drop file to attach
          </div>
        ) : null}
        {isHydratingMedia ? (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-md bg-white/70">
            <Loader2 size={18} className="animate-spin text-gray-400" />
          </div>
        ) : null}
        <div
          ref={editorRef}
          contentEditable={!disabled}
          suppressContentEditableWarning
          onInput={handleInput}
          onPaste={handlePaste}
          onKeyDown={handleEditorKeyDown}
          onBlur={emitChange}
          onClick={handleEditorClick}
          style={
            typeof editorHeight === "number"
              ? { height: editorHeight, minHeight: editorHeight }
              : undefined
          }
          className={cn(
            "rich-comment-editor min-w-0 max-w-full overflow-x-auto overflow-y-auto text-sm text-gray-800 focus:outline-none",
            typeof editorHeight === "number"
              ? "max-h-none"
              : "min-h-[72px] max-h-48",
            "[&_a]:text-[#2563EB] [&_a]:underline [&_strong]:font-semibold [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5",
            "[&_.rich-media-embed]:!inline-block [&_.rich-media-embed]:!align-top [&_.rich-media-embed]:!w-[150px] [&_.rich-media-embed]:!h-[150px] [&_.rich-media-embed]:!min-w-[150px] [&_.rich-media-embed]:!min-h-[150px] [&_.rich-media-embed]:!max-w-[150px] [&_.rich-media-embed]:!max-h-[150px]",
            editorClassName,
          )}
        />
      </div>

      <input
        ref={imageInputRef}
        type="file"
        accept="*/*"
        multiple
        className="hidden"
        onChange={handleImagePick}
      />
      <input
        ref={videoInputRef}
        type="file"
        accept="*/*"
        multiple
        className="hidden"
        onChange={handleImagePick}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="*/*"
        multiple
        className="hidden"
        onChange={handleImagePick}
      />
    </div>
  );
});

export function isSelectionInsideList() {
  const selection = window.getSelection();
  if (!selection?.anchorNode) return false;

  let node: Node | null = selection.anchorNode;
  while (node) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const tag = (node as Element).tagName;
      if (tag === "UL" || tag === "OL" || tag === "LI") return true;
    }
    node = node.parentNode;
  }

  return false;
}

export { getCaretOffset, getPlainText, deleteTextRange };
