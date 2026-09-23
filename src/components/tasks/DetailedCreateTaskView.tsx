import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  Flame, Calendar, Clock, Paperclip, AtSign, List, ListOrdered,
  Sparkles, ListChecks, FolderOpen, Users,
  Loader2, UserPlus, Search, Smile, Mic, Send,
  ChevronDown, User, Play, Plus, Folder, Flag, X,
} from "lucide-react";
import type { CreateTaskFormData } from "@/components/tasks/CreateTaskModal";
import {
  META_DATETIME_CLASS,
  META_SELECT_CLASS,
  PriorityMetaSelect,
  TaskMetaRow,
  TaskSectionCard,
} from "@/components/tasks/task-form-ui";
import {
  RichTextCommentEditor,
  deleteTextRange,
  getCaretOffset,
  getPlainText,
} from "@/components/tasks/RichTextCommentEditor";
import { UserSearchSelect } from "@/components/tasks/UserSearchSelect";
import { ProjectSearchSelect } from "@/components/tasks/ProjectSearchSelect";
import { UserAvatar } from "@/components/shared/UserAvatar";
import {
  type PipelineStageDef,
  type ProjectPipelineStageKey,
} from "@/lib/task-kanban";
import { useAuth } from "@/hooks/useAuth";
import { useOrgPipelineStages } from "@/hooks/useOrgPipelineStages";
import { TaskFilesSection, type PendingTaskAttachment } from "@/components/tasks/TaskFilesSection";
import { assertAttachmentFileSize } from "@/lib/task-files";
import { buildRichCommentMessage } from "@/lib/rich-comment";
import { createStagedAttachmentPreviewResolver } from "@/lib/attachment-preview";
import { stageTaskMediaFile } from "@/lib/staged-task-media";
import {
  filterMentionUsers,
  filterMentionableUsers,
  getMentionQuery,
  type MentionUser,
} from "@/lib/task-comment-mentions";
import { cn } from "@/lib/utils";
import { clientCanViewDueDate, clientCanViewTimeTracking } from "@/lib/client-visibility";
import { isTaskAssignableUser } from "@/lib/leave-policy";

type UserOption = {
  id: number;
  name: string | null;
  avatar?: string | null;
  role?: string | null;
  department?: string | null;
};
type ProjectOption = { id: number; name: string };
type TaskLinkOption = { id: number; title: string };

const FEATURE_MODULES: never[] = [];

interface DetailedCreateTaskViewProps {
  formData: CreateTaskFormData;
  onFormDataChange: Dispatch<SetStateAction<CreateTaskFormData>>;
  users: UserOption[];
  projects: ProjectOption[];
  tasks?: TaskLinkOption[];
  currentUser?: UserOption | null;
  isSubmitting?: boolean;
  onSubmit: () => void;
  onCancel: () => void;
  pipelineStages?: PipelineStageDef[];
  /** Hide Task Chat column (mobile create / full-screen create). */
  hideTaskChat?: boolean;
  /** Invited clients stay the owner so assigned work appears in Client's Tasks. */
  lockOwner?: boolean;
}

import {
  estimatedHoursFromParts,
  formatEstimatedDuration,
  splitEstimatedHoursMinutes,
} from "@/lib/task-time-estimate";

export function DetailedCreateTaskView({
  formData,
  onFormDataChange,
  users,
  projects,
  tasks = [],
  currentUser,
  isSubmitting,
  onSubmit,
  onCancel,
  pipelineStages: pipelineStagesProp,
  hideTaskChat = false,
  lockOwner = false,
}: DetailedCreateTaskViewProps) {
  const { user } = useAuth();
  const orgStages = useOrgPipelineStages();
  const pipelineStages =
    pipelineStagesProp && pipelineStagesProp.length > 0 ? pipelineStagesProp : orgStages;
  const showDueDate = clientCanViewDueDate(user);
  const showTimeTracking = clientCanViewTimeTracking(user);
  const titleRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const formDataRef = useRef(formData);
  const [chatHtml, setChatHtml] = useState("");
  const [chatMedia, setChatMedia] = useState<CreateTaskFormData["descriptionMedia"]>([]);
  /** Bump only when clearing the chat composer (after Add to chat), not on each keystroke. */
  const [chatEditorKey, setChatEditorKey] = useState(0);
  const [chatMentionChips, setChatMentionChips] = useState<MentionUser[]>([]);
  const [chatPlainText, setChatPlainText] = useState("");
  const [chatCaretPosition, setChatCaretPosition] = useState(0);
  const [chatMentionIndex, setChatMentionIndex] = useState(0);
  const [chatMentionDismissed, setChatMentionDismissed] = useState(false);
  const chatEditorHostRef = useRef<HTMLDivElement>(null);
  const chatMentionRangeRef = useRef<{ query: string; start: number; end: number } | null>(null);
  // const [templatesOpen, setTemplatesOpen] = useState(false);
  const [showTimePlanning, setShowTimePlanning] = useState(false);
  const estimateParts = splitEstimatedHoursMinutes(formData.estimatedHours);
  const [estimateHours, setEstimateHours] = useState(estimateParts.hours);
  const [estimateMinutes, setEstimateMinutes] = useState(estimateParts.minutes);

  useEffect(() => {
    const parts = splitEstimatedHoursMinutes(formData.estimatedHours);
    setEstimateHours(parts.hours);
    setEstimateMinutes(parts.minutes);
  }, [formData.estimatedHours]);

  useEffect(() => {
    formDataRef.current = formData;
  }, [formData]);

  const update = (
    patch: Partial<CreateTaskFormData> | ((prev: CreateTaskFormData) => Partial<CreateTaskFormData>),
  ) => {
    onFormDataChange((prev) => ({
      ...prev,
      ...(typeof patch === "function" ? patch(prev) : patch),
    }));
  };

  const isHot = formData.priority === "urgent" || formData.priority === "high";

  const resolveMediaPreviewUrl = useMemo(
    () => createStagedAttachmentPreviewResolver(formData.pendingAttachments),
    [formData.pendingAttachments],
  );

  const stageMediaUpload = async (file: File) => {
    const staged = await stageTaskMediaFile(file, formDataRef.current.pendingAttachments);
    update((prev) => ({
      pendingAttachments: staged.pendingAttachments,
      descriptionMedia: [...prev.descriptionMedia, staged.media],
    }));
    return {
      id: staged.media.id,
      fileName: staged.media.fileName,
      mimeType: staged.media.mimeType,
    };
  };

  const chatMediaUpload = async (file: File) => {
    const staged = await stageTaskMediaFile(file, formDataRef.current.pendingAttachments);
    update({ pendingAttachments: staged.pendingAttachments });
    setChatMedia((current) => [...current, staged.media]);
    return {
      id: staged.media.id,
      fileName: staged.media.fileName,
      mimeType: staged.media.mimeType,
    };
  };

  const toggleUserInList = (field: "participantIds" | "observerIds", userId: number) => {
    const list = formData[field];
    const isSelected = list.includes(userId);
    const next = isSelected ? list.filter((id) => id !== userId) : [...list, userId];

    if (field === "participantIds" && !isSelected) {
      update({
        participantIds: next,
        observerIds: formData.observerIds.filter((id) => id !== userId),
      });
      return;
    }

    update({ [field]: next } as Partial<CreateTaskFormData>);
  };

  const handleAttachFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    try {
      const picked: PendingTaskAttachment[] = Array.from(files).map((file) => {
        assertAttachmentFileSize(file);
        return {
          clientId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
          fileSize: file.size,
          file,
          previewUrl: URL.createObjectURL(file),
        };
      });
      update((prev) => ({
        pendingAttachments: [...prev.pendingAttachments, ...picked],
      }));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not attach file. Please try again.";
      window.alert(message);
    }
  };

  const chatEditorElement = () =>
    chatEditorHostRef.current?.querySelector<HTMLDivElement>("[contenteditable]") ?? null;

  const syncChatCaret = () => {
    const editor = chatEditorElement();
    if (!editor) return;
    setChatPlainText(getPlainText(editor));
    setChatCaretPosition(getCaretOffset(editor));
  };

  const chatMentionState = useMemo(
    () => getMentionQuery(chatPlainText, chatCaretPosition),
    [chatPlainText, chatCaretPosition],
  );

  useEffect(() => {
    chatMentionRangeRef.current = chatMentionState;
  }, [chatMentionState]);

  const chatMentionSuggestions = useMemo(() => {
    if (!chatMentionState) return [];
    return filterMentionUsers(
      filterMentionableUsers(users).filter(
        (user) => !chatMentionChips.some((chip) => chip.id === user.id),
      ),
      chatMentionState.query,
    );
  }, [chatMentionState, users, chatMentionChips]);

  useEffect(() => {
    setChatMentionIndex(0);
    setChatMentionDismissed(false);
  }, [chatMentionState?.query, chatMentionState?.start, chatMentionSuggestions.length]);

  const insertChatMention = (
    user: MentionUser,
    range = chatMentionRangeRef.current,
  ) => {
    if (!range) return;

    setChatMentionChips((current) => {
      if (current.some((chip) => chip.id === user.id)) return current;
      return [...current, user];
    });

    const editor = chatEditorElement();
    if (editor) {
      deleteTextRange(editor, range.start, range.end);
      setChatHtml(editor.innerHTML);
      setChatPlainText(getPlainText(editor));
      setChatCaretPosition(getCaretOffset(editor));
    }

    chatMentionRangeRef.current = null;
    editor?.focus();
  };

  const removeChatMentionChip = (userId: number) => {
    setChatMentionChips((current) => current.filter((chip) => chip.id !== userId));
  };

  const handleChatComposerKeyDown = (event: React.KeyboardEvent) => {
    if (
      !chatMentionDismissed &&
      chatMentionSuggestions.length > 0 &&
      chatMentionRangeRef.current
    ) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setChatMentionIndex((prev) => (prev + 1) % chatMentionSuggestions.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setChatMentionIndex(
          (prev) => (prev - 1 + chatMentionSuggestions.length) % chatMentionSuggestions.length,
        );
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        insertChatMention(chatMentionSuggestions[chatMentionIndex]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        chatMentionRangeRef.current = null;
        setChatMentionDismissed(true);
        return;
      }
    }
  };

  const sendChatDraft = () => {
    // Keep staged (negative) media tokens so submitCreateTask can remap them
    // to real attachment IDs after upload.
    const message = buildRichCommentMessage(chatMentionChips, chatHtml, chatMedia, {
      keepPendingMedia: true,
    });
    if (!message.trim()) return;
    update({
      chatDrafts: [
        ...formData.chatDrafts,
        { message, at: new Date().toISOString() },
      ],
    });
    setChatHtml("");
    setChatMedia([]);
    setChatMentionChips([]);
    setChatPlainText("");
    setChatCaretPosition(0);
    setChatEditorKey((key) => key + 1);
  };

  const hasTaskName = formData.title.trim().length > 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasTaskName) {
      titleRef.current?.focus();
      return;
    }
    onSubmit();
  };

  const chatMemberCount =
    1 +
    (formData.assigneeId && formData.assigneeId !== formData.ownerId ? 1 : 0) +
    formData.participantIds.length;

  const pickerUsers = useMemo(() => {
    if (!currentUser) return users;
    if (users.some((user) => user.id === currentUser.id)) return users;
    return [currentUser, ...users];
  }, [users, currentUser]);
  const knownUsers = currentUser ? [currentUser] : [];

  const assignableUsers = useMemo(() => {
    const list = users.filter(isTaskAssignableUser);
    if (
      currentUser &&
      isTaskAssignableUser(currentUser) &&
      !list.some((user) => user.id === currentUser.id)
    ) {
      return [currentUser, ...list];
    }
    return list;
  }, [users, currentUser]);

  // Assignees may also be participants (self-include on create).
  const availableParticipants = assignableUsers;
  const availableObservers = assignableUsers.filter(
    (u) => u.id !== formData.assigneeId && !formData.participantIds.includes(u.id),
  );

  return (
    <form onSubmit={handleSubmit} className="flex h-full min-h-0 flex-col">
      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col",
          !hideTaskChat && "lg:flex-row",
        )}
      >
        {/* Left — task form (matches TaskDetailPanel layout) */}
        <div
          className={cn(
            "flex min-h-0 w-full flex-col bg-white",
            hideTaskChat
              ? "flex-1"
              : "border-r border-gray-200 lg:w-[44%]",
          )}
        >
          <div
            className={cn(
              "flex-1 space-y-4 overflow-y-auto overscroll-contain p-6",
              hideTaskChat && "pt-14",
            )}
          >
            {/* Title */}
            <section>
              <div className="flex items-start justify-between gap-3 mb-3">
                <input ref={titleRef} type="text" value={formData.title} onChange={(e) => update({ title: e.target.value })} placeholder="Task name" className="flex-1 text-xl font-semibold text-[#1F2937] placeholder:text-gray-300 border-0 outline-none bg-transparent leading-tight"/>
                <div className="flex items-center gap-0.5 shrink-0">
                  <button type="button" onClick={() => update({ priority: isHot ? "medium" : "urgent" })}
                    className={cn(
                      "w-9 h-9 flex items-center justify-center rounded-lg transition-colors",
                      isHot
                        ? "hover:bg-orange-100"
                        : "text-gray-500 hover:bg-gray-100 hover:text-orange-400",
                    )} aria-label="Toggle urgent priority">
                    <Flame size={18} />
                  </button>
                </div>
              </div>

              {/* Description card */}
              <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
                <RichTextCommentEditor
                  initialHtml={formData.descriptionHtml}
                  initialMedia={formData.descriptionMedia}
                  onChange={(html, media) =>
                    update((prev) => {
                      const mediaIds = new Set(media.map((item) => item.id));
                      const pendingAttachments = prev.pendingAttachments.filter((file) => {
                        const keep =
                          file.stagingMediaId == null || mediaIds.has(file.stagingMediaId);
                        if (!keep && file.previewUrl) URL.revokeObjectURL(file.previewUrl);
                        return keep;
                      });

                      return {
                        descriptionHtml: html,
                        descriptionMedia: media,
                        description: html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
                        pendingAttachments,
                      };
                    })
                  }
                  onUploadMedia={stageMediaUpload}
                  resolveMediaPreviewUrl={resolveMediaPreviewUrl}
                  placeholder="Add a description..."
                />
                <div className="px-4 py-2.5 border-t border-gray-100 flex flex-wrap items-center gap-1">
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    className="sr-only"
                    onChange={(e) => {
                      void handleAttachFiles(e.target.files);
                      e.target.value = "";
                    }}
                  />
                  <ToolbarBtn icon={Paperclip} label="Attach files" onClick={() => fileInputRef.current?.click()} />
                  <span className="w-px h-5 bg-gray-200 mx-1" />
                </div>
              </div>
            </section>

            <TaskFilesSection
              pendingFiles={formData.pendingAttachments}
              onPendingFilesChange={(pendingAttachments) => {
                update((prev) => {
                  for (const file of prev.pendingAttachments) {
                    if (
                      !pendingAttachments.some((next) => next.clientId === file.clientId) &&
                      file.previewUrl
                    ) {
                      URL.revokeObjectURL(file.previewUrl);
                    }
                  }
                  const removedStagingIds = new Set(
                    prev.pendingAttachments
                      .filter(
                        (file) =>
                          !pendingAttachments.some((next) => next.clientId === file.clientId),
                      )
                      .map((file) => file.stagingMediaId)
                      .filter((id): id is number => id != null),
                  );

                  return {
                    pendingAttachments,
                    descriptionMedia:
                      removedStagingIds.size > 0
                        ? prev.descriptionMedia.filter((media) => !removedStagingIds.has(media.id))
                        : prev.descriptionMedia,
                  };
                });
              }}
            />

            <TaskSectionCard title="Task details">
              <div className="px-4 py-1 text-sm">
                <TaskMetaRow label="Task owner" icon={User}>
                  <UserSearchSelect
                    mode="single"
                    users={pickerUsers}
                    knownUsers={knownUsers}
                    value={formData.ownerId}
                    onValueChange={(ownerId) => {
                      if (lockOwner) return;
                      update({ ownerId: ownerId });
                    }}
                    placeholder="Select owner…"
                    searchPlaceholder="Search employees…"
                    triggerClassName="h-9 max-w-[240px] border-gray-200"
                    disabled={lockOwner}
                  />
                </TaskMetaRow>

                <TaskMetaRow label="Assignees" icon={Users}>
                  <UserSearchSelect
                    users={assignableUsers}
                    knownUsers={knownUsers}
                    mode="single"
                    value={formData.assigneeId}
                    onValueChange={(assigneeId) =>
                      update({
                        assigneeId,
                        // Keep participants; only drop observer role for the new assignee.
                        observerIds: formData.observerIds.filter((id) => id !== assigneeId),
                      })
                    }
                    placeholder="Unassigned"
                    searchPlaceholder="Search employees…"
                    triggerClassName="h-9 max-w-[240px] border-gray-200"
                    allowClear
                  />
                </TaskMetaRow>

                {showDueDate ? (
                <TaskMetaRow label="Deadline" icon={Clock}>
                  <input
                    type="datetime-local"
                    value={toDateTimeLocalValue(formData.dueDate)}
                    onChange={(e) =>
                      update({
                        dueDate: e.target.value ? new Date(e.target.value).toISOString() : "",
                      })
                    }
                    className={META_DATETIME_CLASS}
                  />
                </TaskMetaRow>
                ) : null}

                {showTimeTracking ? (
                <>
                <TaskMetaRow label="Time Tracking" icon={Clock}>
                  <button
                    type="button"
                    onClick={() => setShowTimePlanning((v) => !v)}
                    className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-[#2563EB] transition-colors"
                  >
                    <Clock size={14} className="text-gray-400" />
                    <span className="font-mono tabular-nums">
                      {formatEstimatedDuration(formData.estimatedHours) ?? "00:00:00"}
                    </span>
                    {formData.estimatedHours ? (
                      <span className="text-gray-400">estimate</span>
                    ) : null}
                    <ChevronDown size={14} className={cn("text-gray-400 transition-transform", showTimePlanning && "rotate-180")} />
                  </button>
                </TaskMetaRow>

                {showTimePlanning && (
                  <div className="pl-[calc(16px+0.75rem+6.75rem)] -mt-1 pb-2 space-y-2">
                    <p className="text-xs text-gray-500">
                      Enter the best estimate of the time you expect the task will take.
                    </p>
                    <div className="grid grid-cols-2 gap-3 max-w-[240px]">
                      <label className="block space-y-1">
                        <span className="text-xs font-medium text-gray-600">Hours:</span>
                        <input
                          type="number"
                          min={0}
                          step={1}
                          value={estimateHours}
                          onChange={(e) => {
                            const nextHours = e.target.value.replace(/[^\d]/g, "");
                            setEstimateHours(nextHours);
                            const value = estimatedHoursFromParts(nextHours, estimateMinutes);
                            update({ estimatedHours: value != null ? String(value) : "" });
                          }}
                          placeholder="0"
                          className="h-9 w-full rounded-lg border border-gray-200 px-3 text-sm tabular-nums"
                        />
                      </label>
                      <label className="block space-y-1">
                        <span className="text-xs font-medium text-gray-600">Minutes:</span>
                        <input
                          type="number"
                          min={0}
                          max={59}
                          step={1}
                          value={estimateMinutes}
                          onChange={(e) => {
                            const raw = e.target.value.replace(/[^\d]/g, "");
                            const nextMinutes = raw === "" ? "" : String(Math.min(59, parseInt(raw, 10) || 0));
                            setEstimateMinutes(nextMinutes);
                            const value = estimatedHoursFromParts(estimateHours, nextMinutes);
                            update({ estimatedHours: value != null ? String(value) : "" });
                          }}
                          placeholder="0"
                          className="h-9 w-full rounded-lg border border-gray-200 px-3 text-sm tabular-nums"
                        />
                      </label>
                    </div>
                  </div>
                )}
                </>
                ) : null}

                <TaskMetaRow label="Status" icon={Play}>
                  <select
                    value={formData.stage || "new"}
                    onChange={(e) =>
                      update({ stage: e.target.value as ProjectPipelineStageKey })
                    }
                    className={cn(
                      META_SELECT_CLASS,
                      "rounded-full border-blue-100 bg-blue-50 text-[#2563EB] font-medium",
                    )}
                  >
                    {pipelineStages.map((stage) => (
                      <option key={stage.key} value={stage.key}>{stage.label}</option>
                    ))}
                  </select>
                </TaskMetaRow>
              </div>
            </TaskSectionCard>

            <TaskSectionCard>
              <div className="px-4 py-1 text-sm">
                <TaskMetaRow label="Project" icon={Folder}>
                  <ProjectSearchSelect
                    projects={projects}
                    value={formData.projectId}
                    allowClear
                    placeholder="No project"
                    searchPlaceholder="Search projects…"
                    onValueChange={(projectId) => update({ projectId })}
                  />
                </TaskMetaRow>

                <TaskMetaRow label="Priority" icon={Flag}>
                  <PriorityMetaSelect
                    value={formData.priority}
                    onChange={(priority) => update({ priority })}
                  />
                </TaskMetaRow>
              </div>
            </TaskSectionCard>

            {/* Participants & observers — searchable multi-select */}
            <TaskSectionCard className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Participants</span>
              </div>
              <UserSearchSelect
                users={availableParticipants}
                mode="multi"
                selected={formData.participantIds}
                onToggle={(id) => toggleUserInList("participantIds", id)}
                placeholder="Select participants…"
                searchPlaceholder="Search employees…"
              />

              <div className="mt-5 pt-5 border-t border-gray-100">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Observers</span>
                </div>
                <p className="text-xs text-gray-400 mb-2">
                  Observers receive updates without being assigned.
                </p>
                <UserSearchSelect
                  users={availableObservers}
                  mode="multi"
                  selected={formData.observerIds}
                  onToggle={(id) => toggleUserInList("observerIds", id)}
                  placeholder="Select observers…"
                  searchPlaceholder="Search employees…"
                />
              </div>
            </TaskSectionCard>
          </div>

          {/* Footer */}
          <div className="shrink-0 border-t border-gray-200 px-6 py-4 flex items-center justify-between bg-white">
            <div className="flex items-center gap-4">
              <button
                type="submit"
                disabled={!hasTaskName || isSubmitting}
                title={hasTaskName ? undefined : "Enter a task name to create"}
                className="h-10 px-6 bg-[#2563EB] hover:bg-[#1D4ED8] text-white rounded-xl text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-[#2563EB] flex items-center gap-2"
              >
                {isSubmitting && <Loader2 size={14} className="animate-spin" />}
                Create
              </button>
              <button
                type="button"
                onClick={onCancel}
                className="text-sm font-medium text-gray-600 hover:text-gray-900"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>

        {/* Right — task chat (hidden on mobile / full-screen create) */}
        {!hideTaskChat ? (
        <div className="hidden min-h-0 flex-1 flex-col bg-[#E8F0FE] lg:flex">
          <div className="px-5 py-3 bg-white/80 border-b border-gray-200 shrink-0">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold text-[#1F2937]">Task Chat</h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  {chatMemberCount} member{chatMemberCount !== 1 ? "s" : ""}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button type="button" className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-500 hover:bg-white/80 dark:hover:bg-[#2a3f63]">
                  <Search size={16} />
                </button>
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {formData.chatDrafts.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full py-8">
                <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-white/80 p-6 text-center">
                  <h4 className="font-semibold text-[#1F2937] mb-4">Task Chat</h4>
                  <ul className="text-sm text-gray-600 space-y-2 text-left max-w-xs mx-auto">
                    <li>• Task chat members</li>
                    <li>• Share documents and files</li>
                    <li>• Discuss progress and results</li>
                    <li>• Track task updates</li>
                  </ul>
                </div>
                <span className="mt-6 text-xs text-gray-400 bg-white/60 px-3 py-1 rounded-full">Today</span>
              </div>
            ) : (
              formData.chatDrafts.map((draft, i) => (
                <div
                  key={`${draft.at}-${i}`}
                  className="rounded-xl px-4 py-3 text-sm max-w-[90%] bg-white border border-gray-200 text-gray-800 ml-auto"
                >
                  <p className="font-semibold text-xs text-gray-500 mb-1">{currentUser?.name ?? "You"}</p>
                  <p>{draft.message}</p>
                  <p className="text-[10px] text-gray-400 mt-1">Draft · sends on create</p>
                </div>
              ))
            )}
          </div>

          <div
            className="shrink-0 bg-white/90 border-t border-gray-200/80 p-3 dark:bg-[#0b1220] relative"
            onKeyDown={handleChatComposerKeyDown}
          >
            <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-visible relative">
              {chatMentionSuggestions.length > 0 && !chatMentionDismissed ? (
                <div className="absolute left-0 right-0 bottom-full mb-2 rounded-xl border border-gray-200 bg-white shadow-lg overflow-hidden z-30 max-h-56 overflow-y-auto">
                  {chatMentionSuggestions.map((user, index) => (
                    <button
                      key={user.id}
                      type="button"
                      onMouseDown={(event) => {
                        event.preventDefault();
                        insertChatMention(user);
                      }}
                      className={cn(
                        "w-full flex items-center gap-3 px-3 py-2 text-left text-sm hover:bg-gray-50",
                        index === chatMentionIndex && "bg-blue-50",
                      )}
                    >
                      <UserAvatar name={user.name} avatar={user.avatar} size={28} />
                      <span className="font-medium text-gray-800">{user.name}</span>
                    </button>
                  ))}
                </div>
              ) : null}

              {chatMentionChips.length > 0 ? (
                <div className="flex flex-wrap gap-2 px-3 pt-3">
                  {chatMentionChips.map((user) => (
                    <span
                      key={user.id}
                      className="inline-flex items-center gap-1.5 rounded-md bg-blue-50 px-2 py-1 text-sm font-medium text-[#2563EB] underline underline-offset-2"
                    >
                      {user.name}
                      <button
                        type="button"
                        onClick={() => removeChatMentionChip(user.id)}
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
                ref={chatEditorHostRef}
                onKeyUp={syncChatCaret}
                onClick={syncChatCaret}
              >
                <RichTextCommentEditor
                  key={chatEditorKey}
                  initialHtml={chatEditorKey === 0 ? chatHtml : ""}
                  initialMedia={chatEditorKey === 0 ? chatMedia : []}
                  onChange={(html, media) => {
                    setChatHtml(html);
                    setChatMedia(media);
                    syncChatCaret();
                  }}
                  onUploadMedia={chatMediaUpload}
                  resolveMediaPreviewUrl={resolveMediaPreviewUrl}
                  placeholder="Type @ to mention someone..."
                />
              </div>
              <div className="flex items-center justify-end gap-2 px-3 py-2 border-t border-gray-100">
                <button
                  type="button"
                  onClick={sendChatDraft}
                  disabled={
                    !chatHtml.trim() &&
                    chatMedia.length === 0 &&
                    chatMentionChips.length === 0
                  }
                  className="h-9 px-4 flex items-center justify-center gap-2 rounded-lg bg-[#2563EB] text-white hover:bg-[#1D4ED8] disabled:opacity-40 text-sm font-medium"
                >
                  <Send size={16} />
                  Add to chat
                </button>
              </div>
            </div>
          </div>
        </div>
        ) : null}
      </div>
    </form>
  );
}

const TOOLBAR_BTN_CLASS =
  "w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600";

function ToolbarBtn({
  icon: Icon,
  label,
  onClick,
}: {
  icon: React.ComponentType<{ size?: number }>;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className={TOOLBAR_BTN_CLASS} aria-label={label} title={label}>
      <Icon size={16} />
    </button>
  );
}

function toDateTimeLocalValue(value?: string | Date | null) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
