import { describe, expect, it } from "vitest";
import {
  applyKanbanReorder,
  kanbanPositionUpdates,
  reorderColumnIds,
  sortKanbanTasks,
} from "./kanban-dnd";

describe("kanban drop order", () => {
  it("inserts a card at the pointer index inside the same column", () => {
    expect(reorderColumnIds([1, 2, 3, 4], 2, 0)).toEqual([2, 1, 3, 4]);
    expect(reorderColumnIds([1, 2, 3, 4], 2, 3)).toEqual([1, 3, 4, 2]);
    expect(kanbanPositionUpdates([1, 2, 3, 4], [1, 2, 3, 4], 1, 3, "new", "new")).toEqual([
      { id: 2, position: 0 },
      { id: 3, position: 1 },
      { id: 4, position: 2 },
      { id: 1, position: 3 },
    ]);
  });

  it("leaves the column unchanged when the card is dropped in its current slot", () => {
    expect(kanbanPositionUpdates([1, 2, 3], [1, 2, 3], 2, 1, "new", "new")).toEqual([]);
  });

  it("moves a card into another column at the drop index", () => {
    expect(kanbanPositionUpdates([1, 2], [10, 11], 2, 1, "new", "in_developing")).toEqual([
      { id: 1, position: 0 },
      { id: 10, position: 0 },
      { id: 2, position: 1, stage: "in_developing" },
      { id: 11, position: 2 },
    ]);
  });

  it("sorts a column by position and keeps the current list order when positions tie", () => {
    const listOrder = new Map([
      [3, 0],
      [1, 1],
      [2, 2],
    ]);
    const sorted = sortKanbanTasks(
      [
        { id: 1, position: 0 },
        { id: 2, position: 0 },
        { id: 3, position: 1 },
      ],
      listOrder,
    );
    expect(sorted.map((task) => task.id)).toEqual([1, 2, 3]);
  });

  it("places a dropped card in its new column and order", () => {
    const next = applyKanbanReorder(
      [
        { id: 1, position: 0, stage: "new", status: "todo" },
        { id: 2, position: 1, stage: "new", status: "todo" },
        { id: 3, position: 0, stage: "in_developing", status: "in_progress" },
      ],
      [
        { id: 1, position: 0 },
        { id: 3, position: 0 },
        { id: 2, position: 1, stage: "in_developing" },
      ],
    );
    expect(next.find((task) => task.id === 2)).toMatchObject({
      position: 1,
      stage: "in_developing",
      status: "todo",
    });
  });
});
