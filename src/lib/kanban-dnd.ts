export const KANBAN_EDGE_PX = 80;
export const KANBAN_SCROLL_MAX_PX = 14;

export type KanbanReorderItem = {
  id: number;
  position: number;
  stage?: string;
};

/** Pixels to add to scrollTop this frame. Negative scrolls up. */
export function columnScrollDelta(scrollEl: HTMLElement, clientX: number, clientY: number) {
  const column = scrollEl.closest("[data-kanban-column]");
  const bounds = (column ?? scrollEl).getBoundingClientRect();
  if (clientX < bounds.left || clientX > bounds.right) return 0;
  if (clientY < bounds.top - 12 || clientY > bounds.bottom + 12) return 0;
  if (scrollEl.scrollHeight <= scrollEl.clientHeight + 1) return 0;

  const view = scrollEl.getBoundingClientRect();
  const edge = Math.min(KANBAN_EDGE_PX, Math.max(48, view.height * 0.3));

  if (clientY < view.top + edge) {
    const depth = (view.top + edge - clientY) / edge;
    const intensity = clientY <= view.top ? 1 : Math.min(1, Math.max(0.45, depth));
    return -Math.round(KANBAN_SCROLL_MAX_PX * intensity);
  }
  if (clientY > view.bottom - edge) {
    const depth = (clientY - (view.bottom - edge)) / edge;
    const intensity = clientY >= view.bottom ? 1 : Math.min(1, Math.max(0.45, depth));
    return Math.round(KANBAN_SCROLL_MAX_PX * intensity);
  }
  return 0;
}

export function columnKeyAtPoint(board: ParentNode, clientX: number, clientY: number) {
  const columns = board.querySelectorAll<HTMLElement>("[data-kanban-column]");
  for (const column of columns) {
    const rect = column.getBoundingClientRect();
    if (clientX < rect.left || clientX > rect.right) continue;
    if (clientY < rect.top - 12 || clientY > rect.bottom + 12) continue;
    const key = column.dataset.kanbanColumnKey;
    if (key) return key;
  }
  return null;
}

/** Index among cards other than the one being dragged. */
export function dropIndexInColumn(
  scrollEl: HTMLElement | null | undefined,
  clientY: number,
  draggedId: number,
) {
  if (!scrollEl) return 0;
  const cards = [...scrollEl.querySelectorAll<HTMLElement>("[data-kanban-card]")].filter(
    (card) => Number(card.dataset.kanbanCard) !== draggedId,
  );
  for (let index = 0; index < cards.length; index += 1) {
    const rect = cards[index].getBoundingClientRect();
    if (rect.height <= 0) continue;
    if (clientY < rect.top + rect.height / 2) return index;
  }
  return cards.length;
}

export function reorderColumnIds(ids: number[], draggedId: number, insertAt: number) {
  const next = ids.filter((id) => id !== draggedId);
  const index = Math.max(0, Math.min(insertAt, next.length));
  next.splice(index, 0, draggedId);
  return next;
}

export function kanbanPositionUpdates(
  sourceIds: number[],
  targetIds: number[],
  draggedId: number,
  insertAt: number,
  sourceStage: string,
  targetStage: string,
): KanbanReorderItem[] {
  if (sourceStage === targetStage) {
    const next = reorderColumnIds(sourceIds, draggedId, insertAt);
    if (next.length === sourceIds.length && next.every((id, index) => id === sourceIds[index])) {
      return [];
    }
    return next.map((id, position) => ({ id, position }));
  }

  const sourceNext = sourceIds.filter((id) => id !== draggedId);
  const targetBase = targetIds.filter((id) => id !== draggedId);
  const index = Math.max(0, Math.min(insertAt, targetBase.length));
  const targetNext = targetBase.slice();
  targetNext.splice(index, 0, draggedId);

  return [
    ...sourceNext.map((id, position) => ({ id, position })),
    ...targetNext.map((id, position) => ({
      id,
      position,
      ...(id === draggedId ? { stage: targetStage } : {}),
    })),
  ];
}

export function sortKanbanTasks<T extends { id: number; position?: number | null }>(
  tasks: T[],
  listOrder: Map<number, number>,
) {
  return [...tasks].sort((a, b) => {
    const positionA = a.position ?? 0;
    const positionB = b.position ?? 0;
    if (positionA !== positionB) return positionA - positionB;
    return (listOrder.get(a.id) ?? 0) - (listOrder.get(b.id) ?? 0);
  });
}

type ReorderableTask = {
  id: number;
  position?: number | null;
  stage?: string | null;
  status: string;
  assignee?: unknown;
  assigneeId?: number | null;
};

/** Apply a kanban drop to the in-memory task list (column + order). */
export function applyKanbanReorder<T extends ReorderableTask>(
  tasks: T[],
  items: KanbanReorderItem[],
): T[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  return tasks.map((task) => {
    const next = byId.get(task.id);
    if (!next) return task;
    const updated: T = { ...task, position: next.position };
    if (!next.stage || next.stage === task.stage) return updated;
    if (next.stage === "finished") {
      return {
        ...updated,
        stage: next.stage,
        status: "done" as T["status"],
        assignee: null,
        assigneeId: null,
      };
    }
    if (task.status === "done") {
      return { ...updated, stage: next.stage, status: "in_progress" as T["status"] };
    }
    return { ...updated, stage: next.stage };
  });
}
