export type PipelineStageDef = {
  key: string;
  label: string;
  color: string;
};

export const PROJECT_PIPELINE_STAGES: readonly PipelineStageDef[] = [
  { key: "new", label: "To Do", color: "#6B7280" },
  { key: "in_designing", label: "In Designing", color: "#8B5CF6" },
  { key: "in_developing", label: "In Developing", color: "#2563EB" },
  { key: "in_qa_1st_round", label: "In QA (1st Round)", color: "#D97706" },
  { key: "backlog", label: "Backlog", color: "#9CA3AF" },
  { key: "client_1st_round", label: "Client (1st Round)", color: "#0EA5E9" },
  { key: "backlog_from_client", label: "Backlog from Client", color: "#64748B" },
  { key: "client_2nd_round", label: "Client (2nd Round)", color: "#0284C7" },
  { key: "publish_live", label: "Publish Live", color: "#059669" },
  { key: "finished", label: "Finished", color: "#10B981" },
];

/** Built-in stage keys (does not include project custom sections). */
export const PROJECT_PIPELINE_STAGE_KEYS = PROJECT_PIPELINE_STAGES.map((s) => s.key);

/** @deprecated Use PROJECT_PIPELINE_STAGES */
export const KANBAN_STAGES = PROJECT_PIPELINE_STAGES;

export type ProjectPipelineStageKey = string;
export type KanbanStageKey = ProjectPipelineStageKey;

export const PIPELINE_STAGE_KEY_REGEX = /^[a-z][a-z0-9_]{0,63}$/;

export const CUSTOM_PIPELINE_STAGE_COLORS = [
  "#7C3AED",
  "#DB2777",
  "#EA580C",
  "#0891B2",
  "#4F46E5",
  "#CA8A04",
  "#0D9488",
  "#BE185D",
] as const;

/** Defaults + optional project custom sections (appended at the end). */
export function resolvePipelineStages(
  customStages?: PipelineStageDef[] | null,
  labelOverrides?: Record<string, string> | null,
): PipelineStageDef[] {
  const defaults = PROJECT_PIPELINE_STAGES.map((s) => ({ ...s }));
  const seen = new Set(defaults.map((s) => s.key));
  const extras: PipelineStageDef[] = [];

  if (customStages?.length) {
    for (const stage of customStages) {
      if (!stage?.key || !PIPELINE_STAGE_KEY_REGEX.test(stage.key)) continue;
      if (seen.has(stage.key)) continue;
      seen.add(stage.key);
      extras.push({
        key: stage.key,
        label: (stage.label || stage.key).trim() || stage.key,
        color: stage.color || "#6B7280",
      });
    }
  }

  return applyPipelineStageLabelOverrides([...defaults, ...extras], labelOverrides);
}

/** Later layers win. Empty strings are ignored. */
export function mergePipelineLabelOverrides(
  ...layers: Array<Record<string, string> | null | undefined>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const layer of layers) {
    if (!layer) continue;
    for (const [key, value] of Object.entries(layer)) {
      const trimmed = value.trim();
      if (trimmed) out[key] = trimmed.slice(0, 80);
    }
  }
  return out;
}

/** Persist only labels that differ from the built-in defaults. */
export function sparsePipelineLabelOverrides(
  labels: Record<string, string> | null | undefined,
): Record<string, string> {
  const allowed = new Set(PROJECT_PIPELINE_STAGE_KEYS);
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(labels ?? {})) {
    if (!allowed.has(key)) continue;
    const value = raw.trim().slice(0, 80);
    const fallback = PROJECT_PIPELINE_STAGES.find((stage) => stage.key === key)?.label;
    if (value && value !== fallback) out[key] = value;
  }
  return out;
}

export function pipelineStageFilterOptions(stages: readonly PipelineStageDef[]) {
  return [
    { value: "", label: "All Status" },
    ...stages.map((stage) => ({ value: stage.key, label: stage.label })),
  ];
}

/** Apply display-label overrides without changing stage keys. */
export function applyPipelineStageLabelOverrides(
  stages: PipelineStageDef[],
  labelOverrides?: Record<string, string> | null,
): PipelineStageDef[] {
  if (!labelOverrides || Object.keys(labelOverrides).length === 0) {
    return stages.map((s) => ({ ...s }));
  }
  return stages.map((stage) => {
    const override = labelOverrides[stage.key]?.trim();
    return override ? { ...stage, label: override } : { ...stage };
  });
}

/** Extract custom (non-default) stages from either a custom list or a full resolved list. */
export function extractCustomPipelineStages(
  stages?: PipelineStageDef[] | null,
): PipelineStageDef[] {
  if (!stages?.length) return [];
  const defaultKeys = new Set(PROJECT_PIPELINE_STAGE_KEYS);
  const seen = new Set<string>();
  const customs: PipelineStageDef[] = [];
  for (const stage of stages) {
    if (!stage?.key || defaultKeys.has(stage.key) || seen.has(stage.key)) continue;
    if (!PIPELINE_STAGE_KEY_REGEX.test(stage.key)) continue;
    seen.add(stage.key);
    customs.push({
      key: stage.key,
      label: (stage.label || stage.key).trim() || stage.key,
      color: stage.color || "#6B7280",
    });
  }
  return customs;
}

/** Merge custom stages from multiple sources, then resolve against defaults. */
export function mergePipelineStageSources(
  ...sources: Array<PipelineStageDef[] | null | undefined>
): PipelineStageDef[] {
  const customs: PipelineStageDef[] = [];
  const seen = new Set<string>();
  const labels = new Map<string, string>();

  for (const source of sources) {
    if (!source) continue;
    for (const stage of source) {
      if (stage?.key && stage.label?.trim()) {
        labels.set(stage.key, stage.label.trim());
      }
    }
    for (const stage of extractCustomPipelineStages(source)) {
      if (seen.has(stage.key)) continue;
      seen.add(stage.key);
      customs.push(stage);
    }
  }

  return resolvePipelineStages(customs).map((stage) => ({
    ...stage,
    label: labels.get(stage.key) || stage.label,
  }));
}

export function resolveProjectPipelineStages(
  project?: {
    customPipelineStages?: PipelineStageDef[] | null;
    pipelineStageLabelOverrides?: Record<string, string> | null;
    hiddenPipelineStageKeys?: string[] | null;
    pipelineStageOrder?: string[] | null;
  } | null,
  orgLabelOverrides?: Record<string, string> | null,
) {
  const stages = resolvePipelineStages(
    project?.customPipelineStages,
    mergePipelineLabelOverrides(orgLabelOverrides, project?.pipelineStageLabelOverrides),
  );
  const hidden = new Set(
    (project?.hiddenPipelineStageKeys ?? []).filter(
      (key) => key !== "new" && key !== "finished",
    ),
  );
  const visible = hidden.size === 0 ? stages : stages.filter((stage) => !hidden.has(stage.key));
  return applyPipelineStageOrder(visible, project?.pipelineStageOrder);
}

/** Reorder resolved stages using a stored key order (unknown keys appended). */
export function applyPipelineStageOrder(
  stages: PipelineStageDef[],
  order?: string[] | null,
): PipelineStageDef[] {
  if (!order?.length) return stages.map((s) => ({ ...s }));

  const byKey = new Map(stages.map((stage) => [stage.key, stage]));
  const ordered: PipelineStageDef[] = [];
  const seen = new Set<string>();

  for (const key of order) {
    const stage = byKey.get(key);
    if (!stage || seen.has(key)) continue;
    ordered.push({ ...stage });
    seen.add(key);
  }

  for (const stage of stages) {
    if (seen.has(stage.key)) continue;
    ordered.push({ ...stage });
  }

  return ordered;
}

/** Move a stage one slot left (-1) or right (+1). Returns null if move is not possible. */
export function movePipelineStageOrder(
  stageKeys: string[],
  key: string,
  direction: "left" | "right",
): string[] | null {
  const index = stageKeys.indexOf(key);
  if (index < 0) return null;
  const target = direction === "left" ? index - 1 : index + 1;
  if (target < 0 || target >= stageKeys.length) return null;
  const next = [...stageKeys];
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved!);
  return next;
}

/** Core stages that cannot be removed from a project board. */
export const PROTECTED_PIPELINE_STAGE_KEYS = ["new", "finished"] as const;

export function isPipelineStageDeletable(key: string) {
  return !(PROTECTED_PIPELINE_STAGE_KEYS as readonly string[]).includes(key);
}

export function isCustomPipelineStageKey(key: string) {
  return !PROJECT_PIPELINE_STAGE_KEYS.includes(key);
}

export function slugifyPipelineStageLabel(label: string): string {
  const base = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_")
    .slice(0, 48);
  const slug = base && /^[a-z]/.test(base) ? base : `section_${base || "new"}`;
  return slug.slice(0, 64);
}

export function createPipelineStageKey(
  label: string,
  existingKeys: Iterable<string>,
): string {
  const used = new Set(existingKeys);
  const base = slugifyPipelineStageLabel(label);
  if (!used.has(base)) return base;
  let i = 2;
  while (used.has(`${base}_${i}`)) i += 1;
  return `${base}_${i}`.slice(0, 64);
}

export function nextCustomStageColor(customCount: number): string {
  return CUSTOM_PIPELINE_STAGE_COLORS[customCount % CUSTOM_PIPELINE_STAGE_COLORS.length]!;
}

export function findPipelineStage(
  stageKey: string | null | undefined,
  stages: readonly PipelineStageDef[] = PROJECT_PIPELINE_STAGES,
): PipelineStageDef | undefined {
  if (!stageKey) return stages.find((s) => s.key === "new");
  return stages.find((s) => s.key === stageKey);
}

export function pipelineStageLabel(
  stage?: string | null,
  stages: readonly PipelineStageDef[] = PROJECT_PIPELINE_STAGES,
): string {
  if (!stage) return "To Do";
  return findPipelineStage(stage, stages)?.label ?? stage;
}

export function pipelineStageColor(
  stage?: string | null,
  stages: readonly PipelineStageDef[] = PROJECT_PIPELINE_STAGES,
): string {
  if (!stage) return "#6B7280";
  return findPipelineStage(stage, stages)?.color ?? "#6B7280";
}

export function contrastingTextOnColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.62 ? "#1F2937" : "#FFFFFF";
}

export const kanbanStageLabel = pipelineStageLabel;
export const kanbanStageColor = pipelineStageColor;

export function normalizeTaskStage(stage?: string | null): string {
  if (!stage) return "new";
  if (PROJECT_PIPELINE_STAGES.some((s) => s.key === stage)) return stage;
  // Preserve project custom section keys
  if (PIPELINE_STAGE_KEY_REGEX.test(stage)) return stage;
  return "new";
}

export function legacyStatusToStage(status: string): string {
  switch (status) {
    case "in_progress":
      return "in_developing";
    case "review":
      return "in_qa_1st_round";
    case "done":
      return "finished";
    default:
      return "new";
  }
}

export function taskPipelineStage(task: { stage?: string | null; status?: string }): string {
  // Status "done" always maps to Finished, even if an older stage value is still stored.
  if (task.status === "done") return "finished";
  if (task.stage) return normalizeTaskStage(task.stage);
  return legacyStatusToStage(task.status ?? "todo");
}

export function isCompletedTask(task: { stage?: string | null; status?: string }) {
  return task.status === "done" || taskPipelineStage(task) === "finished";
}

/** Coarse All Tasks / analytics status filter buckets → pipeline stages. */
export const STATUS_FILTER_STAGE_KEYS = {
  todo: ["new"] as const,
  in_progress: ["in_designing", "in_developing", "in_qa_1st_round"] as const,
  review: [
    "backlog",
    "client_1st_round",
    "backlog_from_client",
    "client_2nd_round",
  ] as const,
  /** Finished / Done, plus Publish Live (after client rounds). */
  done: ["finished", "publish_live"] as const,
} as const;

export type TaskStatusFilterKey = keyof typeof STATUS_FILTER_STAGE_KEYS;

/**
 * Match a task to an All Statuses filter option.
 * Uses pipeline stage first (kanban columns), with legacy status as fallback via taskPipelineStage.
 *
 * - To Do → new / To Do
 * - In Progress → In Designing, In Developing, In QA
 * - Review → Backlog, Client (1st), Backlog from Client, Client (2nd)
 * - Done → Finished / Done (and Publish Live)
 */
export function taskMatchesStatusFilter(
  task: { stage?: string | null; status?: string },
  filter: string,
): boolean {
  if (!filter) return true;
  if (!(filter in STATUS_FILTER_STAGE_KEYS)) {
    return taskPipelineStage(task) === filter || task.status === filter;
  }

  const key = filter as TaskStatusFilterKey;
  const stage = taskPipelineStage(task);

  if (key === "done") {
    return (
      task.status === "done" ||
      stage === "finished" ||
      stage === "publish_live"
    );
  }

  // Completed tasks only appear under Done.
  if (isCompletedTask(task)) return false;

  return (STATUS_FILTER_STAGE_KEYS[key] as readonly string[]).includes(stage);
}

/** True when an update is marking the task complete (Done status or Finished stage). */
export function isMarkingTaskComplete(update: {
  status?: string | null;
  stage?: string | null;
}): boolean {
  return update.status === "done" || update.stage === "finished";
}

/** Matches the kanban "To Do" column. */
export function isTodoTask(task: { stage?: string | null; status?: string }) {
  if (isCompletedTask(task)) return false;
  return taskPipelineStage(task) === "new";
}

export function countTodoTasks(tasks: { stage?: string | null; status?: string }[]) {
  return tasks.filter(isTodoTask).length;
}

export function countCompletedTasks(tasks: { stage?: string | null; status?: string }[]) {
  return tasks.filter(isCompletedTask).length;
}

/** Same bucketing rules as kanban columns (To Do / Finished special-cased). */
export function taskBelongsToPipelineColumn(
  task: { stage?: string | null; status?: string },
  columnKey: string,
) {
  if (columnKey === "new") return isTodoTask(task);
  if (columnKey === "finished") return isCompletedTask(task);
  return taskPipelineStage(task) === columnKey && !isCompletedTask(task);
}

export function tasksForPipelineColumn<T extends { stage?: string | null; status?: string }>(
  tasks: T[],
  columnKey: string,
) {
  return tasks.filter((task) => taskBelongsToPipelineColumn(task, columnKey));
}

/** Append synthetic columns for task stages not present in the provided stage list. */
export function withOrphanPipelineStages<T extends { stage?: string | null; status?: string }>(
  stages: readonly PipelineStageDef[],
  tasks: T[],
): PipelineStageDef[] {
  const result = stages.map((s) => ({ ...s }));
  const known = new Set(result.map((s) => s.key));

  for (const task of tasks) {
    if (isTodoTask(task) || isCompletedTask(task)) continue;
    const key = taskPipelineStage(task);
    if (known.has(key)) continue;
    known.add(key);
    result.push({
      key,
      label: pipelineStageLabel(key),
      color: pipelineStageColor(key),
    });
  }

  return result;
}
