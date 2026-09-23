import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { ModalBackdrop } from "@/components/shared/ModalBackdrop";
import { DetailedCreateTaskView } from "@/components/tasks/DetailedCreateTaskView";
import type { PendingTaskAttachment } from "@/components/tasks/TaskFilesSection";
import type { CommentMediaRef } from "@/lib/rich-comment";
import type { PipelineStageDef, ProjectPipelineStageKey } from "@/lib/task-kanban";
import { defaultTaskDeadlineIso } from "@/lib/task-deadline";
import { useBodyScrollLock } from "@/hooks/useBodyScrollLock";
import { cn } from "@/lib/utils";

export type CreateTaskFormData = {
  title: string;
  description: string;
  descriptionHtml: string;
  descriptionMedia: CommentMediaRef[];
  priority: "low" | "medium" | "high" | "urgent";
  assigneeId: number | undefined;
  ownerId: number | undefined;
  projectId: number | undefined;
  stage?: ProjectPipelineStageKey;
  dueDate: string;
  estimatedHours: string;
  tags: string;
  statusSummary: string;
  participantIds: number[];
  observerIds: number[];
  activeModules: string[];
  checklistItems: string[];
  pendingAttachments: PendingTaskAttachment[];
  subtaskTitles: string[];
  reminderDate: string;
  relatedTaskIds: number[];
  parentTaskId?: number;
  crmItem: string;
  customFields: { key: string; value: string }[];
  chatDrafts: { message: string; at: string }[];
};

export const EMPTY_CREATE_TASK_FORM: CreateTaskFormData = {
  title: "",
  description: "",
  descriptionHtml: "",
  descriptionMedia: [],
  priority: "medium",
  assigneeId: undefined,
  ownerId: undefined,
  projectId: undefined,
  stage: "new",
  dueDate: "",
  estimatedHours: "",
  tags: "",
  statusSummary: "",
  participantIds: [],
  observerIds: [],
  activeModules: [],
  checklistItems: [""],
  pendingAttachments: [],
  subtaskTitles: [""],
  reminderDate: "",
  relatedTaskIds: [],
  parentTaskId: undefined,
  crmItem: "",
  customFields: [{ key: "", value: "" }],
  chatDrafts: [],
};

/** Fresh create-task form with deadline defaulted to today at 7:00 PM IST. */
export function createEmptyTaskForm(
  overrides?: Partial<CreateTaskFormData>,
): CreateTaskFormData {
  return {
    ...EMPTY_CREATE_TASK_FORM,
    dueDate: defaultTaskDeadlineIso(),
    ...overrides,
  };
}

type UserOption = {
  id: number;
  name: string | null;
  avatar?: string | null;
  role?: string | null;
  department?: string | null;
};
type ProjectOption = { id: number; name: string };
type TaskLinkOption = { id: number; title: string };

interface CreateTaskModalProps {
  open: boolean;
  onClose: () => void;
  formData: CreateTaskFormData;
  onFormDataChange: Dispatch<SetStateAction<CreateTaskFormData>>;
  onSubmit: () => void;
  isSubmitting?: boolean;
  users: UserOption[];
  projects: ProjectOption[];
  tasks?: TaskLinkOption[];
  currentUser?: UserOption | null;
  pipelineStages?: PipelineStageDef[];
  /** Invited clients remain the task owner so work shows up in Client's Tasks. */
  lockOwner?: boolean;
}

function useFullScreenCreateLayout() {
  const [narrow, setNarrow] = useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia("(max-width: 1023px)").matches
      : false,
  );

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px)");
    const update = () => setNarrow(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  return narrow;
}

export function CreateTaskModal({
  open,
  onClose,
  formData,
  onFormDataChange,
  onSubmit,
  isSubmitting,
  users,
  projects,
  tasks = [],
  currentUser,
  pipelineStages,
  lockOwner = false,
}: CreateTaskModalProps) {
  const fullScreen = useFullScreenCreateLayout();
  useBodyScrollLock(open && fullScreen);

  const view = (
    <DetailedCreateTaskView
      formData={formData}
      onFormDataChange={onFormDataChange}
      users={users}
      projects={projects}
      tasks={tasks}
      currentUser={currentUser}
      isSubmitting={isSubmitting}
      onSubmit={onSubmit}
      onCancel={onClose}
      pipelineStages={pipelineStages}
      hideTaskChat={fullScreen}
      lockOwner={lockOwner}
    />
  );

  if (typeof document === "undefined") return null;

  if (fullScreen) {
    return createPortal(
      <AnimatePresence>
        {open ? (
          <>
            <motion.div
              key="create-task-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-[125] bg-black/35"
              onClick={onClose}
              aria-hidden
            />
            <motion.aside
              key="create-task-panel"
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 32, stiffness: 320 }}
              className={cn(
                "fixed inset-0 z-[130] flex h-[100dvh] w-screen max-w-none flex-col overflow-hidden bg-white",
                "pt-[env(safe-area-inset-top,0px)] pb-[env(safe-area-inset-bottom,0px)]",
              )}
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-label="Create new task"
            >
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="absolute right-3 top-3 z-30 flex h-10 w-10 items-center justify-center rounded-full bg-[#2563EB] text-white shadow-[0_2px_8px_rgba(37,99,235,0.35)] transition-colors hover:bg-[#1D4ED8]"
              >
                <X size={17} strokeWidth={2.25} />
              </button>
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                {view}
              </div>
            </motion.aside>
          </>
        ) : null}
      </AnimatePresence>,
      document.body,
    );
  }

  return (
    <ModalBackdrop
      open={open}
      onClose={onClose}
      overlayClassName="z-[125] p-3 sm:p-6"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 12 }}
        onClick={(e) => e.stopPropagation()}
        className="relative flex h-[min(720px,92vh)] w-full max-w-6xl flex-col overflow-visible rounded-2xl bg-white shadow-2xl"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-0 right-0 z-30 flex h-10 w-10 -translate-y-1/2 translate-x-1/2 items-center justify-center rounded-full bg-[#2563EB] text-white shadow-[0_2px_8px_rgba(37,99,235,0.35)] transition-colors hover:bg-[#1D4ED8]"
        >
          <X size={17} strokeWidth={2.25} />
        </button>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl">
          {view}
        </div>
      </motion.div>
    </ModalBackdrop>
  );
}
