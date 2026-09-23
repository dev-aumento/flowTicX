import { useMemo, useRef } from "react";

/**
 * Keeps list item positions stable when only read/status fields change.
 * New items (by id) are inserted at the top; existing items keep their slot.
 */
export function useStableIdOrder<T extends { id: number }>(
  items: T[],
  sortNewItems: (a: T, b: T) => number,
): T[] {
  const orderRef = useRef<number[]>([]);

  return useMemo(() => {
    if (items.length === 0) {
      orderRef.current = [];
      return [];
    }

    const byId = new Map(items.map((item) => [item.id, item]));
    const known = new Set(orderRef.current);

    const newcomers = items
      .filter((item) => !known.has(item.id))
      .sort(sortNewItems)
      .map((item) => item.id);

    const nextOrder = [
      ...newcomers,
      ...orderRef.current.filter((id) => byId.has(id)),
    ];

    orderRef.current = nextOrder;
    return nextOrder
      .map((id) => byId.get(id))
      .filter((item): item is T => item != null);
  }, [items, sortNewItems]);
}

type TaskChatOrderItem = {
  taskId: number;
  lastAt: Date;
};

/**
 * Task chats: new tasks go to the top; a task moves up only when lastAt increases
 * (new activity). Marking read alone does not change position.
 */
export function useStableTaskChatOrder<T extends TaskChatOrderItem>(chats: T[]): T[] {
  const orderRef = useRef<number[]>([]);
  const lastAtRef = useRef<Map<number, number>>(new Map());

  return useMemo(() => {
    if (chats.length === 0) {
      orderRef.current = [];
      lastAtRef.current = new Map();
      return [];
    }

    const byTaskId = new Map(chats.map((chat) => [chat.taskId, chat]));
    let order = orderRef.current.filter((taskId) => byTaskId.has(taskId));

    for (const chat of chats) {
      const lastAtMs = chat.lastAt.getTime();
      const prevLastAt = lastAtRef.current.get(chat.taskId);
      const inOrder = order.includes(chat.taskId);

      if (!inOrder) continue;

      if (prevLastAt != null && lastAtMs > prevLastAt) {
        order = [chat.taskId, ...order.filter((id) => id !== chat.taskId)];
      }
    }

    const orderSet = new Set(order);
    const newcomers = chats
      .filter((chat) => !orderSet.has(chat.taskId))
      .sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime())
      .map((chat) => chat.taskId);

    const nextOrder = [...newcomers, ...order];
    orderRef.current = nextOrder;

    const nextLastAt = new Map<number, number>();
    for (const chat of chats) {
      nextLastAt.set(chat.taskId, chat.lastAt.getTime());
    }
    lastAtRef.current = nextLastAt;

    return nextOrder
      .map((taskId) => byTaskId.get(taskId))
      .filter((chat): chat is T => chat != null);
  }, [chats]);
}
