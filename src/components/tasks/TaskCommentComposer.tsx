import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Paperclip,
  Smile,
  Send,
  FileText,
  HardDrive,
  CheckSquare,
  Calendar,
  Loader2,
  X,
} from "lucide-react";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { EmojiPickerPanel } from "@/components/shared/EmojiPickerPanel";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  RichTextCommentEditor,
  deleteTextRange,
  getCaretOffset,
  getPlainText,
  isSelectionInsideList,
  type RichTextCommentEditorHandle,
} from "@/components/tasks/RichTextCommentEditor";
import {
  buildRichCommentMessage,
  hasPendingMediaRefs,
  stripPendingMediaTokens,
  type CommentMediaRef,
} from "@/lib/rich-comment";
import {
  clearTaskCommentDraft,
  readTaskCommentDraft,
  writeTaskCommentDraft,
} from "@/lib/task-comment-draft";
import {
  filterMentionUsers,
  getMentionQuery,
  type MentionUser,
} from "@/lib/task-comment-mentions";

type TaskPickerItem = {
  id: number;
  title: string;
  status?: string | null;
};

type CrmFileItem = {
  id: number;
  fileName: string;
  fileSize?: number | null;
};

type TaskCommentComposerProps = {
  taskId: number;
  onSend: (message: string) => void;
  isSending?: boolean;
  isUploadingMedia?: boolean;
  mentionUsers: MentionUser[];
  onUploadMedia: (file: File) => Promise<CommentMediaRef>;
  resolveMediaPreviewUrl?: (media: CommentMediaRef) => Promise<string | undefined>;
  crmFiles: CrmFileItem[];
  isCrmFilesLoading?: boolean;
  onSelectCrmFile: (file: CrmFileItem) => void;
  tasks: TaskPickerItem[];
  isTasksLoading?: boolean;
  onSelectTask: (task: TaskPickerItem) => void;
  onSelectEvent: (title: string, when: string) => void;
};

type AttachMenu = "main" | "crm" | "task" | "event" | null;

type MentionRange = {
  query: string;
  start: number;
  end: number;
};

const EDITOR_HEIGHT_MIN = 72;
const EDITOR_HEIGHT_MAX = 500;
const EDITOR_HEIGHT_DEFAULT = 72;

export function TaskCommentComposer({
  taskId,
  onSend,
  isSending,
  isUploadingMedia,
  mentionUsers,
  onUploadMedia,
  resolveMediaPreviewUrl,
  crmFiles,
  isCrmFilesLoading,
  onSelectCrmFile,
  tasks,
  isTasksLoading,
  onSelectTask,
  onSelectEvent,
}: TaskCommentComposerProps) {
  const savedDraft = useMemo(() => readTaskCommentDraft(taskId), [taskId]);
  const [mentionChips, setMentionChips] = useState<MentionUser[]>(
    () => savedDraft?.mentions ?? [],
  );
  const [richHtml, setRichHtml] = useState(() =>
    stripPendingMediaTokens(savedDraft?.html ?? ""),
  );
  const [richMedia, setRichMedia] = useState<CommentMediaRef[]>(
    () => (savedDraft?.media ?? []).filter((media) => media.id > 0),
  );
  const [plainText, setPlainText] = useState("");
  const [showEmoji, setShowEmoji] = useState(false);
  const [attachMenu, setAttachMenu] = useState<AttachMenu>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [caretPosition, setCaretPosition] = useState(0);
  const [eventTitle, setEventTitle] = useState("");
  const [eventWhen, setEventWhen] = useState("");
  const [taskSearch, setTaskSearch] = useState("");
  const [editorResetKey, setEditorResetKey] = useState(0);
  const [initialHtml] = useState(() => stripPendingMediaTokens(savedDraft?.html ?? ""));
  const [initialMedia] = useState<CommentMediaRef[]>(() =>
    (savedDraft?.media ?? []).filter((media) => media.id > 0),
  );
  const [editorHeight, setEditorHeight] = useState(EDITOR_HEIGHT_DEFAULT);
  const [editorUploading, setEditorUploading] = useState(false);
  const editorHostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<RichTextCommentEditorHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachRef = useRef<HTMLDivElement>(null);
  const mentionRangeRef = useRef<MentionRange | null>(null);
  const wasSendingRef = useRef(false);
  const skipNextDraftWriteRef = useRef(false);
  const resizeDragRef = useRef<{
    pointerId: number;
    startY: number;
    startHeight: number;
  } | null>(null);

  const editorElement = () =>
    editorHostRef.current?.querySelector<HTMLDivElement>("[contenteditable]") ?? null;

  const mentionState = useMemo(
    () => getMentionQuery(plainText, caretPosition),
    [plainText, caretPosition],
  );

  useEffect(() => {
    mentionRangeRef.current = mentionState;
  }, [mentionState]);

  const mentionSuggestions = useMemo(() => {
    if (!mentionState) return [];
    return filterMentionUsers(
      mentionUsers.filter((user) => !mentionChips.some((chip) => chip.id === user.id)),
      mentionState.query,
    );
  }, [mentionState, mentionUsers, mentionChips]);

  const filteredTasks = useMemo(() => {
    const query = taskSearch.trim().toLowerCase();
    if (!query) return tasks.slice(0, 20);
    return tasks
      .filter((task) => task.title.toLowerCase().includes(query) || String(task.id).includes(query))
      .slice(0, 20);
  }, [taskSearch, tasks]);

  useEffect(() => {
    setMentionIndex(0);
  }, [mentionState?.query, mentionSuggestions.length]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (attachRef.current && !attachRef.current.contains(event.target as Node)) {
        setAttachMenu(null);
        setTaskSearch("");
        setEventTitle("");
        setEventWhen("");
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (wasSendingRef.current && !isSending) {
      skipNextDraftWriteRef.current = true;
      clearTaskCommentDraft(taskId);
      setMentionChips([]);
      setRichHtml("");
      setRichMedia([]);
      setPlainText("");
      setEditorResetKey((key) => key + 1);
    }
    wasSendingRef.current = Boolean(isSending);
  }, [isSending, taskId]);

  useEffect(() => {
    if (skipNextDraftWriteRef.current) {
      skipNextDraftWriteRef.current = false;
      return;
    }
    writeTaskCommentDraft(taskId, {
      html: richHtml,
      media: richMedia,
      mentions: mentionChips,
    });
  }, [taskId, richHtml, richMedia, mentionChips]);

  const syncCaret = () => {
    const editor = editorElement();
    if (!editor) return;
    setPlainText(getPlainText(editor));
    setCaretPosition(getCaretOffset(editor));
  };

  const insertMention = (user: MentionUser, range = mentionRangeRef.current) => {
    if (!range) return;

    setMentionChips((current) => {
      if (current.some((chip) => chip.id === user.id)) return current;
      return [...current, user];
    });

    const editor = editorElement();
    if (editor) {
      deleteTextRange(editor, range.start, range.end);
      setRichHtml(editor.innerHTML);
      setPlainText(getPlainText(editor));
      setCaretPosition(getCaretOffset(editor));
    }

    mentionRangeRef.current = null;
    editor?.focus();
  };

  const removeMentionChip = (userId: number) => {
    setMentionChips((current) => current.filter((chip) => chip.id !== userId));
  };

  const submitMessage = () => {
    if (isSending || isUploadingMedia || editorUploading) return;
    if (editorRef.current?.isUploading()) return;

    const live = editorRef.current?.getSerializedContent();
    const html = live?.html ?? richHtml;
    const media = live?.media ?? richMedia;

    if (hasPendingMediaRefs(html, media)) return;

    const message = buildRichCommentMessage(mentionChips, html, media);
    if (!message.trim()) return;
    skipNextDraftWriteRef.current = true;
    clearTaskCommentDraft(taskId);
    onSend(message);
  };

  const hasPendingMedia = hasPendingMediaRefs(richHtml, richMedia);
  const canSend = Boolean(
    (mentionChips.length > 0 || richHtml.trim() || richMedia.length > 0)
    && !hasPendingMedia
    && !editorUploading,
  );

  const handleComposerKeyDown = (event: React.KeyboardEvent) => {
    if (mentionSuggestions.length > 0 && mentionRangeRef.current) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setMentionIndex((prev) => (prev + 1) % mentionSuggestions.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setMentionIndex((prev) => (prev - 1 + mentionSuggestions.length) % mentionSuggestions.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        insertMention(mentionSuggestions[mentionIndex]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        mentionRangeRef.current = null;
        return;
      }
    }

    if (event.key === "Enter" && !event.shiftKey) {
      if (isSelectionInsideList()) return;
      event.preventDefault();
      if (!canSend || isSending || isUploadingMedia || editorUploading) return;
      submitMessage();
    }
  };

  const closeAttachMenu = () => {
    setAttachMenu(null);
    setTaskSearch("");
    setEventTitle("");
    setEventWhen("");
  };

  const clampEditorHeight = useCallback((value: number) => {
    return Math.min(EDITOR_HEIGHT_MAX, Math.max(EDITOR_HEIGHT_MIN, Math.round(value)));
  }, []);

  const handleResizePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    resizeDragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight: editorHeight,
    };
  };

  const handleResizePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = resizeDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    // Dragging upward (smaller clientY) increases the composer height.
    const nextHeight = clampEditorHeight(drag.startHeight + (drag.startY - event.clientY));
    setEditorHeight(nextHeight);
  };

  const endResizeDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = resizeDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    resizeDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <div className="relative border-t border-gray-200 bg-white" onKeyDown={handleComposerKeyDown}>
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize comment area"
        aria-valuemin={EDITOR_HEIGHT_MIN}
        aria-valuemax={EDITOR_HEIGHT_MAX}
        aria-valuenow={editorHeight}
        onPointerDown={handleResizePointerDown}
        onPointerMove={handleResizePointerMove}
        onPointerUp={endResizeDrag}
        onPointerCancel={endResizeDrag}
        className="group flex h-5 w-full cursor-ns-resize touch-none select-none items-center justify-center bg-white hover:bg-gray-50"
        title="Drag up to expand"
      >
        <span className="flex flex-col gap-[3px]" aria-hidden>
          <span className="block h-[2px] w-8 rounded-full bg-gray-300 group-hover:bg-gray-400" />
          <span className="block h-[2px] w-8 rounded-full bg-gray-300 group-hover:bg-gray-400" />
        </span>
      </div>

      <div className="px-4 pb-3 pt-1">
      {mentionSuggestions.length > 0 ? (
        <div className="absolute left-4 right-4 bottom-full mb-2 rounded-xl border border-gray-200 bg-white shadow-lg overflow-hidden z-20">
          {mentionSuggestions.map((user, index) => (
            <button
              key={user.id}
              type="button"
              onMouseDown={(event) => {
                event.preventDefault();
                insertMention(user);
              }}
              className={`w-full flex items-center gap-3 px-3 py-2 text-left text-sm hover:bg-gray-50 ${
                index === mentionIndex ? "bg-blue-50" : ""
              }`}
            >
              <UserAvatar name={user.name} avatar={user.avatar} size={28} />
              <span className="font-medium text-gray-800">{user.name}</span>
            </button>
          ))}
        </div>
      ) : null}

      {/* Mobile: editor full-width, then attach/emoji/send below. Desktop: attach | editor | emoji | send */}
      <div className="flex flex-col gap-2 lg:flex-row lg:items-end">
        <div className="order-1 w-full min-w-0 flex-1 rounded-xl border border-gray-200 bg-white focus-within:ring-2 focus-within:ring-[#2563EB]/20 lg:order-2">
          {mentionChips.length > 0 ? (
            <div className="flex flex-wrap gap-2 px-3 pt-3">
              {mentionChips.map((user) => (
                <span
                  key={user.id}
                  className="inline-flex items-center gap-1.5 rounded-md bg-blue-50 px-2 py-1 text-sm font-medium text-[#2563EB] underline underline-offset-2"
                >
                  {user.name}
                  <button
                    type="button"
                    onClick={() => removeMentionChip(user.id)}
                    className="text-blue-400 hover:text-blue-700"
                    aria-label={`Remove ${user.name ?? "user"}`}
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          ) : null}

          <div
            ref={editorHostRef}
            onKeyUp={syncCaret}
            onClick={syncCaret}
          >
            <RichTextCommentEditor
              ref={editorRef}
              key={editorResetKey}
              initialHtml={editorResetKey === 0 ? initialHtml : ""}
              initialMedia={editorResetKey === 0 ? initialMedia : []}
              editorHeight={editorHeight}
              onChange={(html, media) => {
                setRichHtml(html);
                setRichMedia(media);
                syncCaret();
              }}
              onUploadingChange={setEditorUploading}
              onUploadMedia={onUploadMedia}
              resolveMediaPreviewUrl={resolveMediaPreviewUrl}
              disabled={isSending}
              placeholder="Type @ to mention someone..."
            />
          </div>
        </div>

        <div className="order-2 flex items-center gap-2 max-lg:w-full max-lg:justify-between lg:contents">
        <div className="relative shrink-0 lg:order-1" ref={attachRef}>
          <button
            type="button"
            onClick={() => setAttachMenu((prev) => (prev ? null : "main"))}
            className="w-9 h-9 flex items-center justify-center rounded-lg text-[#2563EB] hover:bg-blue-50"
            aria-label="Attach"
          >
            <Paperclip size={18} />
          </button>

          {attachMenu ? (
            <div className="absolute left-0 bottom-full mb-2 w-64 rounded-xl border border-gray-200 bg-white shadow-lg z-20 overflow-hidden">
              {attachMenu === "main" ? (
                <div className="py-1">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
                  >
                    <FileText size={16} className="text-gray-400" />
                    Files on this computer
                  </button>
                  <button
                    type="button"
                    onClick={() => setAttachMenu("crm")}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
                  >
                    <HardDrive size={16} className="text-gray-400" />
                    Files on tracking CRM
                  </button>
                  <button
                    type="button"
                    onClick={() => setAttachMenu("task")}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
                  >
                    <CheckSquare size={16} className="text-gray-400" />
                    Task
                  </button>
                  <button
                    type="button"
                    onClick={() => setAttachMenu("event")}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
                  >
                    <Calendar size={16} className="text-gray-400" />
                    Event or meeting
                  </button>
                </div>
              ) : null}

              {attachMenu === "crm" ? (
                <div className="max-h-64 overflow-y-auto py-1">
                  <div className="px-4 py-2 text-xs font-semibold text-gray-500 border-b border-gray-100">
                    Files on tracking CRM
                  </div>
                  {isCrmFilesLoading ? (
                    <div className="flex items-center justify-center py-6 text-gray-400">
                      <Loader2 size={16} className="animate-spin" />
                    </div>
                  ) : crmFiles.length === 0 ? (
                    <p className="px-4 py-4 text-sm text-gray-500">No files found.</p>
                  ) : (
                    crmFiles.map((file) => (
                      <button
                        key={file.id}
                        type="button"
                        onClick={() => {
                          onSelectCrmFile(file);
                          closeAttachMenu();
                        }}
                        className="w-full px-4 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-50 truncate"
                      >
                        {file.fileName}
                      </button>
                    ))
                  )}
                </div>
              ) : null}

              {attachMenu === "task" ? (
                <div className="py-2">
                  <div className="px-4 pb-2 text-xs font-semibold text-gray-500">Select task</div>
                  <input
                    value={taskSearch}
                    onChange={(e) => setTaskSearch(e.target.value)}
                    placeholder="Search tasks..."
                    className="mx-4 mb-2 w-[calc(100%-2rem)] rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20"
                  />
                  <div className="max-h-56 overflow-y-auto">
                    {isTasksLoading ? (
                      <div className="flex items-center justify-center py-6 text-gray-400">
                        <Loader2 size={16} className="animate-spin" />
                      </div>
                    ) : filteredTasks.length === 0 ? (
                      <p className="px-4 py-4 text-sm text-gray-500">No tasks found.</p>
                    ) : (
                      filteredTasks.map((task) => (
                        <button
                          key={task.id}
                          type="button"
                          onClick={() => {
                            onSelectTask(task);
                            closeAttachMenu();
                          }}
                          className="w-full px-4 py-2.5 text-left hover:bg-gray-50"
                        >
                          <p className="text-sm font-medium text-gray-800 truncate">{task.title}</p>
                          <p className="text-xs text-gray-500">#{task.id}{task.status ? ` · ${task.status}` : ""}</p>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              ) : null}

              {attachMenu === "event" ? (
                <div className="p-4 space-y-3">
                  <p className="text-xs font-semibold text-gray-500">Event or meeting</p>
                  <input
                    value={eventTitle}
                    onChange={(e) => setEventTitle(e.target.value)}
                    placeholder="Title"
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20"
                  />
                  <input
                    value={eventWhen}
                    onChange={(e) => setEventWhen(e.target.value)}
                    placeholder="Date / time"
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20"
                  />
                  <button
                    type="button"
                    disabled={!eventTitle.trim()}
                    onClick={() => {
                      onSelectEvent(eventTitle.trim(), eventWhen.trim());
                      closeAttachMenu();
                    }}
                    className="w-full h-9 rounded-lg bg-[#2563EB] text-white text-sm font-medium hover:bg-[#1D4ED8] disabled:opacity-50"
                  >
                    Add to comment
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}

          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="*/*"
            className="hidden"
            onChange={(e) => {
              const files = e.target.files;
              if (files?.length) {
                void editorRef.current?.attachFiles(files);
                e.target.value = "";
                closeAttachMenu();
              }
            }}
          />
        </div>

        <div className="flex items-center gap-2 shrink-0 lg:contents">
          <Popover modal open={showEmoji} onOpenChange={setShowEmoji}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="w-9 h-9 flex items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 lg:order-3"
                aria-label="Emoji"
              >
                <Smile size={18} />
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              side="top"
              sideOffset={8}
              className="z-[160] w-auto p-0 border-0 bg-transparent shadow-none"
              onOpenAutoFocus={(event) => event.preventDefault()}
              onInteractOutside={() => setShowEmoji(false)}
              onPointerDownOutside={() => setShowEmoji(false)}
              onFocusOutside={() => setShowEmoji(false)}
              onEscapeKeyDown={() => setShowEmoji(false)}
            >
              <EmojiPickerPanel
                onSelect={(emoji) => {
                  const editor = editorElement();
                  if (editor) {
                    editor.focus();
                    document.execCommand("insertText", false, emoji);
                    setRichHtml(editor.innerHTML);
                    setPlainText(getPlainText(editor));
                  }
                  setShowEmoji(false);
                }}
              />
            </PopoverContent>
          </Popover>

          <button
            type="button"
            onClick={submitMessage}
            disabled={!canSend || isSending || isUploadingMedia || editorUploading}
            className="w-10 h-10 flex items-center justify-center rounded-full bg-[#2563EB] text-white hover:bg-[#1D4ED8] disabled:opacity-50 lg:order-4"
            aria-label="Send"
          >
            {isSending || isUploadingMedia || editorUploading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          </button>
        </div>
        </div>
      </div>
      </div>
    </div>
  );
}
