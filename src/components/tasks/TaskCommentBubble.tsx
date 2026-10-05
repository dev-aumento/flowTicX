import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Copy, Loader2, MoreHorizontal, Pencil, Smile, Trash2, X } from "lucide-react";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { EmojiPickerPanel } from "@/components/shared/EmojiPickerPanel";
import { formatChatTimestamp, cn } from "@/lib/utils";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { createAttachmentPreviewResolver } from "@/lib/attachment-preview";
import { CommentRichContent } from "@/components/tasks/CommentRichContent";
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
  getCommentClipboardPayload,
  getCommentEditDraft,
  isEditorContentEmpty,
  type CommentMediaRef,
} from "@/lib/rich-comment";
import {
  filterMentionUsers,
  getMentionQuery,
  type MentionUser,
} from "@/lib/task-comment-mentions";
import {
  commentReactionSummary,
  readCommentReactions,
  toggleUserReaction,
} from "@/lib/comment-reactions";
import {
  getRecentReactionEmojis,
  rememberRecentReactionEmoji,
} from "@/lib/emoji-data";
import { toast } from "sonner";

type CommentActivity = {
  id: number;
  userId?: number | null;
  newValue?: string | null;
  createdAt: Date | string;
  metadata?: Record<string, unknown> | null;
  user?: {
    name: string | null;
    avatar?: string | null;
  } | null;
};

type TaskCommentBubbleProps = {
  activity: CommentActivity;
  taskId: number;
  isOwn: boolean;
  mentionUsers: MentionUser[];
  canManage: boolean;
  isSaving?: boolean;
  isDeleting?: boolean;
  onSave: (activityId: number, message: string) => void;
  onDelete: (activityId: number) => void;
  onUploadMedia: (file: File) => Promise<CommentMediaRef>;
};

function isEdited(activity: CommentActivity) {
  return Boolean(activity.metadata?.editedAt);
}

export function TaskCommentBubble({
  activity,
  taskId,
  isOwn,
  mentionUsers,
  canManage,
  isSaving,
  isDeleting,
  onSave,
  onDelete,
  onUploadMedia,
}: TaskCommentBubbleProps) {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const resolveMediaPreviewUrl = useMemo(
    () => createAttachmentPreviewResolver((id) => utils.task.getAttachment.fetch({ id })),
    [utils],
  );
  const [isEditing, setIsEditing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [reactOpen, setReactOpen] = useState(false);
  const [quickReactOpen, setQuickReactOpen] = useState(false);
  const [quickEmojis, setQuickEmojis] = useState<string[]>(() => getRecentReactionEmojis());
  const [quickReactPos, setQuickReactPos] = useState<{ top: number; left: number } | null>(null);
  const quickCloseTimerRef = useRef<number | null>(null);
  const reactTriggerRef = useRef<HTMLButtonElement>(null);
  const [mentionChips, setMentionChips] = useState<MentionUser[]>([]);
  const [editHtml, setEditHtml] = useState("");
  const [editMedia, setEditMedia] = useState<CommentMediaRef[]>([]);
  const [editorKey, setEditorKey] = useState(0);
  const [plainText, setPlainText] = useState("");
  const [caretPosition, setCaretPosition] = useState(0);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionMenuPos, setMentionMenuPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const editorHostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<RichTextCommentEditorHandle>(null);
  const mentionRangeRef = useRef<ReturnType<typeof getMentionQuery>>(null);
  const wasSavingRef = useRef(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Refresh once the "just now" window ends, then each minute for the clock label.
  useEffect(() => {
    const then = new Date(activity.createdAt).getTime();
    if (Number.isNaN(then)) return;

    const schedule = () => {
      const age = Date.now() - then;
      const delay = age < 60_000 ? Math.max(250, 60_000 - age + 50) : 60_000;
      return window.setTimeout(() => setNowMs(Date.now()), delay);
    };

    const id = schedule();
    return () => window.clearTimeout(id);
  }, [activity.createdAt, nowMs]);

  const timestampLabel = formatChatTimestamp(activity.createdAt, nowMs);

  const editDraft = useMemo(
    () => getCommentEditDraft(activity.newValue ?? "", mentionUsers),
    [activity.newValue, mentionUsers],
  );

  const reactionItems = useMemo(
    () =>
      commentReactionSummary(
        readCommentReactions(activity.metadata),
        user?.id,
      ),
    [activity.metadata, user?.id],
  );

  const reactMutation = trpc.task.toggleCommentReaction.useMutation({
    onMutate: async ({ emoji }) => {
      if (!user?.id) return { previous: undefined };

      await utils.task.getById.cancel({ id: taskId });
      const previous = utils.task.getById.getData({ id: taskId });
      if (!previous?.activities) return { previous };

      utils.task.getById.setData({ id: taskId }, {
        ...previous,
        activities: previous.activities.map((item) => {
          if (item.id !== activity.id) return item;
          const baseMeta =
            item.metadata && typeof item.metadata === "object"
              ? { ...(item.metadata as Record<string, unknown>) }
              : {};
          const reactions = toggleUserReaction(
            readCommentReactions(baseMeta),
            emoji,
            user.id,
          );
          return {
            ...item,
            metadata: {
              ...baseMeta,
              reactions,
            },
          };
        }),
      });

      return { previous };
    },
    onError: (error, _vars, context) => {
      if (context?.previous) {
        utils.task.getById.setData({ id: taskId }, context.previous);
      }
      toast.error(error.message || "Could not save reaction");
    },
    onSettled: async () => {
      await utils.task.getById.invalidate({ id: taskId });
      await utils.notification.list.invalidate();
    },
  });

  useEffect(() => {
    if (wasSavingRef.current && !isSaving) {
      setIsEditing(false);
    }
    wasSavingRef.current = Boolean(isSaving);
  }, [isSaving]);

  const startEdit = () => {
    setMentionChips(editDraft.mentions);
    setEditHtml(editDraft.html);
    setEditMedia(editDraft.media);
    setEditorKey((key) => key + 1);
    setIsEditing(true);
    setMenuOpen(false);
  };

  const cancelEdit = () => {
    setIsEditing(false);
    setMentionChips([]);
    setEditHtml("");
    setEditMedia([]);
    setPlainText("");
    setCaretPosition(0);
    mentionRangeRef.current = null;
  };

  const editorElement = () =>
    editorHostRef.current?.querySelector<HTMLDivElement>("[contenteditable]") ?? null;

  const mentionState = useMemo(
    () => (isEditing ? getMentionQuery(plainText, caretPosition) : null),
    [isEditing, plainText, caretPosition],
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

  useEffect(() => {
    setMentionIndex(0);
  }, [mentionState?.query, mentionSuggestions.length]);

  useLayoutEffect(() => {
    if (!isEditing || mentionSuggestions.length === 0) {
      setMentionMenuPos(null);
      return;
    }

    const update = () => {
      const rect = editorHostRef.current?.getBoundingClientRect();
      if (!rect) return;
      setMentionMenuPos({ top: rect.top, left: rect.left, width: rect.width });
    };

    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [isEditing, mentionSuggestions.length, plainText, caretPosition]);

  const syncCaret = () => {
    const editor = editorElement();
    if (!editor) return;
    setPlainText(getPlainText(editor));
    setCaretPosition(getCaretOffset(editor));
  };

  const insertMention = (mentioned: MentionUser, range = mentionRangeRef.current) => {
    if (!range) return;

    setMentionChips((current) => {
      if (current.some((chip) => chip.id === mentioned.id)) return current;
      return [...current, mentioned];
    });

    const editor = editorElement();
    if (editor) {
      deleteTextRange(editor, range.start, range.end);
      setEditHtml(editor.innerHTML);
      setPlainText(getPlainText(editor));
      setCaretPosition(getCaretOffset(editor));
    }

    mentionRangeRef.current = null;
    editor?.focus();
  };

  const saveEdit = () => {
    const message = buildRichCommentMessage(mentionChips, editHtml, editMedia);
    if (!message.trim()) return;
    if (message.trim() === (activity.newValue ?? "").trim()) {
      cancelEdit();
      return;
    }
    onSave(activity.id, message);
  };

  const handleDelete = () => {
    setMenuOpen(false);
    onDelete(activity.id);
  };

  const copyComment = async () => {
    setMenuOpen(false);
    const payload = getCommentClipboardPayload(activity.newValue ?? "");
    const text = payload.text.trim();
    if (!text) {
      toast.error("Nothing to copy");
      return;
    }
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      toast.success("Comment copied");
    } catch {
      toast.error("Could not copy comment");
    }
  };

  const removeMentionChip = (userId: number) => {
    setMentionChips((current) => current.filter((chip) => chip.id !== userId));
  };

  const toggleReaction = (emoji: string) => {
    if (!user?.id || reactMutation.isPending) return;
    rememberRecentReactionEmoji(emoji);
    setQuickEmojis(getRecentReactionEmojis());
    setQuickReactOpen(false);
    setReactOpen(false);
    reactMutation.mutate({
      taskId,
      activityId: activity.id,
      emoji,
    });
  };

  const clearQuickCloseTimer = () => {
    if (quickCloseTimerRef.current != null) {
      window.clearTimeout(quickCloseTimerRef.current);
      quickCloseTimerRef.current = null;
    }
  };

  const updateQuickReactPosition = () => {
    const trigger = reactTriggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const gap = 6;
    const estimatedWidth = Math.max(quickEmojis.length, 1) * 32 + 12;
    let left = isOwn ? rect.right - estimatedWidth : rect.left;
    left = Math.max(8, Math.min(left, window.innerWidth - estimatedWidth - 8));
    const top = Math.max(8, rect.top - gap);
    setQuickReactPos({ top, left });
  };

  const openQuickReactions = () => {
    clearQuickCloseTimer();
    if (!reactOpen) {
      setQuickEmojis(getRecentReactionEmojis());
      updateQuickReactPosition();
      setQuickReactOpen(true);
    }
  };

  const scheduleCloseQuickReactions = () => {
    clearQuickCloseTimer();
    quickCloseTimerRef.current = window.setTimeout(() => {
      setQuickReactOpen(false);
      quickCloseTimerRef.current = null;
    }, 180);
  };

  useLayoutEffect(() => {
    if (!quickReactOpen || reactOpen) return;
    updateQuickReactPosition();
    const onReposition = () => updateQuickReactPosition();
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [quickReactOpen, reactOpen, isOwn, quickEmojis.length]);

  useEffect(() => {
    return () => clearQuickCloseTimer();
  }, []);

  const isBusy = Boolean(isSaving || isDeleting);
  const canSave = Boolean(
    mentionChips.length > 0
    || !isEditorContentEmpty(editHtml)
    || editMedia.length > 0,
  );

  return (
    <div
      className={cn(
        "flex items-start gap-2 max-w-[92%]",
        isOwn ? "ml-auto flex-row-reverse" : "mr-auto",
      )}
    >
      <UserAvatar
        name={activity.user?.name}
        avatar={activity.user?.avatar}
        size={36}
        className="mt-1 shrink-0"
      />

      <div
        className={cn(
          "min-w-0 flex-1 rounded-xl border px-4 py-3 text-sm shadow-sm select-text [-webkit-user-select:text] [-webkit-touch-callout:default]",
          isOwn
            ? "bg-[#DCFCE7] border-[#BBF7D0] text-gray-800 dark:text-gray-100 dark:shadow-none"
            : "bg-white border-gray-200 text-gray-800 dark:bg-[#151c2c] dark:border-white/10 dark:text-gray-100 dark:shadow-none",
        )}
      >
        <div className="flex items-start justify-between gap-3 mb-1 select-none">
          <p className="font-semibold text-xs text-[#2563EB] dark:text-[#38BDF8]">
            {activity.user?.name ?? "Unknown"}
          </p>
          {!isEditing ? (
            <Popover open={menuOpen} onOpenChange={setMenuOpen} modal>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  disabled={isBusy}
                  className="shrink-0 w-7 h-7 flex items-center justify-center rounded-md text-gray-400 hover:text-gray-700 hover:bg-white/60 dark:hover:text-gray-200 dark:hover:bg-white/10 disabled:opacity-50"
                  aria-label="Comment options"
                  title="Comment options"
                >
                  {isDeleting ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <MoreHorizontal size={14} />
                  )}
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
                    void copyComment();
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-700 hover:bg-gray-100"
                >
                  <Copy size={14} />
                  Copy
                </button>
                {canManage ? (
                  <>
                    <button
                      type="button"
                      onClick={startEdit}
                      className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-700 hover:bg-gray-100"
                    >
                      <Pencil size={14} />
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={handleDelete}
                      className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-red-600 hover:bg-red-50"
                    >
                      <Trash2 size={14} />
                      Delete
                    </button>
                  </>
                ) : null}
              </PopoverContent>
            </Popover>
          ) : null}
        </div>

        {isEditing ? (
          <div
            className="space-y-2"
            onKeyDown={(event: KeyboardEvent) => {
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

              if (event.key === "Enter" && !event.shiftKey && !isSelectionInsideList()) {
                // Keep Enter for new lines/lists inside the editor while editing.
                // Save remains via the Save button.
                event.stopPropagation();
              }
            }}
          >
            {mentionMenuPos && mentionSuggestions.length > 0
              ? createPortal(
                  <div
                    className="fixed z-[220] rounded-xl border border-gray-200 bg-white shadow-lg overflow-hidden"
                    style={{
                      top: mentionMenuPos.top - 8,
                      left: mentionMenuPos.left,
                      width: mentionMenuPos.width,
                      transform: "translateY(-100%)",
                    }}
                  >
                    {mentionSuggestions.map((mentioned, index) => (
                      <button
                        key={mentioned.id}
                        type="button"
                        onMouseDown={(event) => {
                          event.preventDefault();
                          insertMention(mentioned);
                        }}
                        className={`w-full flex items-center gap-3 px-3 py-2 text-left text-sm hover:bg-gray-50 ${
                          index === mentionIndex ? "bg-blue-50" : ""
                        }`}
                      >
                        <UserAvatar name={mentioned.name} avatar={mentioned.avatar} size={28} />
                        <span className="font-medium text-gray-800">{mentioned.name}</span>
                      </button>
                    ))}
                  </div>,
                  document.body,
                )
              : null}
            <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
              {mentionChips.length > 0 ? (
                <div className="flex flex-wrap gap-2 px-3 pt-3">
                  {mentionChips.map((userChip) => (
                    <span
                      key={userChip.id}
                      className="inline-flex items-center gap-1.5 rounded-md bg-blue-50 px-2 py-1 text-sm font-medium text-[#2563EB] underline underline-offset-2"
                    >
                      {userChip.name}
                      <button
                        type="button"
                        onClick={() => removeMentionChip(userChip.id)}
                        className="text-blue-400 hover:text-blue-700"
                        aria-label={`Remove ${userChip.name ?? "user"}`}
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
                  key={editorKey}
                  initialHtml={editHtml}
                  initialMedia={editMedia}
                  onChange={(html, media) => {
                    setEditHtml(html);
                    setEditMedia(media);
                    syncCaret();
                  }}
                  onUploadMedia={onUploadMedia}
                  resolveMediaPreviewUrl={resolveMediaPreviewUrl}
                  disabled={isSaving}
                  placeholder="Edit comment... Type @ to mention someone"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={cancelEdit}
                disabled={isSaving}
                className="h-8 px-3 rounded-lg text-xs font-medium text-gray-600 hover:bg-white/70 disabled:opacity-50 dark:bg-[#151c2c] dark:text-gray-100 dark:hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveEdit}
                disabled={isSaving || !canSave}
                className="h-8 px-3 rounded-lg text-xs font-medium bg-[#2563EB] text-white hover:bg-[#1D4ED8] disabled:opacity-50 inline-flex items-center gap-1.5"
              >
                {isSaving ? <Loader2 size={12} className="animate-spin" /> : null}
                Save
              </button>
            </div>
          </div>
        ) : (
          <CommentRichContent
            message={activity.newValue ?? ""}
            mentionUsers={mentionUsers}
            inlineMedia
          />
        )}

        {!isEditing ? (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {reactionItems.map((item) => (
              <button
                key={item.emoji}
                type="button"
                disabled={reactMutation.isPending}
                onClick={() => toggleReaction(item.emoji)}
                title={item.reactedByMe ? "Remove reaction" : "Add reaction"}
                className={cn(
                  "inline-flex items-center gap-1 h-7 px-2 rounded-full border text-xs transition-colors disabled:opacity-50",
                  item.reactedByMe
                    ? "bg-blue-50 border-blue-200 text-[#2563EB] dark:bg-[#2563EB]/20 dark:border-[#2563EB]/40 dark:text-[#38BDF8]"
                    : "bg-white/80 border-gray-200 text-gray-600 hover:bg-white dark:bg-white/5 dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/10",
                )}
              >
                <span className="text-sm leading-none">{item.emoji}</span>
                <span className="font-medium tabular-nums">{item.count}</span>
              </button>
            ))}

            <div
              className="relative inline-flex"
              onMouseEnter={openQuickReactions}
              onMouseLeave={scheduleCloseQuickReactions}
            >
              {quickReactOpen && !reactOpen && quickReactPos
                ? createPortal(
                    <div
                      className="fixed z-[220] flex items-center gap-0.5 rounded-full border border-gray-200 bg-white px-1.5 py-1 shadow-lg"
                      style={{
                        top: quickReactPos.top,
                        left: quickReactPos.left,
                        transform: "translateY(-100%)",
                      }}
                      onMouseEnter={openQuickReactions}
                      onMouseLeave={scheduleCloseQuickReactions}
                    >
                      {quickEmojis.map((emoji) => (
                        <button
                          key={emoji}
                          type="button"
                          disabled={reactMutation.isPending}
                          onClick={() => toggleReaction(emoji)}
                          className="h-8 w-8 inline-flex items-center justify-center rounded-full text-lg hover:bg-gray-100 transition-colors disabled:opacity-50"
                          aria-label={`React with ${emoji}`}
                          title={`React with ${emoji}`}
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>,
                    document.body,
                  )
                : null}

              <Popover
                modal
                open={reactOpen}
                onOpenChange={(open) => {
                  setReactOpen(open);
                  if (open) setQuickReactOpen(false);
                }}
              >
                <PopoverTrigger asChild>
                  <button
                    ref={reactTriggerRef}
                    type="button"
                    disabled={reactMutation.isPending}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-dashed border-gray-300 text-gray-400 hover:text-[#2563EB] hover:border-[#2563EB]/40 hover:bg-white dark:border-white/20 dark:text-gray-400 dark:hover:text-[#38BDF8] dark:hover:border-[#38BDF8]/40 dark:hover:bg-white/10 disabled:opacity-50"
                    aria-label="Add reaction"
                    title="Add reaction"
                  >
                    {reactMutation.isPending ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Smile size={14} />
                    )}
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  align={isOwn ? "end" : "start"}
                  side="top"
                  sideOffset={8}
                  className="z-[220] w-auto p-0 border-0 bg-transparent shadow-none"
                  onOpenAutoFocus={(event) => event.preventDefault()}
                  onInteractOutside={() => setReactOpen(false)}
                  onPointerDownOutside={() => setReactOpen(false)}
                  onFocusOutside={() => setReactOpen(false)}
                  onEscapeKeyDown={() => setReactOpen(false)}
                >
                  <EmojiPickerPanel
                    onSelect={(emoji) => {
                      toggleReaction(emoji);
                    }}
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div className="ml-auto flex items-center gap-2">
              {isEdited(activity) ? (
                <span className="text-[10px] text-gray-400">edited</span>
              ) : null}
              <span className="text-[10px] text-gray-400">
                {timestampLabel}
              </span>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-end gap-2 mt-2">
            {isEdited(activity) ? (
              <span className="text-[10px] text-gray-400">edited</span>
            ) : null}
            <span className="text-[10px] text-gray-400">
              {timestampLabel}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
