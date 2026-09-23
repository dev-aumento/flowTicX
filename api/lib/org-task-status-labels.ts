import { isAuthDisabled } from "./dev-mode";
import { hasMongoConfigured } from "../queries/connection";
import { findOrganizationById } from "./tenant";
import { mockGetTaskStatusLabels, mockGetPipelineStageLabels } from "./mock-store";
import {
  mergeTaskStatusLabels,
  type TaskStatusLabels,
} from "@/lib/task-status-labels";
import { resolveProjectPipelineStages, sparsePipelineLabelOverrides } from "@/lib/task-kanban";

export async function loadOrgTaskStatusLabels(orgId: number): Promise<TaskStatusLabels> {
  if (isAuthDisabled() || !hasMongoConfigured()) {
    return mergeTaskStatusLabels(mockGetTaskStatusLabels());
  }
  const org = await findOrganizationById(orgId);
  return mergeTaskStatusLabels(org?.taskStatusLabels);
}

export async function loadOrgPipelineStageLabels(
  orgId: number,
): Promise<Record<string, string>> {
  if (isAuthDisabled() || !hasMongoConfigured()) {
    return sparsePipelineLabelOverrides(mockGetPipelineStageLabels());
  }
  const org = await findOrganizationById(orgId);
  return sparsePipelineLabelOverrides(org?.pipelineStageLabelOverrides);
}

export async function resolveTenantProjectPipelineStages(
  orgId: number,
  project?: Parameters<typeof resolveProjectPipelineStages>[0],
) {
  const orgOverrides = await loadOrgPipelineStageLabels(orgId);
  return resolveProjectPipelineStages(project, orgOverrides);
}
