import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, authedQuery } from "./middleware";
import { assertPlanFeature } from "./lib/plan-guard";
import { isAuthDisabled } from "./lib/dev-mode";
import * as mock from "./lib/mock-store";
import {
  getCollection,
  insertDoc,
  findById,
  updateById,
  countDocs,
  hasMongoConfigured,
} from "./queries/connection";
import { Collections } from "@db/mongo/collections";
import type { SafeUser, SubtaskDoc, TaskDoc } from "@db/mongo/types";
import { ensureSchema } from "./lib/migrate";
import { belongsToUserOrg } from "./lib/tenant";

function useMock() {
  return isAuthDisabled() || !hasMongoConfigured();
}

async function requireTask(user: SafeUser, taskId: number) {
  const task = await findById<TaskDoc>(Collections.tasks, taskId);
  if (!task || !belongsToUserOrg(user, task.organizationId)) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Task not found" });
  }
  return task;
}

export const subtaskRouter = createRouter({
  create: authedQuery
    .input(z.object({ taskId: z.number(), title: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      await assertPlanFeature(ctx.user, "tasks");
      if (useMock()) {
        return mock.mockCreateSubtask(input.taskId, input.title, ctx.user);
      }

      await ensureSchema();
      await requireTask(ctx.user, input.taskId);
      const position = await countDocs(Collections.subtasks, { taskId: input.taskId });
      return insertDoc<SubtaskDoc>(Collections.subtasks, {
        taskId: input.taskId,
        title: input.title,
        completed: false,
        position,
        createdAt: new Date(),
      });
    }),

  toggle: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await assertPlanFeature(ctx.user, "tasks");
      if (useMock()) {
        return mock.mockToggleSubtask(input.id);
      }

      await ensureSchema();
      const existing = await findById<SubtaskDoc>(Collections.subtasks, input.id);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Checklist item not found" });
      await requireTask(ctx.user, existing.taskId);

      return updateById<SubtaskDoc>(Collections.subtasks, input.id, {
        completed: !existing.completed,
      });
    }),

  delete: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await assertPlanFeature(ctx.user, "tasks");
      if (useMock()) {
        return mock.mockDeleteSubtask(input.id);
      }

      await ensureSchema();
      const existing = await findById<SubtaskDoc>(Collections.subtasks, input.id);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Checklist item not found" });
      await requireTask(ctx.user, existing.taskId);
      const col = await getCollection<SubtaskDoc>(Collections.subtasks);
      await col.deleteOne({ id: input.id });
      return { success: true };
    }),
});
