import { z } from "zod";
import { createRouter, authedQuery } from "./middleware";
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
import type { SubtaskDoc } from "@db/mongo/types";
import { ensureSchema } from "./lib/migrate";

function useMock() {
  return isAuthDisabled() || !hasMongoConfigured();
}

export const subtaskRouter = createRouter({
  create: authedQuery
    .input(z.object({ taskId: z.number(), title: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      if (useMock()) {
        return mock.mockCreateSubtask(input.taskId, input.title, ctx.user);
      }

      await ensureSchema();
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
    .mutation(async ({ input }) => {
      await ensureSchema();
      const existing = await findById<SubtaskDoc>(Collections.subtasks, input.id);
      if (!existing) throw new Error("Subtask not found");

      return updateById<SubtaskDoc>(Collections.subtasks, input.id, {
        completed: !existing.completed,
      });
    }),

  delete: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await ensureSchema();
      const col = await getCollection<SubtaskDoc>(Collections.subtasks);
      await col.deleteOne({ id: input.id });
      return { success: true };
    }),
});
