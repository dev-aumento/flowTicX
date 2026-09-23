import { trpc } from "@/providers/trpc";
import {
  PROJECT_PIPELINE_STAGES,
  type PipelineStageDef,
} from "@/lib/task-kanban";

export const PIPELINE_STAGE_LABELS_QUERY_OPTIONS = {
  staleTime: 15_000,
  refetchInterval: 15_000,
  refetchOnWindowFocus: true,
} as const;

const DEFAULT_STAGES: PipelineStageDef[] = PROJECT_PIPELINE_STAGES.map((stage) => ({
  ...stage,
}));

export function useOrgPipelineStages(): PipelineStageDef[] {
  const { data } = trpc.organization.getPipelineStageLabels.useQuery(
    undefined,
    PIPELINE_STAGE_LABELS_QUERY_OPTIONS,
  );
  return data?.stages ?? DEFAULT_STAGES;
}

export function useOrgPipelineLabelOverrides(): Record<string, string> {
  const { data } = trpc.organization.getPipelineStageLabels.useQuery(
    undefined,
    PIPELINE_STAGE_LABELS_QUERY_OPTIONS,
  );
  return data?.overrides ?? {};
}
