import { z } from "zod";
import { createRouter, authedQuery } from "./middleware";
import { requireOrganizationId } from "./lib/tenant";
import {
  assertCanManageData,
  confirmExport,
  exportDataset,
  importDataset,
  listDataTransferLogs,
  listExportChoices,
} from "./lib/data-transfer";

const datasetSchema = z.enum(["projects", "tasks", "hours", "clients"]);
const formatSchema = z.enum(["csv", "pdf", "docx"]);

export const dataTransferRouter = createRouter({
  logs: authedQuery.query(async ({ ctx }) => {
    assertCanManageData(ctx.user);
    const organizationId = requireOrganizationId(ctx.user);
    const logs = await listDataTransferLogs(organizationId);
    return logs.map((log) => ({
      id: log.id,
      userName: log.userName,
      action: log.action,
      dataset: log.dataset,
      format: log.format,
      fileName: log.fileName,
      rowCount: log.rowCount,
      createdCount: log.createdCount,
      updatedCount: log.updatedCount,
      skippedCount: log.skippedCount,
      message: log.message,
      createdAt: log.createdAt,
    }));
  }),

  choices: authedQuery.query(async ({ ctx }) => listExportChoices(ctx.user)),

  export: authedQuery
    .input(
      z.object({
        dataset: datasetSchema,
        format: formatSchema,
        scope: z
          .object({
            mode: z.enum(["all", "project", "task", "totals", "client-projects", "client-tasks"]),
            projectId: z.number().int().positive().nullable().optional(),
            taskId: z.number().int().positive().nullable().optional(),
            clientName: z.string().trim().min(1).max(200).nullable().optional(),
          })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      exportDataset(ctx.user, input.dataset, input.format, {
        mode: input.scope?.mode ?? "all",
        projectId: input.scope?.projectId ?? null,
        taskId: input.scope?.taskId ?? null,
        clientName: input.scope?.clientName ?? null,
      }),
    ),

  confirmExport: authedQuery
    .input(
      z.object({
        token: z.string().min(16).max(64),
        fileName: z.string().min(1).max(240).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => confirmExport(ctx.user, input.token, input.fileName)),

  import: authedQuery
    .input(
      z.object({
        dataset: datasetSchema,
        format: formatSchema,
        fileName: z.string().min(1).max(240),
        base64: z.string().min(1).max(12_000_000),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      importDataset(ctx.user, input.dataset, input.format, input.fileName, input.base64),
    ),
});
