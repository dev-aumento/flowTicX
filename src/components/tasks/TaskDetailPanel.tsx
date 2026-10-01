import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { useSidebarWidth } from "@/hooks/useSidebarWidth";
import { useBodyScrollLock } from "@/hooks/useBodyScrollLock";
import { useTaskStatusLabels } from "@/hooks/useTaskStatusLabels";
import { useOrgPipelineLabelOverrides, useOrgPipelineStages } from "@/hooks/useOrgPipelineStages";
import { UserAvatar } from "@/components/shared/UserAvatar";
import {
  PriorityMetaSelect,
  isTaskPriority,
} from "@/components/tasks/task-form-ui";
import { formatTimeAgo, formatElapsedHMS, cn, priorityConfig } from "@/lib/utils";
import type { TaskTimerSource } from "@/components/tasks/TaskTrackedTimeDisplay";
import { formatDueLabel, formatOverdueLabel, isTaskOverdue } from "@/lib/task-deadline";
import {
  formatWorkZoneDate,
  formatWorkZoneDateTime,
  workZoneDateKey,
  workZoneDateParts,
  workZoneWallTimeToUtc,
} from "@/lib/timezone";
import { invalidateProjectStats } from "@/lib/project-stats";
import { invalidateTaskQueries } from "@/lib/invalidate-on-notifications";
import { applyOptimisticTaskUpdate, patchTaskByIdCache } from "@/lib/task-cache";
import { refreshDashboardStats } from "@/lib/dashboard-refresh";
import { buildAbsoluteTaskViewUrl } from "@/lib/task-notification-link";
import { hasPermission } from "@/lib/permissions";
import { isClientPortalUser } from "@/lib/client-portal";
import { clientCanViewDueDate, clientCanViewTimeTracking } from "@/lib/client-visibility";
import { canChangeTaskAssignee } from "@/lib/change-assignee-permission";
import { isTaskAssignableUser } from "@/lib/leave-policy";
import { isViewerDisplayName, youOrDisplayName } from "@/lib/viewer-second-person";
import {
  isTaskFavorite,
  readTaskPref,
  setTaskFavorite,
  TASK_PREFS_CHANGED_EVENT,
  writeTaskPref,
} from "@/lib/task-prefs";
import { assertAttachmentFileSize, getDisplayDescription, readFileAsBase64, resolveFileMimeType } from "@/lib/task-files";
import { createAttachmentPreviewResolver } from "@/lib/attachment-preview";
import {
  buildRichCommentMessage,
  parseStoredCommentMessage,
  richCommentPlainText,
  type CommentMediaRef,
} from "@/lib/rich-comment";
import { filterMentionableUsers } from "@/lib/task-comment-mentions";
import {
  RichTextCommentEditor,
  type RichTextCommentEditorHandle,
} from "@/components/tasks/RichTextCommentEditor";
import { CommentRichContent } from "@/components/tasks/CommentRichContent";
import { TaskFilesSection } from "@/components/tasks/TaskFilesSection";
import { TaskChecklistSection } from "@/components/tasks/TaskChecklistSection";
import { TaskCommentBubble } from "@/components/tasks/TaskCommentBubble";
import { TaskActivityBubble } from "@/components/tasks/TaskActivityBubble";
import { TaskCommentComposer } from "@/components/tasks/TaskCommentComposer";
import { TaskTimeLoggedSection } from "@/components/tasks/TaskTimeLoggedSection";
import { TaskTimeEstimatePopover } from "@/components/tasks/TaskTimeEstimatePopover";
import { UserSearchSelect } from "@/components/tasks/UserSearchSelect";
import { ProjectSearchSelect } from "@/components/tasks/ProjectSearchSelect";
import {
  LiveEstimateLabel,
  LiveSessionElapsed,
  TaskTrackedTimeDisplay,
} from "@/components/tasks/TaskTrackedTimeDisplay";
import {
  formatEstimatedDuration,
  isTrackedOverEstimate,
} from "@/lib/task-time-estimate";
import {
  resolveWorkflowState,
  workflowStateToDb,
  type WorkflowState,
} from "@/lib/task-workflow";
import type { DbTaskStatus } from "@/lib/task-workflow";
import { applyPipelineStageLabelOverrides, kanbanStageColor, kanbanStageLabel, mergePipelineStageSources, taskPipelineStage, type PipelineStageDef, type ProjectPipelineStageKey } from "@/lib/task-kanban";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  X, Clock, Play, Pause,
  Loader2, Plus, Minus, Link2, ExternalLink,
  Trash2, Pencil,
  Flame, UserPlus, Search, PanelRightClose, PanelRightOpen, MoreHorizontal,
  VolumeX, Star, Calendar, Folder, User, Users, Copy, Flag, Hourglass,
  ChevronDown, ChevronUp, ChevronLeft,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface TaskDetailPanelProps {
  taskId: number;
  highlightActivityId?: number | null;
  onHighlightDone?: () => void;
  onClose: () => void;
  onTaskOpen?: (taskId: number) => void;
  /** Project pipeline stages (defaults + custom kanban sections). */
  pipelineStages?: PipelineStageDef[];
}

function readCustomPipelineStages(project: unknown) {
  if (!project || typeof project !== "object") return null;
  const custom = (project as { customPipelineStages?: PipelineStageDef[] | null })
    .customPipelineStages;
  return Array.isArray(custom) ? custom : null;
}

function readPipelineStagesField(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const stages = (value as { pipelineStages?: PipelineStageDef[] | null }).pipelineStages;
  return Array.isArray(stages) ? stages : null;
}

function toDateTimeLocalValue(value?: string | Date | null) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const META_SELECT_CHEVRON =
  "bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg xmlns%3D%22http://www.w3.org/2000/svg%22 width%3D%2216%22 height%3D%2216%22 viewBox%3D%220 0 24 24%22 fill%3D%22none%22 stroke%3D%22%239CA3AF%22 stroke-width%3D%222%22 stroke-linecap%3D%22round%22 stroke-linejoin%3D%22round%22%3E%3Cpath d%3D%22m6 9 6 6 6-6%22/%3E%3C/svg%3E')]";

const META_SELECT_CLASS = cn(
  "h-9 w-full max-w-[240px] rounded-lg border border-gray-200 bg-white px-3 pr-9",
  "text-sm text-gray-800 appearance-none bg-no-repeat bg-[length:16px] bg-[right_0.7rem_center]",
  META_SELECT_CHEVRON,
);

const META_DATETIME_CLASS = cn(
  "h-9 w-full max-w-[240px] rounded-lg border border-gray-200 bg-white px-3",
  "text-sm text-gray-800 [color-scheme:light] dark:[color-scheme:dark]",
  "[&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:cursor-pointer",
  "[&::-webkit-datetime-edit]:leading-9 [&::-webkit-datetime-edit-fields-wrapper]:p-0",
);

/** Collapsed task description height before Expand is offered. */
const DESCRIPTION_COLLAPSED_MAX_HEIGHT = 220;

function formatTaskDateTime(value?: string | Date | null) {
  return formatWorkZoneDateTime(value, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function activityDayKey(value: Date | string) {
  return workZoneDateKey(value);
}

function formatChatDateLabel(value: Date | string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";

  const valueKey = workZoneDateKey(d);
  const todayKey = workZoneDateKey(new Date());
  if (valueKey === todayKey) return "Today";

  const { year, month, day } = workZoneDateParts(new Date());
  const yesterdayKey = workZoneDateKey(workZoneWallTimeToUtc(year, month, day - 1, 12));
  if (valueKey === yesterdayKey) return "Yesterday";

  return formatWorkZoneDate(d, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export function TaskDetailPanel({
  taskId,
  highlightActivityId = null,
  onHighlightDone,
  onClose,
  onTaskOpen,
  pipelineStages: pipelineStagesProp,
}: TaskDetailPanelProps) {
  const [isPresent, setIsPresent] = useState(true);
  const requestClose = useCallback(() => setIsPresent(false), []);
  const sidebarWidth = useSidebarWidth();
  const panelLeft = sidebarWidth;
  const panelWidth = `calc(100vw - ${sidebarWidth}px)`;
  const utils = trpc.useUtils();
  const { user } = useAuth();
  const showTimeTracking = clientCanViewTimeTracking(user);
  const { data: task, isLoading } = trpc.task.getById.useQuery(
    { id: taskId },
  );
  const { data: timeData } = trpc.task.getTimeTracked.useQuery(
    { taskId },
    { enabled: showTimeTracking },
  );
  // Local wall-clock drives the display; only poll occasionally to resync from the server.
  const { data: activeTimer } = trpc.task.getActiveTimer.useQuery(
    { taskId },
    {
      enabled: showTimeTracking,
      refetchInterval: (q) =>
        q.state.data?.startedAt && !q.state.data?.paused ? 30_000 : false,
      refetchOnWindowFocus: true,
    },
  );
  const { data: usersData } = trpc.user.listForPicker.useQuery({ limit: 500 });
  const { data: projectsData } = trpc.project.listForPicker.useQuery();

  /** Instant click-time timer so UI does not wait on the network. */
  const [optimisticTimer, setOptimisticTimer] = useState<{
    taskId: number;
    startedAt: Date;
    paused: boolean;
    accumulatedSeconds: number;
  } | null>(null);

  useEffect(() => {
    setOptimisticTimer(null);
  }, [taskId]);

  useEffect(() => {
    if (!optimisticTimer || optimisticTimer.taskId !== taskId) return;
    if (activeTimer?.startedAt && !activeTimer.paused) {
      setOptimisticTimer(null);
    }
  }, [activeTimer, optimisticTimer, taskId]);

  const timerSource = useMemo(() => {
    if (optimisticTimer && optimisticTimer.taskId === taskId) {
      if (activeTimer?.startedAt && !activeTimer.paused) {
        const serverMs = new Date(activeTimer.startedAt).getTime();
        const localMs = optimisticTimer.startedAt.getTime();
        // Prefer the earlier start so slow API responses do not erase click-time seconds.
        return {
          ...activeTimer,
          startedAt: new Date(Math.min(serverMs, localMs)),
          paused: false,
          accumulatedSeconds: 0,
        } satisfies TaskTimerSource;
      }
      return optimisticTimer satisfies TaskTimerSource;
    }
    return (activeTimer ?? null) as TaskTimerSource | null;
  }, [optimisticTimer, activeTimer, taskId]);

  // Derive session flags from the snapshot — do NOT tick elapsed here.
  // Live seconds are owned by TaskTrackedTimeDisplay / LiveSessionElapsed so the
  // panel (title, comments) does not re-render every second and wipe text selection.
  const isTimerRunning = Boolean(timerSource?.startedAt && !timerSource.paused);
  const isTimerPaused = Boolean(timerSource?.startedAt && timerSource.paused);
  const hasActiveSession = timerSource?.startedAt != null;
  const completedSeconds = timeData?.totalSeconds ?? 0;

  useEffect(() => {
    if (!isPresent) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [isPresent, requestClose]);

  useBodyScrollLock(isPresent);

  useEffect(() => {
    setIsPresent(true);
  }, [taskId]);

  const panel = (
    <AnimatePresence onExitComplete={onClose}>
      {isPresent ? (
        <>
          <motion.div
            key="task-detail-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[125] bg-black/35"
            onClick={requestClose}
            aria-hidden
          />
          <motion.aside
            key="task-detail-panel"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 32, stiffness: 320 }}
            style={{ left: panelLeft, width: panelWidth }}
            className="fixed top-0 bottom-0 z-[130] bg-[#EEF0F3] flex min-h-0 h-[100dvh] overflow-visible shadow-[4px_0_24px_rgba(15,23,42,0.08)] border-l border-gray-200"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            {isLoading && !task ? (
              <div className="flex-1 flex items-center justify-center bg-white">
                <Loader2 size={32} className="animate-spin text-gray-400" />
              </div>
            ) : !task ? (
              <div className="flex-1 flex items-center justify-center bg-white text-sm text-gray-500">
                Task not found
              </div>
            ) : (
              <TaskPanelContent
                key={taskId}
                task={task}
                taskId={taskId}
                highlightActivityId={highlightActivityId}
                onHighlightDone={onHighlightDone}
                onClose={requestClose}
                onTaskOpen={onTaskOpen}
                pipelineStagesProp={pipelineStagesProp}
                usersData={usersData?.users ?? []}
                projectsData={projectsData ?? []}
                timeData={timeData}
                timerSource={timerSource}
                completedSeconds={completedSeconds}
                isTimerRunning={isTimerRunning}
                isTimerPaused={isTimerPaused}
                hasActiveSession={hasActiveSession}
                onOptimisticTimerStart={(startedAt) => {
                  setOptimisticTimer({
                    taskId,
                    startedAt,
                    paused: false,
                    accumulatedSeconds: 0,
                  });
                }}
                onOptimisticTimerClear={() => setOptimisticTimer(null)}
              />
            )}
          </motion.aside>
        </>
      ) : null}
    </AnimatePresence>
  );

  return createPortal(panel, document.body);
}

function TaskPanelContent({
  task,
  taskId,
  highlightActivityId,
  onHighlightDone,
  onClose,
  onTaskOpen,
  pipelineStagesProp,
  usersData,
  projectsData,
  timeData,
  timerSource,
  completedSeconds,
  isTimerRunning,
  isTimerPaused,
  hasActiveSession,
  onOptimisticTimerStart,
  onOptimisticTimerClear,
}: {
  task: NonNullable<ReturnType<typeof trpc.task.getById.useQuery>["data"]>;
  taskId: number;
  highlightActivityId?: number | null;
  onHighlightDone?: () => void;
  onClose: () => void;
  onTaskOpen?: (taskId: number) => void;
  pipelineStagesProp?: PipelineStageDef[];
  usersData: Array<{
    id: number;
    name: string | null;
    avatar?: string | null;
    role?: string | null;
    department?: string | null;
  }>;
  projectsData: Array<{ id: number; name: string; color?: string | null }>;
  timeData: ReturnType<typeof trpc.task.getTimeTracked.useQuery>["data"];
  timerSource: TaskTimerSource | null;
  completedSeconds: number;
  isTimerRunning: boolean;
  isTimerPaused: boolean;
  hasActiveSession: boolean;
  onOptimisticTimerStart: (startedAt: Date) => void;
  onOptimisticTimerClear: () => void;
}) {
  const { user } = useAuth();
  const statusLabels = useTaskStatusLabels();
  const orgStages = useOrgPipelineStages();
  const orgLabelOverrides = useOrgPipelineLabelOverrides();
  const utils = trpc.useUtils();
  const participantsRef = useRef<HTMLDivElement>(null);
  const chatFeedRef = useRef<HTMLDivElement>(null);
  const descriptionEditorRef = useRef<RichTextCommentEditorHandle>(null);

  const projectId =
    typeof task.projectId === "number" && task.projectId > 0
      ? task.projectId
      : typeof (task.project as { id?: number } | null)?.id === "number"
        ? (task.project as { id: number }).id
        : null;

  const taskHasPipelineStages = Boolean(readPipelineStagesField(task)?.length);
  const { data: taskProject } = trpc.project.getById.useQuery(
    { id: projectId! },
    {
      enabled:
        projectId != null &&
        projectId > 0 &&
        !pipelineStagesProp?.length &&
        !taskHasPipelineStages,
    },
  );

  const pipelineStages = useMemo(() => {
    if (pipelineStagesProp && pipelineStagesProp.length > 0) {
      return pipelineStagesProp;
    }
    const fromTask = readPipelineStagesField(task);
    if (fromTask && fromTask.length > 0) return fromTask;
    const fromProject = readPipelineStagesField(taskProject);
    if (fromProject && fromProject.length > 0) return fromProject;
    const merged = mergePipelineStageSources(
      readCustomPipelineStages(taskProject),
      readCustomPipelineStages(task.project),
    );
    if (merged.length > 0) {
      return applyPipelineStageLabelOverrides(merged, orgLabelOverrides);
    }
    return orgStages;
  }, [pipelineStagesProp, task, taskProject, orgLabelOverrides, orgStages]);

  const [description, setDescription] = useState(task.description || "");
  const [descriptionHtml, setDescriptionHtml] = useState("");
  const [descriptionMedia, setDescriptionMedia] = useState<CommentMediaRef[]>([]);
  const [editingDescription, setEditingDescription] = useState(false);
  const [titleDraft, setTitleDraft] = useState(task.title);
  const [editingTitle, setEditingTitle] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [idCopied, setIdCopied] = useState(false);
  const linkCopiedTimerRef = useRef<number | null>(null);
  const copyLinkBtnRef = useRef<HTMLButtonElement>(null);
  const [linkCopiedTipPos, setLinkCopiedTipPos] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const [descriptionOverflows, setDescriptionOverflows] = useState(false);
  const descriptionContentRef = useRef<HTMLDivElement>(null);
  const [timeDetailsExpanded, setTimeDetailsExpanded] = useState(false);
  const [taskDetailsExpanded, setTaskDetailsExpanded] = useState(false);
  const [participantsExpanded, setParticipantsExpanded] = useState(false);
  const [observersExpanded, setObserversExpanded] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showSwitchTimerConfirm, setShowSwitchTimerConfirm] = useState(false);
  // Desktop/laptop (lg+): chat open by default. Mobile/tablet: closed until toggled.
  // Desktop: open by default. Mobile: closed by default (task details only).
  const [showChatPanel, setShowChatPanel] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(min-width: 1024px)").matches;
  });
  const [showChatSearch, setShowChatSearch] = useState(false);
  const [chatSearch, setChatSearch] = useState("");
  const [chatFeedMode, setChatFeedMode] = useState<"comments" | "all">("comments");
  const [commentWindowSize, setCommentWindowSize] = useState(4);
  const skipChatAutoScrollRef = useRef(false);
  const [isMuted, setIsMuted] = useState(() => readTaskPref(taskId, "muted", false));
  const [isFavorite, setIsFavorite] = useState(() => isTaskFavorite(taskId));
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
  const [showDelegateDialog, setShowDelegateDialog] = useState(false);
  const [delegateUserId, setDelegateUserId] = useState<number | "">("");
  const [isDeferred, setIsDeferred] = useState(() => readTaskPref(taskId, "deferred", false));
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [highlightedActivityId, setHighlightedActivityId] = useState<number | null>(null);

  useEffect(() => {
    setIsDeferred(readTaskPref(taskId, "deferred", false));
  }, [taskId]);

  useEffect(() => {
    const onPrefs = (e: Event) => {
      const detail = (e as CustomEvent<{ taskId: number; key: string }>).detail;
      if (detail?.taskId === taskId && detail.key === "deferred") {
        setIsDeferred(readTaskPref(taskId, "deferred", false));
      }
    };
    window.addEventListener(TASK_PREFS_CHANGED_EVENT, onPrefs);
    return () => window.removeEventListener(TASK_PREFS_CHANGED_EVENT, onPrefs);
  }, [taskId]);

  const workflowState = resolveWorkflowState(task.status, isDeferred);

  useEffect(() => {
    setDescription(task.description || "");
    const parsed = parseStoredCommentMessage(task.description || "");
    if (parsed.isRich) {
      setDescriptionHtml(parsed.body);
      setDescriptionMedia(parsed.media);
    } else {
      setDescriptionHtml(task.description || "");
      setDescriptionMedia([]);
    }
  }, [task.description]);

  useEffect(() => {
    if (!editingTitle) setTitleDraft(task.title);
  }, [task.title, editingTitle]);

  useEffect(() => {
    if (!editingTitle) return;
    const id = window.requestAnimationFrame(() => {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(id);
  }, [editingTitle]);

  useEffect(() => {
    setIsMuted(readTaskPref(taskId, "muted", false));
    setIsFavorite(isTaskFavorite(taskId));
    setShowChatPanel(window.matchMedia("(min-width: 1024px)").matches);
  }, [taskId]);

  useEffect(() => {
    const onPrefsChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ taskId: number; key: string }>).detail;
      if (detail?.taskId !== taskId) return;
      if (detail.key === "favorite") setIsFavorite(isTaskFavorite(taskId));
      if (detail.key === "muted") setIsMuted(readTaskPref(taskId, "muted", false));
    };
    window.addEventListener(TASK_PREFS_CHANGED_EVENT, onPrefsChanged);
    return () => window.removeEventListener(TASK_PREFS_CHANGED_EVENT, onPrefsChanged);
  }, [taskId]);

  const showNotice = (message: string) => {
    setActionNotice(message);
    window.setTimeout(() => setActionNotice(null), 2500);
  };

  const updateMutation = trpc.task.update.useMutation({
    onMutate: async (input) => {
      const previousById = utils.task.getById.getData({ id: taskId });
      await applyOptimisticTaskUpdate(utils, task, input);
      if (input.createdBy !== undefined) {
        const creator =
          input.createdBy == null
            ? null
            : usersData.find((u) => u.id === input.createdBy) ??
              (task.creator?.id === input.createdBy ? task.creator : null) ??
              previousById?.creator ??
              null;
        patchTaskByIdCache(utils, taskId, { creator });
      }
      if (input.assigneeId !== undefined) {
        const assignee =
          input.assigneeId == null
            ? null
            : usersData.find((u) => u.id === input.assigneeId) ??
              (task.assignee?.id === input.assigneeId ? task.assignee : null) ??
              (task.creator?.id === input.assigneeId ? task.creator : null) ??
              previousById?.assignee ??
              null;
        patchTaskByIdCache(utils, taskId, { assignee });
      }
      return { previousById };
    },
    onError: (_error, _input, context) => {
      if (context?.previousById) {
        utils.task.getById.setData({ id: taskId }, context.previousById);
      }
      void utils.task.list.invalidate();
      void refreshDashboardStats(utils);
    },
    onSettled: async () => {
      await invalidateTaskQueries(utils, { taskIds: [taskId] });
      invalidateProjectStats(utils, task.projectId);
      setEditingDescription(false);
    },
  });

  const { data: myActiveTimer } = trpc.task.getMyActiveTimer.useQuery(undefined, {
    refetchInterval: (q) => (q.state.data?.startedAt && !q.state.data?.paused ? 5000 : false),
  });

  const invalidateTimerQueries = (otherTaskId?: number) => {
    void utils.task.getMyActiveTimer.invalidate();
    void utils.task.getTimeTracked.invalidate({ taskId });
    if (otherTaskId && otherTaskId !== taskId) {
      void utils.task.getActiveTimer.invalidate({ taskId: otherTaskId });
      void utils.task.getTimeTracked.invalidate({ taskId: otherTaskId });
      void utils.task.getById.invalidate({ id: otherTaskId });
    }
    void utils.task.getById.invalidate({ id: taskId });
  };

  const startTimerMutation = trpc.task.startTimer.useMutation({
    onMutate: async ({ clientStartedAt }) => {
      await utils.task.getActiveTimer.cancel({ taskId });
      await utils.task.getMyActiveTimer.cancel();
      const previous = utils.task.getActiveTimer.getData({ taskId });
      const previousMine = utils.task.getMyActiveTimer.getData(undefined);
      const startedAt = clientStartedAt instanceof Date ? clientStartedAt : new Date();
      const optimistic = {
        taskId,
        startedAt,
        paused: false,
        accumulatedSeconds: 0,
      };
      onOptimisticTimerStart(startedAt);
      utils.task.getActiveTimer.setData({ taskId }, optimistic);
      utils.task.getMyActiveTimer.setData(undefined, {
        ...optimistic,
        taskTitle: task.title,
      });
      return { previous, previousMine };
    },
    onError: (_error, _variables, context) => {
      onOptimisticTimerClear();
      utils.task.getActiveTimer.setData({ taskId }, context?.previous ?? null);
      utils.task.getMyActiveTimer.setData(undefined, context?.previousMine ?? null);
    },
    onSuccess: (data, variables) => {
      const startedAt = data.startedAt instanceof Date ? data.startedAt : new Date(data.startedAt);
      utils.task.getActiveTimer.setData(
        { taskId: variables.taskId },
        {
          taskId: variables.taskId,
          startedAt,
          paused: false,
          accumulatedSeconds: 0,
        },
      );
      utils.task.getMyActiveTimer.setData(undefined, {
        taskId: variables.taskId,
        taskTitle: task.title,
        startedAt,
        paused: false,
        accumulatedSeconds: 0,
      });
      // Light refresh only — avoid refetching getActiveTimer (wipes optimism / resets clock).
      void utils.task.getTimeTracked.invalidate({ taskId: variables.taskId });
      if (myActiveTimer?.taskId && myActiveTimer.taskId !== variables.taskId) {
        void utils.task.getActiveTimer.invalidate({ taskId: myActiveTimer.taskId });
        void utils.task.getTimeTracked.invalidate({ taskId: myActiveTimer.taskId });
      }
    },
  });

  const pauseTimerMutation = trpc.task.pauseTimer.useMutation({
    onMutate: async () => {
      await utils.task.getActiveTimer.cancel({ taskId });
      await utils.task.getMyActiveTimer.cancel();
      const previous = utils.task.getActiveTimer.getData({ taskId });
      const previousMine = utils.task.getMyActiveTimer.getData(undefined);
      onOptimisticTimerClear();
      // Pause closes the open entry server-side — clear the live session immediately.
      utils.task.getActiveTimer.setData({ taskId }, null);
      utils.task.getMyActiveTimer.setData(undefined, null);
      return { previous, previousMine };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous !== undefined) {
        utils.task.getActiveTimer.setData({ taskId }, context.previous);
      }
      if (context?.previousMine !== undefined) {
        utils.task.getMyActiveTimer.setData(undefined, context.previousMine);
      }
    },
    onSuccess: () => {
      invalidateTimerQueries();
    },
  });

  const stopTimerMutation = trpc.task.stopTimer.useMutation({
    onMutate: async () => {
      await utils.task.getActiveTimer.cancel({ taskId });
      await utils.task.getMyActiveTimer.cancel();
      const previous = utils.task.getActiveTimer.getData({ taskId });
      const previousMine = utils.task.getMyActiveTimer.getData(undefined);
      onOptimisticTimerClear();
      utils.task.getActiveTimer.setData({ taskId }, null);
      utils.task.getMyActiveTimer.setData(undefined, null);
      return { previous, previousMine };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous !== undefined) {
        utils.task.getActiveTimer.setData({ taskId }, context.previous);
      }
      if (context?.previousMine !== undefined) {
        utils.task.getMyActiveTimer.setData(undefined, context.previousMine);
      }
    },
    onSuccess: () => {
      invalidateTimerQueries();
    },
  });

  const deleteMutation = trpc.task.delete.useMutation({
    onSuccess: async () => {
      await invalidateTaskQueries(utils, { taskIds: [taskId] });
      invalidateProjectStats(utils, task.projectId);
      setShowDeleteConfirm(false);
      onClose();
    },
  });

  const addCommentMutation = trpc.task.addComment.useMutation({
    onSuccess: () => {
      utils.task.getById.invalidate({ id: taskId });
    },
  });

  const editCommentMutation = trpc.task.editComment.useMutation({
    onSuccess: () => utils.task.getById.invalidate({ id: taskId }),
  });

  const deleteCommentMutation = trpc.task.deleteComment.useMutation({
    onSuccess: () => utils.task.getById.invalidate({ id: taskId }),
  });

  const addAttachmentMutation = trpc.task.addAttachment.useMutation({
    onSuccess: () => {
      utils.task.getById.invalidate({ id: taskId });
      utils.task.listAttachments.invalidate({ taskId });
    },
  });

  const crmFiles = task.attachments ?? [];
  const isCrmFilesLoading = false;

  const { data: taskListData, isLoading: isTaskListLoading } = trpc.task.list.useQuery(
    { limit: 100 },
    { enabled: showChatPanel, staleTime: 60_000 },
  );

  const addParticipantMutation = trpc.task.addParticipant.useMutation({
    onSuccess: () => {
      utils.task.getById.invalidate({ id: taskId });
    },
  });

  const removeParticipantMutation = trpc.task.removeParticipant.useMutation({
    onSuccess: () => utils.task.getById.invalidate({ id: taskId }),
  });

  const addObserverMutation = trpc.task.addObserver.useMutation({
    onSuccess: () => {
      utils.task.getById.invalidate({ id: taskId });
    },
  });

  const removeObserverMutation = trpc.task.removeObserver.useMutation({
    onSuccess: () => utils.task.getById.invalidate({ id: taskId }),
  });

  const sameUserId = (a?: number | null, b?: number | null) =>
    a != null && b != null && Number(a) === Number(b);

  const isOwner = sameUserId(task.createdBy, user?.id);
  const isAssignee = sameUserId(task.assigneeId, user?.id);
  const isParticipant = (task.participants ?? []).some((p) => sameUserId(p.id, user?.id));
  const isObserver = (task.observers ?? []).some((p) => sameUserId(p.id, user?.id));
  const showDueDate = clientCanViewDueDate(user);
  const showTimeTracking = clientCanViewTimeTracking(user);
  /** Full task edits (deadline, priority, estimate, files, etc.). */
  const canManage =
    user?.role === "admin" ||
    user?.role === "manager" ||
    hasPermission(user, "tasks.edit_all") ||
    isOwner ||
    isAssignee;
  /**
   * Status / participants / observers remain editable for anyone who can open the task.
   * Assignee changes are restricted separately (see canChangeAssignee).
   */
  const canEditTeamAndStatus = Boolean(user);
  /**
   * Assignee, participants, owner, and leads can run the task timer.
   * Prefer the server flag from getById (checks task_participants directly).
   */
  const canTrackTime =
    showTimeTracking &&
    (typeof task.canTrackTime === "boolean"
      ? task.canTrackTime
      : canManage ||
        isParticipant ||
        hasPermission(user, "time.edit_all"));
  const canChangeOwner =
    !isClientPortalUser(user) &&
    String(task.creator?.role ?? "").toLowerCase() !== "client" &&
    (user?.role === "admin" ||
      user?.role === "manager" ||
      hasPermission(user, "tasks.edit_all"));
  const canChangeAssignee = canChangeTaskAssignee(user, task.assigneeId);
  const canManageParticipants = canEditTeamAndStatus;
  const canDelete =
    user?.role === "admin" ||
    user?.role === "manager" ||
    hasPermission(user, "tasks.delete") ||
    isOwner;

  const existingParticipantIds = useMemo(
    () => new Set(task.participants.map((p) => p.id)),
    [task.participants],
  );
  const existingObserverIds = useMemo(
    () => new Set((task.observers ?? []).map((p) => p.id)),
    [task.observers],
  );

  /** Assignees may also be participants (e.g. self-add); do not exclude assigneeId. */
  const participantSelectUsers = useMemo(() => {
    const map = new Map<number, { id: number; name: string | null; avatar?: string | null }>();
    for (const u of usersData) {
      if (!isTaskAssignableUser(u)) continue;
      map.set(u.id, u);
    }
    // Ensure the signed-in user can always find themselves in the picker.
    if (user?.id != null && isTaskAssignableUser(user) && !map.has(user.id)) {
      map.set(user.id, {
        id: user.id,
        name: user.name ?? null,
        avatar: user.avatar,
      });
    }
    return [...map.values()];
  }, [usersData, user]);

  const observerSelectUsers = useMemo(() => {
    const map = new Map<number, { id: number; name: string | null; avatar?: string | null }>();
    for (const candidate of usersData) {
      if (!isTaskAssignableUser(candidate)) continue;
      if (candidate.id === task.assigneeId) continue;
      if (existingParticipantIds.has(candidate.id)) continue;
      if (candidate.id === task.createdBy && !existingObserverIds.has(candidate.id)) continue;
      map.set(candidate.id, candidate);
    }
    return [...map.values()];
  }, [
    usersData,
    task.assigneeId,
    task.createdBy,
    existingParticipantIds,
    existingObserverIds,
  ]);

  /** Staff directory omits clients — include the task owner so work can be assigned back to them. */
  const assigneeSelectUsers = useMemo(() => {
    const map = new Map<number, { id: number; name: string | null; avatar?: string | null; role?: string | null }>();
    const extras: Array<{ id: number; name: string | null; avatar?: string | null; role?: string | null }> = [];
    const addExtra = (person: { id: number; name: string | null; avatar?: string | null; role?: string | null; department?: string | null } | null | undefined) => {
      if (person?.id == null || map.has(person.id) || !isTaskAssignableUser(person)) return;
      extras.push({
        id: person.id,
        name: person.name ?? null,
        avatar: person.avatar,
        role: person.role,
      });
    };
    for (const u of usersData) {
      if (!isTaskAssignableUser(u)) continue;
      map.set(u.id, u);
    }
    addExtra(task.creator);
    if (String(user?.role ?? "").toLowerCase() === "client" && user?.id != null) {
      addExtra({
        id: user.id,
        name: user.name ?? null,
        avatar: user.avatar,
        role: user.role,
        department: user.department,
      });
    }
    return [...extras, ...map.values()];
  }, [usersData, task.creator, user]);

  const assigneeKnownUsers = useMemo(() => {
    const list = [...assigneeSelectUsers];
    if (task.assignee && !list.some((u) => u.id === task.assignee?.id)) {
      list.push(task.assignee);
    }
    return list;
  }, [assigneeSelectUsers, task.assignee]);

  const ownerKnownUsers = useMemo(() => {
    const list = [...usersData];
    if (task.creator && !list.some((u) => u.id === task.creator?.id)) {
      list.push(task.creator);
    }
    return list;
  }, [usersData, task.creator]);

  const taskUrl = buildAbsoluteTaskViewUrl(taskId, task.project?.name);

  const memberIds = new Set(
    [task.assigneeId, task.createdBy, ...task.participants.map((p) => p.id)].filter(
      (id): id is number => id != null,
    ),
  );
  const memberCount = memberIds.size;

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(taskUrl);
    } catch {
      try {
        const input = document.createElement("textarea");
        input.value = taskUrl;
        input.setAttribute("readonly", "");
        input.style.position = "fixed";
        input.style.left = "-9999px";
        document.body.appendChild(input);
        input.select();
        document.execCommand("copy");
        document.body.removeChild(input);
      } catch {
        return;
      }
    }

    const rect = copyLinkBtnRef.current?.getBoundingClientRect();
    if (rect) {
      setLinkCopiedTipPos({
        top: rect.top + rect.height / 2,
        left: rect.right + 8,
      });
    } else {
      setLinkCopiedTipPos(null);
    }

    setLinkCopied(true);
    if (linkCopiedTimerRef.current != null) {
      window.clearTimeout(linkCopiedTimerRef.current);
    }
    linkCopiedTimerRef.current = window.setTimeout(() => {
      setLinkCopied(false);
      setLinkCopiedTipPos(null);
      linkCopiedTimerRef.current = null;
    }, 1500);
  };

  useEffect(() => {
    return () => {
      if (linkCopiedTimerRef.current != null) {
        window.clearTimeout(linkCopiedTimerRef.current);
      }
    };
  }, []);

  const handleCopyId = async () => {
    try {
      await navigator.clipboard.writeText(String(task.id));
      setIdCopied(true);
      window.setTimeout(() => setIdCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  const taskOverdue = task.dueDate ? isTaskOverdue(task) : false;
  const parsedDescription = parseStoredCommentMessage(task.description || "");
  const descriptionText = parsedDescription.isRich
    ? richCommentPlainText(task.description || "")
    : getDisplayDescription(task.description);
  const hasRichDescription =
    parsedDescription.isRich
    && (descriptionText.length > 0 || parsedDescription.media.length > 0);

  useEffect(() => {
    setDescriptionExpanded(false);
  }, [taskId, task.description]);

  useEffect(() => {
    if (editingDescription) {
      setDescriptionOverflows(false);
      return;
    }

    const el = descriptionContentRef.current;
    if (!el) return;

    const measure = () => {
      setDescriptionOverflows(el.scrollHeight > DESCRIPTION_COLLAPSED_MAX_HEIGHT);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [
    task.description,
    taskId,
    editingDescription,
    hasRichDescription,
    descriptionText,
  ]);

  const showCollapsedDescription =
    !descriptionExpanded && descriptionOverflows;

  const handlePopOut = () => {
    window.open(taskUrl, "_blank", "noopener,noreferrer");
  };

  const handleToggleUrgent = () => {
    const next = task.priority === "urgent" ? "medium" : "urgent";
    updateMutation.mutate({ id: taskId, priority: next });
  };

  const startEditingTitle = () => {
    if (!canManage) return;
    setTitleDraft(task.title);
    setEditingTitle(true);
  };

  const titlePointerRef = useRef<{ x: number; y: number; selecting: boolean } | null>(null);

  const handleTitlePointerDown = (event: PointerEvent) => {
    titlePointerRef.current = {
      x: event.clientX,
      y: event.clientY,
      selecting: false,
    };
  };

  const handleTitlePointerMove = (event: PointerEvent) => {
    const start = titlePointerRef.current;
    if (!start) return;
    if (Math.abs(event.clientX - start.x) > 4 || Math.abs(event.clientY - start.y) > 4) {
      start.selecting = true;
    }
  };

  const handleTitleClick = (event: MouseEvent) => {
    const start = titlePointerRef.current;
    titlePointerRef.current = null;
    // Allow selecting/copying title text without entering edit mode.
    if (start?.selecting) {
      event.preventDefault();
      return;
    }
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && selection.toString().trim()) {
      return;
    }
    startEditingTitle();
  };

  const cancelEditingTitle = () => {
    setTitleDraft(task.title);
    setEditingTitle(false);
  };

  const saveTitle = () => {
    if (!canManage || !editingTitle) return;
    const next = titleDraft.trim();
    if (!next) {
      setTitleDraft(task.title);
      setEditingTitle(false);
      return;
    }
    if (next !== task.title) {
      updateMutation.mutate({ id: taskId, title: next });
    }
    setEditingTitle(false);
  };

  const handleToggleFavorite = () => {
    const next = !isFavorite;
    setTaskFavorite(taskId, next);
    setIsFavorite(next);
    showNotice(next ? "Added to favorites" : "Removed from favorites");
  };

  const handleToggleMute = () => {
    const next = !isMuted;
    setIsMuted(next);
    writeTaskPref(taskId, "muted", next);
    showNotice(next ? "Notifications muted" : "Notifications unmuted");
  };

  const handleAddMember = () => {
    if (!canManageParticipants) return;
    setParticipantsExpanded(true);
    setShowChatPanel(true);
    window.setTimeout(() => participantsRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 100);
  };

  const toggleParticipant = (userId: number) => {
    if (existingParticipantIds.has(userId)) {
      removeParticipantMutation.mutate({ taskId, userId });
      return;
    }
    if (existingObserverIds.has(userId)) {
      removeObserverMutation.mutate({ taskId, userId });
    }
    addParticipantMutation.mutate({ taskId, userId });
  };

  const toggleObserver = (userId: number) => {
    if (existingObserverIds.has(userId)) {
      removeObserverMutation.mutate({ taskId, userId });
      return;
    }
    addObserverMutation.mutate({ taskId, userId });
  };


  const handleWorkflowChange = (next: WorkflowState) => {
    const { status, deferred } = workflowStateToDb(next);
    writeTaskPref(taskId, "deferred", deferred);
    setIsDeferred(deferred);

    if (next === "deferred") {
      const base = task.dueDate ? new Date(task.dueDate) : new Date();
      base.setDate(base.getDate() + 1);
      // Defer only bumps the deadline — keep assignee and keep timers running.
      updateMutation.mutate({
        id: taskId,
        status,
        dueDate: base.toISOString(),
      });
      showNotice("Task deferred by 1 day");
    } else if (next === "complete") {
      handleComplete();
    } else if (next === "paused" && isTimerRunning) {
      pauseTimerMutation.mutate({ taskId });
      updateMutation.mutate({ id: taskId, status });
      showNotice("Task paused");
    } else {
      updateMutation.mutate({ id: taskId, status });
      if (next === "in_progress") {
        const resuming = workflowState === "deferred" || workflowState === "paused";
        showNotice(resuming ? "Task resumed" : "Task in progress");
      } else if (next === "paused") {
        showNotice("Task paused");
      }
    }
  };

  const handleStageChange = (stage: ProjectPipelineStageKey) => {
    updateMutation.mutate({ id: taskId, stage });
    showNotice(`Moved to ${kanbanStageLabel(stage, pipelineStages)}`);
  };

  const handleResumeTask = () => {
    writeTaskPref(taskId, "deferred", false);
    setIsDeferred(false);
    // Start timer immediately — do not wait for status update round-trip.
    doStartTimer();
    updateMutation.mutate({ id: taskId, status: "in_progress" });
    showNotice("Task resumed");
  };

  const doStartTimer = () => {
    const startedAt = new Date();
    onOptimisticTimerStart(startedAt);
    // Start timer first; status update is separate so it is not batched into Start latency.
    startTimerMutation.mutate({ taskId, clientStartedAt: startedAt });
    if (workflowState === "not_started" || workflowState === "paused") {
      writeTaskPref(taskId, "deferred", false);
      setIsDeferred(false);
      updateMutation.mutate({ id: taskId, status: "in_progress" });
      const resuming = workflowState === "paused";
      showNotice(resuming ? "Task resumed" : "Task in progress");
    }
  };

  const handleStartTimer = () => {
    const otherRunningTaskId =
      typeof myActiveTimer?.taskId === "number" ? myActiveTimer.taskId : null;
    if (
      otherRunningTaskId != null
      && otherRunningTaskId !== taskId
      && myActiveTimer?.startedAt
      && !myActiveTimer.paused
    ) {
      setShowSwitchTimerConfirm(true);
      return;
    }
    doStartTimer();
  };

  const handleConfirmSwitchTimer = () => {
    setShowSwitchTimerConfirm(false);
    doStartTimer();
  };

  const handleDelegate = () => {
    setDelegateUserId(task.assigneeId ?? "");
    setActionsMenuOpen(false);
    setShowDelegateDialog(true);
  };

  const handleConfirmDelegate = () => {
    if (!delegateUserId) return;
    updateMutation.mutate(
      { id: taskId, assigneeId: delegateUserId as number },
      {
        onSuccess: () => {
          setShowDelegateDialog(false);
          setDelegateUserId("");
          showNotice("Task delegated");
        },
      },
    );
  };

  const handleComplete = () => {
    writeTaskPref(taskId, "deferred", false);
    setIsDeferred(false);
    const finishTask = () => {
      updateMutation.mutate(
        { id: taskId, stage: "finished", status: "done" },
        {
          onSuccess: () => {
            showNotice("Moved to Finished");
          },
        },
      );
    };
    if (hasActiveSession) {
      stopTimerMutation.mutate({ taskId }, { onSuccess: finishTask });
    } else {
      finishTask();
    }
  };

  const handleSendComment = useCallback((text: string) => {
    const message = text.trim();
    if (!message) return;
    addCommentMutation.mutate({ taskId, message });
  }, [addCommentMutation, taskId]);

  const handleEditComment = useCallback((activityId: number, message: string) => {
    editCommentMutation.mutate({ taskId, activityId, message });
  }, [editCommentMutation, taskId]);

  const handleDeleteComment = useCallback((activityId: number) => {
    deleteCommentMutation.mutate({ taskId, activityId });
  }, [deleteCommentMutation, taskId]);

  const handleUploadCommentMedia = useCallback(async (file: File) => {
    assertAttachmentFileSize(file);
    const mimeType = resolveFileMimeType(file);
    const dataBase64 = await readFileAsBase64(file);
    const attachment = await addAttachmentMutation.mutateAsync({
      taskId,
      fileName: file.name,
      mimeType,
      fileSize: file.size,
      dataBase64,
      listedInFiles: false,
    });
    return {
      id: attachment.id,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType || mimeType,
    };
  }, [addAttachmentMutation, taskId]);

  const resolveMediaPreviewUrl = useCallback(
    createAttachmentPreviewResolver((id) => utils.task.getAttachment.fetch({ id })),
    [utils],
  );

  const handleSelectCrmFile = (file: { id: number; fileName: string }) => {
    handleSendComment(`📎 Shared CRM file: ${file.fileName}`);
  };

  const handleSelectTaskReference = (pickedTask: { id: number; title: string }) => {
    handleSendComment(`📋 Linked task #${pickedTask.id}: ${pickedTask.title}`);
  };

  const handleSelectEvent = (title: string, when: string) => {
    const whenPart = when ? ` (${when})` : "";
    handleSendComment(`📅 Event or meeting: ${title}${whenPart}`);
  };

  const mentionUsers = useMemo(() => {
    const list = filterMentionableUsers(usersData);
    const owner = task.creator;
    if (
      owner &&
      owner.id != null &&
      !list.some((user) => user.id === owner.id)
    ) {
      list.push({
        id: owner.id,
        name: owner.name ?? null,
        avatar: owner.avatar,
        role: owner.role,
      });
    }
    return list;
  }, [usersData, task.creator]);

  const isManageableComment = (activity: (typeof task.activities)[number]) => {
    if (activity.action !== "commented") return false;
    if (activity.userId !== user?.id) return false;
    const metadata = activity.metadata;
    return !(metadata && typeof metadata === "object" && "subtaskId" in metadata);
  };

  const formatMinutesAsDuration = (totalMinutes: number) => {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours > 0 && minutes > 0) {
      return `${hours} hour${hours === 1 ? "" : "s"} ${minutes} minute${minutes === 1 ? "" : "s"}`;
    }
    if (hours > 0) return `${hours} hour${hours === 1 ? "" : "s"}`;
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  };

  const formatLoggedDuration = (raw?: string | null) => {
    if (!raw) return null;
    const minutesMatch = raw.match(/(\d+)\s*min(?:ute)?s?/i);
    if (!minutesMatch) return null;
    return `tracked ${formatMinutesAsDuration(Number(minutesMatch[1]))}`;
  };

  const resolveActivityUserLabel = (value?: string | null) => {
    if (value == null || value === "") return "Unassigned";
    const trimmed = value.trim();
    if (/^\d+$/.test(trimmed)) {
      const id = Number(trimmed);
      const match = usersData.find((u) => u.id === id);
      return match?.name?.trim() || `User #${id}`;
    }
    return trimmed;
  };

  const activityMessage = (action: string, oldValue?: string | null, newValue?: string | null) => {
    switch (action) {
      case "created":
        return "created this task.";
      case "status_changed": {
        const knownStage = Boolean(newValue && pipelineStages.some((s) => s.key === newValue));
        if (knownStage) {
          return `changed stage to '${kanbanStageLabel(newValue, pipelineStages)}'.`;
        }
        return `changed status to '${(newValue ?? "—").replace(/_/g, " ")}'.`;
      }
      case "stage_changed":
        return `changed stage to '${kanbanStageLabel(newValue)}'.`;
      case "priority_changed": {
        const formatPriority = (value?: string | null) => {
          if (!value) return "—";
          if (isTaskPriority(value)) return priorityConfig[value].label;
          return value.charAt(0).toUpperCase() + value.slice(1);
        };
        if (newValue === "urgent" && oldValue !== "urgent") {
          return "changed priority to urgent.";
        }
        if (oldValue && newValue) {
          return `changed priority from '${formatPriority(oldValue)}' to '${formatPriority(newValue)}'.`;
        }
        return `changed priority to '${formatPriority(newValue)}'.`;
      }
      case "title_changed":
        if (oldValue && newValue) {
          return `renamed this task from '${oldValue}' to '${newValue}'.`;
        }
        return `renamed this task to '${newValue ?? "—"}'.`;
      case "assigned": {
        const fromLabel = youOrDisplayName(resolveActivityUserLabel(oldValue), user);
        const toLabel = youOrDisplayName(resolveActivityUserLabel(newValue), user);
        if (!oldValue && newValue) {
          return `assigned this task to ${toLabel}.`;
        }
        if (oldValue && !newValue) {
          return `removed ${fromLabel} as assignee.`;
        }
        return `changed assignee from ${fromLabel} to ${toLabel}.`;
      }
      case "owner_changed": {
        const fromLabel = youOrDisplayName(resolveActivityUserLabel(oldValue), user);
        const toLabel = youOrDisplayName(resolveActivityUserLabel(newValue), user);
        if (oldValue && newValue) {
          return `changed task owner from ${fromLabel} to ${toLabel}.`;
        }
        return `changed task owner to ${toLabel}.`;
      }
      case "participant_added":
        return isViewerDisplayName(resolveActivityUserLabel(newValue), user)
          ? "were added as a participant."
          : "has been added as a participant.";
      case "observer_added":
        return isViewerDisplayName(resolveActivityUserLabel(newValue), user)
          ? "were added as an observer."
          : "has been added as an observer.";
      case "time_logged": {
        if (newValue === "started timer") return "started time tracking.";
        if (newValue === "resumed timer") return "resumed time tracking.";
        if (typeof newValue === "string" && newValue.toLowerCase().includes("paused timer")) {
          const minutesMatch = newValue.match(/(\d+)\s*min(?:ute)?s?/i);
          const minutes = minutesMatch ? Number(minutesMatch[1]) : null;
          if (minutes != null && Number.isFinite(minutes) && minutes > 0) {
            return `paused time tracking. Duration: ${formatMinutesAsDuration(minutes)}.`;
          }
          return "paused time tracking.";
        }
        if (newValue === "started the task" || newValue === "started task") return "started the task.";
        if (newValue?.toLowerCase().includes("manual")) {
          const minutesMatch = newValue.match(/(\d+)\s*min(?:ute)?s?/i);
          const minutes = minutesMatch ? Number(minutesMatch[1]) : null;
          if (minutes != null) {
            return `added a manual time entry of ${formatMinutesAsDuration(minutes)} to the timesheet.`;
          }
          return "added a manual time entry to the timesheet.";
        }
        const durationText = formatLoggedDuration(newValue);
        if (durationText) return `${durationText}.`;
        return `logged time: ${newValue ?? ""}.`;
      }
      case "commented":
        return newValue ?? "commented";
      default:
        return `${action.replace(/_/g, " ")}.`;
    }
  };

  const activityBubbleName = (
    action: string,
    actorName: string | null | undefined,
    newValue?: string | null,
    actorUserId?: number | null,
  ) => {
    if (action === "participant_added" || action === "observer_added") {
      const label = resolveActivityUserLabel(newValue);
      return isViewerDisplayName(label, user) ? "You" : label;
    }
    if (actorUserId != null && user?.id != null && Number(actorUserId) === Number(user.id)) {
      return "You";
    }
    return actorName;
  };

  const filteredActivities = useMemo(() => {
    const searched = [...task.activities]
      .filter((activity) => {
        if (!chatSearch.trim()) return true;
        const q = chatSearch.toLowerCase();
        const text =
          activity.action === "commented"
            ? (activity.newValue ?? "")
            : `${activityBubbleName(activity.action, activity.user?.name, activity.newValue, activity.userId) ?? ""} ${activityMessage(activity.action, activity.oldValue, activity.newValue)}`;
        return (
          text.toLowerCase().includes(q) ||
          (activity.user?.name ?? "").toLowerCase().includes(q)
        );
      })
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    if (chatFeedMode === "all") return searched;

    const comments = searched.filter((activity) => activity.action === "commented");
    if (comments.length <= commentWindowSize) return comments;
    return comments.slice(comments.length - commentWindowSize);
  }, [task.activities, chatSearch, chatFeedMode, commentWindowSize]);

  const totalCommentCount = useMemo(() => {
    const searched = [...task.activities].filter((activity) => {
      if (activity.action !== "commented") return false;
      if (!chatSearch.trim()) return true;
      const q = chatSearch.toLowerCase();
      const text = activity.newValue ?? "";
      return (
        text.toLowerCase().includes(q) ||
        (activity.user?.name ?? "").toLowerCase().includes(q)
      );
    });
    return searched.length;
  }, [task.activities, chatSearch]);

  const hiddenEarlierComments =
    chatFeedMode === "comments"
      ? Math.max(0, totalCommentCount - filteredActivities.length)
      : 0;

  useEffect(() => {
    setChatFeedMode("comments");
    setCommentWindowSize(4);
    setChatSearch("");
  }, [taskId]);

  useEffect(() => {
    if (!highlightActivityId) return;
    const activity = task.activities.find((item) => item.id === highlightActivityId);
    if (!activity) return;

    if (activity.action !== "commented") {
      setChatFeedMode("all");
      return;
    }

    setChatFeedMode("comments");
    const comments = [...task.activities]
      .filter((item) => item.action === "commented")
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    const index = comments.findIndex((item) => item.id === highlightActivityId);
    if (index < 0) return;
    const needed = comments.length - index;
    setCommentWindowSize((current) => Math.max(current, needed));
  }, [highlightActivityId, task.activities]);

  useEffect(() => {
    if (!highlightActivityId) return;

    setShowChatPanel(true);

    let highlightTimer: number | undefined;
    let doneTimer: number | undefined;

    const scrollToActivity = () => {
      const element = document.getElementById(`activity-${highlightActivityId}`);
      if (!element) return false;

      element.scrollIntoView({ behavior: "smooth", block: "center" });
      setHighlightedActivityId(highlightActivityId);

      highlightTimer = window.setTimeout(() => {
        setHighlightedActivityId(null);
      }, 2000);

      doneTimer = window.setTimeout(() => {
        onHighlightDone?.();
      }, 2100);

      return true;
    };

    if (scrollToActivity()) {
      return () => {
        if (highlightTimer) window.clearTimeout(highlightTimer);
        if (doneTimer) window.clearTimeout(doneTimer);
      };
    }

    const retryTimer = window.setTimeout(() => {
      scrollToActivity();
    }, 350);

    return () => {
      window.clearTimeout(retryTimer);
      if (highlightTimer) window.clearTimeout(highlightTimer);
      if (doneTimer) window.clearTimeout(doneTimer);
    };
  }, [highlightActivityId, filteredActivities, onHighlightDone]);

  useEffect(() => {
    if (highlightActivityId) return;
    if (skipChatAutoScrollRef.current) {
      skipChatAutoScrollRef.current = false;
      return;
    }
    const el = chatFeedRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [filteredActivities.length, highlightActivityId, taskId, chatFeedMode]);

  return (
    <>
      <div className="relative flex flex-1 min-h-0 min-w-0 h-full w-full">
        {/* Edge actions — hide on mobile while chat is open so they don't cover the hide/back control */}
        <div
          className={cn(
            "absolute top-24 left-0 z-20 flex flex-col gap-1 pointer-events-auto max-lg:top-3 max-lg:right-3 max-lg:left-auto max-lg:flex-row max-lg:items-center",
            showChatPanel && "max-lg:hidden",
          )}
        >
          <div className="relative max-lg:translate-x-0 -translate-x-full">
            <button
              ref={copyLinkBtnRef}
              type="button"
              onClick={handleCopyLink}
              title="Copy link"
              aria-label="Copy link"
              className={`h-10 w-11 flex items-center justify-center text-white shadow-[0_2px_8px_rgba(37,99,235,0.35)] transition-colors max-lg:rounded-2xl lg:rounded-l-2xl lg:rounded-r-none ${
                linkCopied ? "bg-[#1D4ED8]" : "bg-[#2563EB] hover:bg-[#1D4ED8]"
              }`}
            >
              <Link2 size={17} strokeWidth={2.25} />
            </button>
          </div>
          <EdgeTabButton icon={ExternalLink} label="Open in new tab" onClick={handlePopOut} />
          <EdgeTabButton icon={X} label="Close" onClick={onClose} className="lg:order-first" />
        </div>
        {linkCopied && linkCopiedTipPos
          ? createPortal(
              <div
                role="status"
                className="pointer-events-none fixed z-[200] -translate-y-1/2 whitespace-nowrap rounded-md bg-[#111827] px-2.5 py-1.5 text-xs font-medium text-white shadow-lg"
                style={{ top: linkCopiedTipPos.top, left: linkCopiedTipPos.left }}
              >
                Link copied
              </div>,
              document.body,
            )
          : null}

        <div className="flex flex-1 min-h-0 min-w-0 h-full overflow-hidden flex-col lg:flex-row">
        {/* Task details — on mobile, hide while chat is open so Task Chat is full height */}
        <div
          className={cn(
            "relative w-full min-w-0 min-h-0 flex flex-1 flex-col bg-white border-r border-gray-200",
            showChatPanel && "max-lg:hidden lg:w-[44%] lg:flex-none",
          )}
        >
          {actionNotice && (
            <div className="shrink-0 px-6 py-2 bg-blue-50 border-b border-blue-100 text-xs font-medium text-[#2563EB]">
              {actionNotice}
            </div>
          )}
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain touch-pan-y">
            <div className="p-6 pt-14 lg:pt-6 space-y-4">
            {/* Section 1: Title (outside card) + description card */}
            <section>
              <div className="flex items-center justify-between gap-3 mb-3">
                {editingTitle ? (
                  <input
                    ref={titleInputRef}
                    type="text"
                    value={titleDraft}
                    onChange={(e) => setTitleDraft(e.target.value)}
                    onBlur={saveTitle}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        saveTitle();
                      }
                      if (e.key === "Escape") {
                        e.preventDefault();
                        cancelEditingTitle();
                      }
                    }}
                    disabled={updateMutation.isPending}
                    aria-label="Task title"
                    className="flex-1 min-w-0 text-xl font-semibold text-[#1F2937] leading-tight border border-[#2563EB]/40 rounded-lg px-2 py-1 outline-none bg-white focus:ring-2 focus:ring-[#2563EB]/20"
                  />
                ) : (
                  <h2
                    onPointerDown={handleTitlePointerDown}
                    onPointerMove={handleTitlePointerMove}
                    onClick={canManage ? handleTitleClick : undefined}
                    onDoubleClick={canManage ? startEditingTitle : undefined}
                    title={canManage ? "Select to copy · double-click to edit" : undefined}
                    className={cn(
                      "flex-1 min-w-0 text-left text-xl font-semibold text-[#1F2937] leading-tight border-0 outline-none bg-transparent rounded-lg px-0 py-0.5 select-text",
                      canManage && "hover:bg-gray-50 cursor-text",
                      !canManage && "cursor-default",
                    )}
                  >
                    {task.title}
                  </h2>
                )}
                <div className="flex items-center gap-0.5 shrink-0">
                  {canManage && !editingTitle ? (
                    <HeaderIconButton
                      icon={Pencil}
                      label="Edit title"
                      onClick={startEditingTitle}
                    />
                  ) : null}
                  {isFavorite && (
                    <HeaderIconButton
                      icon={Star}
                      label="Remove from favorites"
                      onClick={handleToggleFavorite}
                      active
                      activeClassName="text-amber-500 bg-amber-50 hover:bg-amber-100"
                    />
                  )}
                  {isMuted && (
                    <HeaderIconButton
                      icon={VolumeX}
                      label="Unmute notifications"
                      onClick={handleToggleMute}
                      active
                      activeClassName="text-gray-600 bg-gray-100 hover:bg-gray-200"
                    />
                  )}
                  <HeaderIconButton
                    icon={Flame}
                    label={task.priority === "urgent" ? "Remove urgent" : "Mark urgent"}
                    onClick={handleToggleUrgent}
                    active={task.priority === "urgent"}
                    activeClassName="text-orange-500 bg-orange-50 hover:bg-orange-100"
                  />
                </div>
              </div>

              <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
              <div
                className={cn(
                  "px-4 py-4",
                  editingDescription && "flex min-h-[380px] flex-col",
                )}
              >
                {editingDescription ? (
                  <div className="flex flex-1 flex-col gap-3">
                    <RichTextCommentEditor
                      ref={descriptionEditorRef}
                      key={`${taskId}-${editingDescription}`}
                      initialHtml={descriptionHtml}
                      initialMedia={descriptionMedia}
                      onChange={(html, media) => {
                        setDescriptionHtml(html);
                        setDescriptionMedia(media);
                      }}
                      onUploadMedia={handleUploadCommentMedia}
                      resolveMediaPreviewUrl={resolveMediaPreviewUrl}
                      placeholder="Add a description..."
                      className="flex-1"
                      editorClassName="min-h-[200px] max-h-[360px]"
                    />
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          const serialized =
                            descriptionEditorRef.current?.getSerializedContent() ?? {
                              html: descriptionHtml,
                              media: descriptionMedia,
                            };
                          const nextDescription =
                            serialized.html.trim() || serialized.media.length > 0
                              ? buildRichCommentMessage([], serialized.html, serialized.media)
                              : description.trim();
                          updateMutation.mutate({ id: taskId, description: nextDescription });
                          setDescription(nextDescription);
                          setEditingDescription(false);
                        }}
                        className="h-8 px-3.5 bg-[#2563EB] text-white rounded-lg text-xs font-medium hover:bg-[#1D4ED8] transition-colors"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const parsed = parseStoredCommentMessage(task.description || "");
                          if (parsed.isRich) {
                            setDescriptionHtml(parsed.body);
                            setDescriptionMedia(parsed.media);
                          } else {
                            setDescriptionHtml(task.description || "");
                            setDescriptionMedia([]);
                          }
                          setDescription(task.description || "");
                          setEditingDescription(false);
                        }}
                        className="h-8 px-3.5 border border-gray-200 rounded-lg text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div
                      className={cn(
                        "relative",
                        showCollapsedDescription && "overflow-hidden",
                      )}
                      style={
                        showCollapsedDescription
                          ? { maxHeight: DESCRIPTION_COLLAPSED_MAX_HEIGHT }
                          : undefined
                      }
                    >
                      <div ref={descriptionContentRef} className="min-w-0 max-w-full">
                        {hasRichDescription ? (
                          <CommentRichContent
                            message={task.description || ""}
                            mentionUsers={[]}
                            className="text-gray-600 min-w-0"
                            inlineMedia
                          />
                        ) : (
                          <p
                            className={cn(
                              "text-sm text-gray-600 leading-relaxed whitespace-pre-wrap select-text",
                              !descriptionText && "text-gray-400 italic",
                            )}
                          >
                            {descriptionText || "No description yet."}
                          </p>
                        )}
                      </div>
                      {showCollapsedDescription ? (
                        <div
                          className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-white to-transparent"
                          aria-hidden
                        />
                      ) : null}
                    </div>
                    <div className="mt-4 flex items-center gap-4 border-t border-gray-100 pt-4">
                      <button
                        type="button"
                        onClick={() => {
                          const parsed = parseStoredCommentMessage(task.description || "");
                          if (parsed.isRich) {
                            setDescriptionHtml(parsed.body);
                            setDescriptionMedia(parsed.media);
                          } else {
                            setDescriptionHtml(task.description || "");
                            setDescriptionMedia([]);
                          }
                          setEditingDescription(true);
                        }}
                        className="text-xs font-medium text-[#2563EB] hover:text-[#1D4ED8] transition-colors"
                      >
                        Edit
                      </button>
                      {descriptionOverflows ? (
                        <button
                          type="button"
                          onClick={() => setDescriptionExpanded((v) => !v)}
                          className="text-xs font-medium text-[#2563EB] hover:text-[#1D4ED8] transition-colors"
                        >
                          {descriptionExpanded ? "Collapse" : "Expand"}
                        </button>
                      ) : null}
                    </div>
                  </>
                )}
              </div>
              </div>
            </section>

            <TaskChecklistSection
              taskId={taskId}
              items={task.subtasks ?? []}
              canEdit={canManage || isParticipant || isObserver}
            />

            <TaskFilesSection taskId={taskId} canManage={canManage} />

            {/* Section 2: Task metadata */}
            <section className="rounded-xl border border-gray-200 bg-white overflow-hidden">
              <CollapsibleSectionHeader
                title="Task details"
                expanded={taskDetailsExpanded}
                onToggle={() => setTaskDetailsExpanded((open) => !open)}
              />
              {taskDetailsExpanded ? (
            <div className="px-4 py-1 text-sm">
              <MetaRow label="Task Owner" icon={User}>
                <UserSearchSelect
                  mode="single"
                  users={usersData}
                  knownUsers={ownerKnownUsers}
                  value={task.createdBy}
                  placeholder="Select owner…"
                  searchPlaceholder="Search employees…"
                  triggerClassName="h-9 max-w-[240px] border-gray-200"
                  disabled={!canChangeOwner}
                  onValueChange={(ownerId) => {
                    if (!canChangeOwner) return;
                    if (ownerId == null) return;
                    if (Number(ownerId) === Number(task.createdBy)) return;
                    updateMutation.mutate({
                      id: taskId,
                      createdBy: Number(ownerId),
                    });
                  }}
                />
              </MetaRow>

              <MetaRow label="Assignees" icon={Users}>
                {canChangeAssignee ? (
                  <UserSearchSelect
                    mode="single"
                    users={assigneeSelectUsers}
                    knownUsers={assigneeKnownUsers}
                    value={task.assigneeId}
                    allowClear
                    placeholder="Unassigned"
                    searchPlaceholder="Search people…"
                    triggerClassName="h-9 max-w-[240px] border-gray-200"
                    onValueChange={(assigneeId) =>
                      updateMutation.mutate({
                        id: taskId,
                        assigneeId: assigneeId ?? null,
                      })
                    }
                  />
                ) : (
                  <div className="inline-flex h-9 items-center">
                    <UserChip name={task.assignee?.name} avatar={task.assignee?.avatar} />
                  </div>
                )}
              </MetaRow>

              {showDueDate ? (
              <MetaRow label="Deadline" icon={Clock}>
                <div className="inline-flex items-center gap-2 min-w-0 flex-nowrap">
                  {canManage ? (
                    <input
                      type="datetime-local"
                      value={toDateTimeLocalValue(task.dueDate)}
                      onChange={(e) =>
                        updateMutation.mutate({
                          id: taskId,
                          dueDate: e.target.value ? new Date(e.target.value).toISOString() : null,
                        })
                      }
                      className={cn(
                        META_DATETIME_CLASS,
                        taskOverdue && "border-red-200 text-red-600",
                      )}
                    />
                  ) : (
                    <span
                      className={cn(
                        "inline-flex h-9 items-center text-sm shrink-0",
                        taskOverdue ? "text-red-600 font-medium" : "text-gray-800",
                      )}
                    >
                      {task.dueDate ? formatDueLabel(task.dueDate) : "No deadline"}
                    </span>
                  )}
                  {taskOverdue && task.dueDate && (
                    <span className="inline-flex w-fit shrink-0 items-center rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-600">
                      {formatOverdueLabel(task.dueDate)}
                    </span>
                  )}
                </div>
              </MetaRow>
              ) : null}

              {showTimeTracking ? (
              <>
              <MetaRow label="Time Tracking" icon={Clock}>
                <div className="inline-flex items-center gap-2 flex-wrap">
                  <TaskTrackedTimeDisplay
                    completedSeconds={completedSeconds}
                    timerSource={timerSource}
                  />
                  <button
                    type="button"
                    onClick={() => setTimeDetailsExpanded((open) => !open)}
                    className={cn(
                      "inline-flex items-center justify-center h-8 w-8 rounded-lg transition-colors",
                      timeDetailsExpanded
                        ? "text-white bg-[#2563EB] hover:bg-[#1D4ED8] shadow-sm"
                        : "text-[#2563EB] bg-blue-50 border border-blue-200 hover:bg-blue-100 shadow-sm",
                    )}
                    aria-label={
                      timeDetailsExpanded
                        ? "Hide time details"
                        : "Add or view manual time entries"
                    }
                    aria-expanded={timeDetailsExpanded}
                    title="Add manual time entry"
                  >
                    {timeDetailsExpanded ? <Minus size={16} /> : <Plus size={16} strokeWidth={2.5} />}
                  </button>
                </div>
              </MetaRow>
              {timeDetailsExpanded ? (
                <div className="pb-3 px-4 border-b border-gray-100 space-y-2">
                  {hasActiveSession && (
                    <div className="flex items-center justify-between text-sm bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
                      <span className="text-gray-600">Current session</span>
                      <LiveSessionElapsed timerSource={timerSource} />
                    </div>
                  )}
                  <div className="flex items-center justify-between text-sm bg-gray-50 border border-gray-100 rounded-lg px-3 py-2">
                    <span className="text-gray-600">Total logged</span>
                    <span className="font-mono font-semibold tabular-nums text-gray-800">
                      {formatElapsedHMS(timeData?.totalSeconds ?? 0)}
                    </span>
                  </div>
                  <TaskTimeLoggedSection
                    taskId={taskId}
                    timeData={timeData}
                    hasActiveSession={hasActiveSession}
                    canManageTime={canTrackTime}
                    currentUserId={user?.id ?? 0}
                    canPickUser={user?.role === "admin" || user?.role === "manager"}
                    users={usersData}
                  />
                </div>
              ) : null}

              <MetaRow label="Estimate" icon={Hourglass}>
                <div className="inline-flex items-center gap-2">
                  <LiveEstimateLabel
                    estimatedHours={task.estimatedHours}
                    completedSeconds={completedSeconds}
                    timerSource={timerSource}
                    formatLabel={formatEstimatedDuration}
                    isOver={isTrackedOverEstimate}
                  />
                  <TaskTimeEstimatePopover
                    taskId={taskId}
                    estimatedHours={task.estimatedHours}
                    canEdit={canManage}
                  />
                </div>
              </MetaRow>
              </>
              ) : null}

              <MetaRow label="Status" icon={Play}>
                {canEditTeamAndStatus ? (
                  <select
                    value={taskPipelineStage(task)}
                    onChange={(e) => handleStageChange(e.target.value as ProjectPipelineStageKey)}
                    className={cn(
                      META_SELECT_CLASS,
                      "rounded-full border-blue-100 bg-blue-50 text-[#2563EB] font-medium",
                    )}
                  >
                    {pipelineStages.map((stage) => (
                      <option key={stage.key} value={stage.key}>
                        {stage.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="inline-flex h-9 items-center gap-2 rounded-full bg-blue-50 px-3 text-sm font-medium text-[#2563EB]">
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: kanbanStageColor(taskPipelineStage(task), pipelineStages) }}
                    />
                    {kanbanStageLabel(taskPipelineStage(task), pipelineStages)}
                  </span>
                )}
              </MetaRow>

              <MetaRow label="Project" icon={Folder}>
                <ProjectSearchSelect
                  projects={projectsData}
                  knownProject={
                    task.project && typeof task.project.id === "number"
                      ? {
                          id: task.project.id,
                          name: task.project.name,
                          color: task.project.color,
                        }
                      : null
                  }
                  value={projectId}
                  allowClear
                  placeholder="No project"
                  searchPlaceholder="Search projects…"
                  triggerClassName="h-9 max-w-[240px] border-gray-200"
                  onValueChange={(nextProjectId) =>
                    updateMutation.mutate({
                      id: taskId,
                      projectId: nextProjectId ?? null,
                    })
                  }
                />
              </MetaRow>

              <MetaRow label="Priority" icon={Flag}>
                {canManage ? (
                  <PriorityMetaSelect
                    value={isTaskPriority(task.priority) ? task.priority : "medium"}
                    onChange={(priority) => updateMutation.mutate({ id: taskId, priority })}
                  />
                ) : (
                  <span className="inline-flex h-9 items-center text-sm text-gray-800">
                    {priorityConfig[isTaskPriority(task.priority) ? task.priority : "medium"].label}
                  </span>
                )}
              </MetaRow>

              <MetaRow label="Created" icon={Calendar}>
                <div className="inline-flex h-9 items-center gap-2 min-w-0 max-w-full flex-wrap">
                  <span className="text-sm text-gray-800 truncate leading-none">
                    {formatTaskDateTime(task.createdAt)}
                    {task.creator?.name ? (
                      <>
                        <span className="text-gray-400"> · </span>
                        <span className="font-medium">{task.creator.name}</span>
                      </>
                    ) : null}
                    <span className="text-gray-400"> / </span>
                    ID: {task.id}
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleCopyId()}
                    className="shrink-0 inline-flex h-7 w-7 items-center justify-center rounded-md text-gray-400 hover:text-[#2563EB] hover:bg-gray-100 transition-colors"
                    aria-label="Copy task ID"
                    title={idCopied ? "Copied!" : "Copy task ID"}
                  >
                    <Copy size={14} />
                  </button>
                </div>
              </MetaRow>
            </div>
              ) : null}
            </section>

            <section ref={participantsRef} className="rounded-xl border border-gray-200 bg-white overflow-hidden">
              <CollapsibleSectionHeader
                title="Participants"
                expanded={participantsExpanded}
                onToggle={() => setParticipantsExpanded((open) => !open)}
              />
              {participantsExpanded ? (
                <div className="p-4 pt-3">
                  {canManageParticipants ? (
                    <UserSearchSelect
                      mode="multi"
                      users={participantSelectUsers}
                      knownUsers={task.participants}
                      selected={task.participants.map((p) => p.id)}
                      onToggle={toggleParticipant}
                      placeholder="Select participants…"
                      searchPlaceholder="Search employees…"
                      disabled={
                        addParticipantMutation.isPending || removeParticipantMutation.isPending
                      }
                    />
                  ) : (
                    <div className="space-y-1.5">
                      {task.participants.map((p) => (
                        <UserChip key={p.id} name={p.name} avatar={p.avatar} />
                      ))}
                      {task.participants.length === 0 && (
                        <p className="text-sm text-gray-400">No participants</p>
                      )}
                    </div>
                  )}
                </div>
              ) : null}
            </section>

            <section className="rounded-xl border border-gray-200 bg-white overflow-hidden">
              <CollapsibleSectionHeader
                title="Observers"
                expanded={observersExpanded}
                onToggle={() => setObserversExpanded((open) => !open)}
              />
              {observersExpanded ? (
                <div className="p-4 pt-3 space-y-2">
                  <p className="text-xs text-gray-400">
                    Former assignees are added automatically when you reassign a task.
                  </p>
                  {canManageParticipants ? (
                    <UserSearchSelect
                      mode="multi"
                      users={observerSelectUsers}
                      knownUsers={task.observers ?? []}
                      selected={(task.observers ?? []).map((o) => o.id)}
                      onToggle={toggleObserver}
                      placeholder="Select observers…"
                      searchPlaceholder="Search employees…"
                      disabled={
                        addObserverMutation.isPending || removeObserverMutation.isPending
                      }
                    />
                  ) : (
                    <div className="space-y-1.5">
                      {(task.observers ?? []).map((o) => (
                        <UserChip key={o.id} name={o.name} avatar={o.avatar} />
                      ))}
                      {(task.observers ?? []).length === 0 && (
                        <p className="text-sm text-gray-400">No observers</p>
                      )}
                    </div>
                  )}
                </div>
              ) : null}
            </section>
            </div>
          </div>

          {/* Bottom Start / Complete — always visible */}
          {canTrackTime && workflowState !== "complete" && (
            <div className="shrink-0 border-t border-gray-200 px-4 py-3 bg-white">
              {hasActiveSession && (
                <div className="flex items-center justify-center gap-2 mb-2">
                  <TaskTrackedTimeDisplay
                    timerSource={timerSource}
                    sessionOnly
                    className="text-base"
                  />
                  <span className="text-[11px] font-medium text-gray-500 font-sans">
                    {isTimerRunning ? "tracking…" : "paused"}
                  </span>
                </div>
              )}
              <div className="flex items-center gap-2">
                {workflowState === "deferred" && !hasActiveSession ? (
                  <button
                    type="button"
                    onClick={handleResumeTask}
                    disabled={updateMutation.isPending && startTimerMutation.isPending && !isTimerRunning}
                    className="h-9 px-4 inline-flex items-center justify-center gap-1.5 bg-[#2563EB] text-white rounded-lg text-sm font-medium hover:bg-[#1D4ED8] disabled:opacity-50"
                  >
                    {startTimerMutation.isPending && !isTimerRunning ? (
                      <Loader2 size={15} className="animate-spin" />
                    ) : (
                      <Play size={15} />
                    )}
                    Resume task
                  </button>
                ) : isTimerRunning ? (
                  <button
                    type="button"
                    onClick={() => pauseTimerMutation.mutate({ taskId })}
                    disabled={pauseTimerMutation.isPending}
                    className="h-9 px-4 inline-flex items-center justify-center gap-1.5 bg-[#F59E0B] text-white rounded-lg text-sm font-medium hover:bg-[#D97706] disabled:opacity-50"
                  >
                    {pauseTimerMutation.isPending ? <Loader2 size={15} className="animate-spin" /> : <Pause size={15} />}
                    Pause
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleStartTimer}
                    disabled={startTimerMutation.isPending && !hasActiveSession}
                    className="h-9 px-4 inline-flex items-center justify-center gap-1.5 bg-[#2563EB] text-white rounded-lg text-sm font-medium hover:bg-[#1D4ED8] disabled:opacity-50"
                  >
                    {startTimerMutation.isPending && !hasActiveSession ? (
                      <Loader2 size={15} className="animate-spin" />
                    ) : (
                      <Play size={15} />
                    )}
                    {isTimerPaused ? "Resume" : "Start"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleComplete}
                  disabled={updateMutation.isPending || stopTimerMutation.isPending}
                  className="h-9 px-4 inline-flex items-center justify-center border border-gray-300 bg-white text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
                >
                  {statusLabels.done}
                </button>
                {(canChangeAssignee || canDelete) && (
                <Popover open={actionsMenuOpen} onOpenChange={setActionsMenuOpen} modal>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="h-9 w-9 inline-flex items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors"
                      aria-label="More actions"
                      title="More actions"
                    >
                      <MoreHorizontal size={18} />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    align="end"
                    side="top"
                    sideOffset={8}
                    className="z-[130] w-44 p-1.5 rounded-xl"
                    onOpenAutoFocus={(event) => event.preventDefault()}
                    onInteractOutside={() => setActionsMenuOpen(false)}
                    onPointerDownOutside={() => setActionsMenuOpen(false)}
                    onEscapeKeyDown={() => setActionsMenuOpen(false)}
                  >
                    {canChangeAssignee ? (
                      <ActionMenuItem icon={UserPlus} label="Delegate" onClick={handleDelegate} />
                    ) : null}
                    {canDelete && (
                      <ActionMenuItem
                        icon={Trash2}
                        label="Delete"
                        destructive
                        onClick={() => {
                          setActionsMenuOpen(false);
                          setShowDeleteConfirm(true);
                        }}
                      />
                    )}
                  </PopoverContent>
                </Popover>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Task chat — full height on mobile when open; side panel on desktop */}
        {showChatPanel && (
        <div className="flex flex-1 flex-col min-w-0 min-h-0 h-full bg-[#E8F0FE]">
          <div className="px-5 py-3 bg-white/80 border-b border-gray-200 shrink-0 max-lg:pt-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex items-start gap-2">
                <button
                  type="button"
                  onClick={() => setShowChatPanel(false)}
                  className="lg:hidden shrink-0 mt-0.5 w-9 h-9 flex items-center justify-center rounded-lg text-[#2563EB] bg-blue-50 hover:bg-blue-100"
                  aria-label="Hide chat panel"
                  title="Hide chat"
                >
                  <ChevronLeft size={20} />
                </button>
                <div className="min-w-0">
                  <h3 className="font-semibold text-[#1F2937]">Task Chat</h3>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {memberCount} member{memberCount === 1 ? "" : "s"}
                    {isMuted && " · Muted"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <HeaderIconButton
                  icon={Search}
                  label="Search chat"
                  onClick={() => setShowChatSearch((v) => !v)}
                  active={showChatSearch}
                />
                <HeaderIconButton
                  icon={PanelRightClose}
                  label="Hide chat panel"
                  onClick={() => setShowChatPanel(false)}
                />
              </div>
            </div>

            <div className="mt-3 flex items-center gap-1 rounded-lg bg-gray-100 p-0.5 w-fit">
              <button
                type="button"
                onClick={() => setChatFeedMode("comments")}
                className={cn(
                  "h-7 px-3 rounded-md text-xs font-semibold transition-colors",
                  chatFeedMode === "comments"
                    ? "bg-white text-[#1F2937] shadow-sm"
                    : "text-gray-500 hover:text-gray-700",
                )}
              >
                Comments
              </button>
              <button
                type="button"
                onClick={() => setChatFeedMode("all")}
                className={cn(
                  "h-7 px-3 rounded-md text-xs font-semibold transition-colors",
                  chatFeedMode === "all"
                    ? "bg-white text-[#1F2937] shadow-sm"
                    : "text-gray-500 hover:text-gray-700",
                )}
              >
                All Activity
              </button>
            </div>

            {showChatSearch && (
              <div className="mt-3 relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={chatSearch}
                  onChange={(e) => setChatSearch(e.target.value)}
                  placeholder="Search messages..."
                  className="w-full h-9 pl-9 pr-3 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20"
                  autoFocus
                />
              </div>
            )}
          </div>

          <div ref={chatFeedRef} className="flex-1 min-h-0 overflow-y-auto overscroll-contain touch-pan-y p-4 space-y-3">
            {hiddenEarlierComments > 0 ? (
              <div className="flex justify-center pb-1">
                <button
                  type="button"
                  onClick={() => {
                    skipChatAutoScrollRef.current = true;
                    setCommentWindowSize((current) =>
                      Math.min(current + 4, totalCommentCount),
                    );
                  }}
                  className="text-xs font-medium text-[#2563EB] hover:text-[#1D4ED8] hover:underline"
                >
                  Show previous comments
                  {hiddenEarlierComments > 0
                    ? ` (${hiddenEarlierComments})`
                    : ""}
                </button>
              </div>
            ) : null}
            {filteredActivities.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-8">
                {chatFeedMode === "comments"
                  ? chatSearch.trim()
                    ? "No comments found."
                    : "No comments yet."
                  : chatSearch.trim()
                    ? "No messages found."
                    : "No activity yet."}
              </p>
            ) : (
            filteredActivities.map((activity, index) => {
              const isComment = activity.action === "commented";
              const isHighlighted = highlightedActivityId === activity.id;
              const prev = filteredActivities[index - 1];
              const showDateDivider = !prev || activityDayKey(prev.createdAt) !== activityDayKey(activity.createdAt);

              return (
                <div key={activity.id} className="space-y-3">
                  {showDateDivider ? (
                    <div className="flex justify-center py-1">
                      <span className="rounded-full bg-[#6B7280]/85 px-3.5 py-1 text-[11px] font-medium text-white shadow-sm backdrop-blur-sm">
                        {formatChatDateLabel(activity.createdAt)}
                      </span>
                    </div>
                  ) : null}

                  {isComment ? (
                    <div
                      id={`activity-${activity.id}`}
                      className={cn(
                        "rounded-xl transition-all duration-300",
                        isHighlighted && "ring-2 ring-amber-400 ring-offset-2 shadow-lg",
                      )}
                    >
                      <TaskCommentBubble
                        activity={activity}
                        taskId={taskId}
                        isOwn={activity.userId === user?.id}
                        mentionUsers={mentionUsers}
                        canManage={isManageableComment(activity)}
                        isSaving={editCommentMutation.isPending}
                        isDeleting={deleteCommentMutation.isPending}
                        onSave={handleEditComment}
                        onDelete={handleDeleteComment}
                        onUploadMedia={handleUploadCommentMedia}
                      />
                    </div>
                  ) : (
                    <div
                      id={`activity-${activity.id}`}
                      className={cn(
                        "rounded-xl transition-all duration-300",
                        isHighlighted && "ring-2 ring-amber-400 ring-offset-2 shadow-lg",
                      )}
                    >
                      <TaskActivityBubble
                        name={activityBubbleName(
                          activity.action,
                          activity.user?.name,
                          activity.newValue,
                          activity.userId,
                        )}
                        message={activityMessage(activity.action, activity.oldValue, activity.newValue)}
                        createdAt={activity.createdAt}
                      />
                    </div>
                  )}
                </div>
              );
            })
            )}
          </div>

          <TaskCommentComposer
            taskId={taskId}
            onSend={handleSendComment}
            isSending={addCommentMutation.isPending}
            isUploadingMedia={addAttachmentMutation.isPending}
            mentionUsers={mentionUsers}
            onUploadMedia={handleUploadCommentMedia}
            resolveMediaPreviewUrl={resolveMediaPreviewUrl}
            crmFiles={crmFiles}
            isCrmFilesLoading={isCrmFilesLoading}
            onSelectCrmFile={handleSelectCrmFile}
            tasks={taskListData?.tasks ?? []}
            isTasksLoading={isTaskListLoading}
            onSelectTask={handleSelectTaskReference}
            onSelectEvent={handleSelectEvent}
          />
        </div>
        )}

        {!showChatPanel && (
          <button
            type="button"
            onClick={() => setShowChatPanel(true)}
            className="shrink-0 border-gray-200 bg-white hover:bg-gray-50 flex items-center justify-center gap-2 text-gray-500 hover:text-[#2563EB] transition-colors max-lg:h-12 max-lg:w-full max-lg:border-t lg:w-12 lg:border-l lg:flex-col"
            title="Show chat panel"
            aria-label="Show chat panel"
          >
            <PanelRightOpen size={18} />
            <span className="text-[10px] font-medium max-lg:text-xs lg:[writing-mode:vertical-rl] lg:rotate-180">
              Chat
            </span>
          </button>
        )}
        </div>
      </div>

      <Dialog open={showDelegateDialog} onOpenChange={setShowDelegateDialog}>
        <DialogContent className="z-[130] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delegate task</DialogTitle>
            <DialogDescription>Choose who should take over this task.</DialogDescription>
          </DialogHeader>
          <select
            value={delegateUserId}
            onChange={(e) => setDelegateUserId(e.target.value ? Number(e.target.value) : "")}
            className="w-full h-10 px-3 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20"
          >
            <option value="">Select assignee...</option>
            {assigneeSelectUsers.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
          <DialogFooter>
            <button
              type="button"
              onClick={() => {
                setShowDelegateDialog(false);
                setDelegateUserId("");
              }}
              className="h-9 px-4 border border-gray-200 rounded-lg text-sm text-gray-600"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirmDelegate}
              disabled={!delegateUserId || updateMutation.isPending}
              className="h-9 px-4 bg-[#2563EB] text-white rounded-lg text-sm font-medium disabled:opacity-50"
            >
              {updateMutation.isPending ? "Delegating…" : "Delegate"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showSwitchTimerConfirm} onOpenChange={setShowSwitchTimerConfirm}>
        <AlertDialogContent overlayClassName="z-[130]" className="z-[130]">
          <AlertDialogHeader>
            <AlertDialogTitle>Switch time tracking?</AlertDialogTitle>
            <AlertDialogDescription>
              Time tracking is already running on &ldquo;{myActiveTimer?.taskTitle ?? "another task"}
              &rdquo;. Starting time tracking on this task will pause the timer on that task. Do you
              want to continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={startTimerMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={startTimerMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                handleConfirmSwitchTimer();
              }}
            >
              {startTimerMutation.isPending ? "Starting…" : "OK"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent overlayClassName="z-[130]" className="z-[130]">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete task?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete &ldquo;{task.title}&rdquo;. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              disabled={deleteMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                deleteMutation.mutate({ id: taskId });
              }}
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function EdgeTabButton({
  icon: Icon,
  label,
  onClick,
  active,
  className,
}: {
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  label: string;
  onClick: () => void;
  active?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(
        "h-10 w-11 flex items-center justify-center text-white shadow-[0_2px_8px_rgba(37,99,235,0.35)] transition-colors max-lg:translate-x-0 max-lg:rounded-2xl lg:-translate-x-full lg:rounded-l-2xl lg:rounded-r-none",
        active ? "bg-[#1D4ED8]" : "bg-[#2563EB] hover:bg-[#1D4ED8]",
        className,
      )}
    >
      <Icon size={17} strokeWidth={2.25} />
    </button>
  );
}

function HeaderIconButton({
  icon: Icon,
  label,
  onClick,
  active,
  activeClassName = "text-[#2563EB] bg-blue-50",
}: {
  icon: React.ComponentType<{ size?: number }>;
  label: string;
  onClick: () => void;
  active?: boolean;
  activeClassName?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`w-9 h-9 flex items-center justify-center rounded-lg text-gray-500 transition-colors ${
        active ? activeClassName : "hover:bg-gray-100 hover:text-gray-800"
      }`}
    >
      <Icon size={18} />
    </button>
  );
}

function ActionMenuItem({
  icon: Icon,
  label,
  onClick,
  destructive,
}: {
  icon: React.ComponentType<{ size?: number }>;
  label: string;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 text-sm rounded-lg transition-colors ${
        destructive
          ? "text-red-600 hover:bg-red-50"
          : "text-gray-800 hover:bg-gray-50"
      }`}
    >
      <span>{label}</span>
      <Icon size={16} className={destructive ? "text-red-600" : "text-gray-400"} />
    </button>
  );
}

function CollapsibleSectionHeader({
  title,
  expanded,
  onToggle,
  actions,
}: {
  title: string;
  expanded: boolean;
  onToggle: () => void;
  actions?: React.ReactNode;
}) {
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onToggle();
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={handleKeyDown}
      aria-expanded={expanded}
      aria-label={expanded ? `Collapse ${title}` : `Expand ${title}`}
      className="flex items-center justify-between px-4 py-2.5 bg-gray-50 border-b border-gray-100 cursor-pointer hover:bg-gray-100/80 transition-colors"
    >
      <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide select-none">
        {title}
      </span>
      <div className="flex items-center gap-2">
        {actions ? (
          <div onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
            {actions}
          </div>
        ) : null}
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-md text-gray-500 pointer-events-none">
          {actions ? (
            expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />
          ) : expanded ? (
            <Minus size={14} />
          ) : (
            <Plus size={14} />
          )}
        </span>
      </div>
    </div>
  );
}

function MetaRow({
  label,
  icon: Icon,
  children,
  align = "center",
}: {
  label: string;
  icon?: LucideIcon;
  children: React.ReactNode;
  align?: "center" | "start";
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-[16px_6.75rem_minmax(0,1fr)] gap-x-3 py-2.5 border-b border-gray-100 last:border-0",
        align === "center" ? "items-center" : "items-start",
      )}
    >
      {Icon ? (
        <Icon size={16} className="shrink-0 text-gray-400" />
      ) : (
        <span />
      )}
      <span className="text-sm text-gray-500 leading-none">{label}:</span>
      <div
        className={cn(
          "min-w-0",
          align === "center" ? "flex items-center" : "flex items-start pt-1.5",
        )}
      >
        {children}
      </div>
    </div>
  );
}

function UserChip({ name, avatar }: { name?: string | null; avatar?: string | null }) {
  if (!name) return <span className="text-gray-400">—</span>;
  return (
    <span className="inline-flex items-center gap-2 text-gray-800">
      <UserAvatar name={name} avatar={avatar} size={22} />
      {name}
    </span>
  );
}

