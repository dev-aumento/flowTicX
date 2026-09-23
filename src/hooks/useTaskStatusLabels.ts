import { trpc } from "@/providers/trpc";
import {
  DEFAULT_TASK_STATUS_LABELS,
  type TaskStatusLabels,
} from "@/lib/task-status-labels";

export const TASK_STATUS_LABELS_QUERY_OPTIONS = {
  staleTime: 15_000,
  refetchInterval: 15_000,
  refetchOnWindowFocus: true,
} as const;

export function useTaskStatusLabels(): TaskStatusLabels {
  const { data } = trpc.organization.getTaskStatusLabels.useQuery(
    undefined,
    TASK_STATUS_LABELS_QUERY_OPTIONS,
  );
  return data?.labels ?? DEFAULT_TASK_STATUS_LABELS;
}
