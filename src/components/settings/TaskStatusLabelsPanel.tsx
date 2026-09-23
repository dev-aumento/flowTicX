import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Check, Info, Loader2 } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { PROJECT_PIPELINE_STAGES } from "@/lib/task-kanban";

type PipelineLabelForm = Record<string, string>;

function defaultForm(): PipelineLabelForm {
  return Object.fromEntries(PROJECT_PIPELINE_STAGES.map((stage) => [stage.key, stage.label]));
}

type TaskStatusLabelsPanelProps = {
  onSaved?: () => void;
  onError?: (message: string | null) => void;
};

export function TaskStatusLabelsPanel({ onSaved, onError }: TaskStatusLabelsPanelProps) {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.organization.getPipelineStageLabels.useQuery();
  const [form, setForm] = useState<PipelineLabelForm>(defaultForm);
  const [savedSnapshot, setSavedSnapshot] = useState<PipelineLabelForm>(defaultForm);
  const [saved, setSaved] = useState(false);
  const dirtyRef = useRef(false);

  useEffect(() => {
    if (!data?.labels) return;
    if (dirtyRef.current) return;
    setForm(data.labels);
    setSavedSnapshot(data.labels);
  }, [data?.labels]);

  const isDirty = useMemo(
    () => PROJECT_PIPELINE_STAGES.some((stage) => form[stage.key]?.trim() !== savedSnapshot[stage.key]?.trim()),
    [form, savedSnapshot],
  );
  dirtyRef.current = isDirty;

  const canEdit = data?.canEdit === true;

  const saveMutation = trpc.organization.updatePipelineStageLabels.useMutation({
    onSuccess: async (result) => {
      setForm(result.labels);
      setSavedSnapshot(result.labels);
      setSaved(true);
      onError?.(null);
      onSaved?.();
      await Promise.all([
        utils.organization.getPipelineStageLabels.invalidate(),
        utils.project.list.invalidate(),
        utils.project.getById.invalidate(),
        utils.task.list.invalidate(),
        utils.task.getById.invalidate(),
      ]);
      setTimeout(() => setSaved(false), 2000);
    },
    onError: (error) => {
      onError?.(error.message || "Could not save task status names.");
    },
  });

  const handleSave = () => {
    if (!canEdit || !isDirty || saveMutation.isPending) return;
    const empty = PROJECT_PIPELINE_STAGES.find((stage) => !form[stage.key]?.trim());
    if (empty) {
      onError?.(`${empty.label} cannot be empty.`);
      return;
    }
    onError?.(null);
    saveMutation.mutate(
      Object.fromEntries(
        PROJECT_PIPELINE_STAGES.map((stage) => [stage.key, form[stage.key].trim()]),
      ),
    );
  };

  const handleResetDefaults = () => {
    setForm(defaultForm());
    setSaved(false);
    onError?.(null);
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500 py-8">
        <Loader2 size={16} className="animate-spin" />
        Loading task statuses…
      </div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-[#1F2937]">Task statuses</h2>
        <p className="text-sm text-gray-500 mt-1">
          Rename the statuses shown on tasks (To Do, In Designing, Finished, and the rest).
          These names update on employee dashboards, task details, and the All Tasks filter.
        </p>
      </div>

      <div className="space-y-4">
        {PROJECT_PIPELINE_STAGES.map((stage) => (
          <div key={stage.key}>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor={`pipeline-status-${stage.key}`}>
              {stage.label}
            </label>
            <input
              id={`pipeline-status-${stage.key}`}
              type="text"
              maxLength={80}
              value={form[stage.key] ?? ""}
              disabled={!canEdit}
              onChange={(e) => {
                setForm((prev) => ({ ...prev, [stage.key]: e.target.value }));
                setSaved(false);
                onError?.(null);
              }}
              className="w-full h-10 px-3 border border-gray-200 rounded-lg text-sm bg-white text-[#1F2937] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB] disabled:bg-gray-50 disabled:text-gray-600 disabled:cursor-not-allowed"
            />
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-3 flex gap-2">
        <Info size={16} className="text-[#2563EB] shrink-0 mt-0.5" />
        <p className="text-xs text-gray-600">
          After you save, these names appear in the task Status dropdown and the All Tasks filter
          for everyone in the workspace.
        </p>
      </div>

      {canEdit ? (
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <button
            type="button"
            onClick={handleSave}
            disabled={!isDirty || saveMutation.isPending}
            className="h-10 px-6 bg-gradient-to-r from-[#2563EB] to-[#3B82F6] text-white rounded-lg text-sm font-semibold hover:shadow-lg hover:shadow-blue-200 transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-none"
          >
            {saveMutation.isPending ? (
              <>
                <Loader2 size={16} className="animate-spin" /> Saving...
              </>
            ) : saved && !isDirty ? (
              <>
                <Check size={16} /> Saved
              </>
            ) : (
              "Save Changes"
            )}
          </button>
          <button
            type="button"
            onClick={handleResetDefaults}
            disabled={saveMutation.isPending}
            className="h-10 px-4 text-sm font-medium text-gray-600 hover:text-[#2563EB]"
          >
            Reset to defaults
          </button>
        </div>
      ) : (
        <p className="text-sm text-gray-500">You do not have permission to edit task status names.</p>
      )}
    </motion.div>
  );
}
