import type { TaskDoc } from "@db/mongo/types";
import {
  isCompletedTask,
  isTodoTask,
} from "@/lib/task-kanban";

type TaskCountFields = Pick<TaskDoc, "status" | "stage">;

/** Dashboard "Ongoing / To Do" — matches All Tasks & status Kanban (`status === "todo"`). */
export function countTodoTasks(tasks: Pick<TaskCountFields, "status">[]) {
  return tasks.filter((t) => t.status === "todo").length;
}

/** Dashboard "Completed" — matches `status === "done"`. */
export function countCompletedTasks(tasks: Pick<TaskCountFields, "status">[]) {
  return tasks.filter((t) => t.status === "done").length;
}

export { isCompletedTask, isTodoTask };

export type { TaskCountFields };
