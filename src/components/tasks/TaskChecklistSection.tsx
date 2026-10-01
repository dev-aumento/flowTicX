import { useState } from "react";
import { Check, ListChecks, Loader2, Plus, Trash2 } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { cn } from "@/lib/utils";

export type TaskChecklistItem = {
  id: number;
  title: string;
  completed: boolean;
  position?: number;
};

export function TaskChecklistSection({
  taskId,
  items,
  canEdit,
}: {
  taskId: number;
  items: TaskChecklistItem[];
  canEdit: boolean;
}) {
  const utils = trpc.useUtils();
  const [draft, setDraft] = useState("");
  const ordered = [...items].sort(
    (a, b) => (a.position ?? a.id) - (b.position ?? b.id) || a.id - b.id,
  );
  const done = ordered.filter((item) => item.completed).length;

  const refresh = async () => {
    await Promise.all([
      utils.task.getById.invalidate({ id: taskId }),
      utils.task.list.invalidate(),
    ]);
  };

  const createItem = trpc.subtask.create.useMutation({
    onSuccess: async () => {
      setDraft("");
      await refresh();
    },
  });
  const toggleItem = trpc.subtask.toggle.useMutation({
    onMutate: async ({ id }) => {
      await utils.task.getById.cancel({ id: taskId });
      const previous = utils.task.getById.getData({ id: taskId });
      utils.task.getById.setData({ id: taskId }, (current) => {
        if (!current?.subtasks) return current;
        return {
          ...current,
          subtasks: current.subtasks.map((item) =>
            item.id === id ? { ...item, completed: !item.completed } : item,
          ),
        };
      });
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous) {
        utils.task.getById.setData({ id: taskId }, context.previous);
      }
    },
    onSettled: () => {
      void refresh();
    },
  });
  const deleteItem = trpc.subtask.delete.useMutation({
    onSuccess: () => {
      void refresh();
    },
  });

  if (!canEdit && ordered.length === 0) return null;

  const addItem = () => {
    const title = draft.trim();
    if (!title || createItem.isPending) return;
    createItem.mutate({ taskId, title });
  };

  return (
    <section className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-100">
        <div className="flex items-center gap-2 min-w-0">
          <ListChecks size={16} className="shrink-0 text-[#2563EB]" />
          <h3 className="text-sm font-semibold text-[#1F2937]">Checklist</h3>
        </div>
        {ordered.length > 0 ? (
          <span className="text-xs font-medium text-gray-500 tabular-nums">
            {done}/{ordered.length}
          </span>
        ) : null}
      </div>

      {ordered.length > 0 ? (
        <div className="h-1 bg-gray-100">
          <div
            className="h-full bg-[#2563EB] transition-[width]"
            style={{ width: `${Math.round((done / ordered.length) * 100)}%` }}
          />
        </div>
      ) : null}

      <ul className="divide-y divide-gray-100">
        {ordered.map((item) => (
          <li key={item.id} className="group flex items-start gap-2 px-3 py-2.5">
            <button
              type="button"
              disabled={!canEdit || toggleItem.isPending}
              onClick={() => toggleItem.mutate({ id: item.id })}
              aria-pressed={item.completed}
              aria-label={item.completed ? `Mark "${item.title}" not done` : `Mark "${item.title}" done`}
              className={cn(
                "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
                item.completed
                  ? "border-[#2563EB] bg-[#2563EB] text-white"
                  : "border-gray-300 bg-white text-transparent hover:border-[#2563EB]",
                !canEdit && "cursor-default",
              )}
            >
              <Check size={12} strokeWidth={3} />
            </button>
            <span
              className={cn(
                "min-w-0 flex-1 text-sm leading-5 text-[#1F2937]",
                item.completed && "text-gray-400 line-through",
              )}
            >
              {item.title}
            </span>
            {canEdit ? (
              <button
                type="button"
                onClick={() => deleteItem.mutate({ id: item.id })}
                disabled={deleteItem.isPending}
                aria-label={`Remove "${item.title}"`}
                className="mt-0.5 rounded p-1 text-gray-300 opacity-0 transition-opacity hover:bg-red-50 hover:text-red-500 group-hover:opacity-100 focus:opacity-100"
              >
                <Trash2 size={14} />
              </button>
            ) : null}
          </li>
        ))}
      </ul>

      {canEdit ? (
        <form
          className="flex items-center gap-2 border-t border-gray-100 px-3 py-2.5"
          onSubmit={(event) => {
            event.preventDefault();
            addItem();
          }}
        >
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={ordered.length === 0 ? "Add the first checklist item" : "Add an item"}
            className="h-9 min-w-0 flex-1 rounded-lg border border-gray-200 px-3 text-sm outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20"
          />
          <button
            type="submit"
            disabled={!draft.trim() || createItem.isPending}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#2563EB] px-3 text-sm font-medium text-white hover:bg-[#1D4ED8] disabled:opacity-50"
          >
            {createItem.isPending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            Add
          </button>
        </form>
      ) : null}
    </section>
  );
}
