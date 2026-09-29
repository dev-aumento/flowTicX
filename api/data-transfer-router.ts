import { z } from "zod";
import { createRouter, authedQuery } from "./middleware";
import { requireOrganizationId } from "./lib/tenant";
import {
  assertCanManageData,
  exportDataset,
  importDataset,
  listDataTransferLogs,
} from "./lib/data-transfer";

const datasetSchema = z.enum(["projects", "tasks", "hours"]);
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

  export: authedQuery
    .input(z.object({ dataset: datasetSchema, format: formatSchema }))
    .mutation(async ({ ctx, input }) => exportDataset(ctx.user, input.dataset, input.format)),

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
