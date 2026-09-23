import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { createContext } from "./context";
import { getLatestNotificationId, listNotificationsSince } from "./lib/notifications-feed";
import { isHrDepartmentUser, isTaskRelatedNotification } from "@/lib/leave-policy";

const POLL_MS = 5_000;

export async function notificationStreamHandler(c: Context) {
  const ctx = await createContext({
    req: c.req.raw,
    resHeaders: c.res.headers,
  });

  if (!ctx.user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const userId = ctx.user.id;
  const hideTaskNotifications = isHrDepartmentUser(ctx.user);

  return streamSSE(c, async (stream) => {
    let lastId = await getLatestNotificationId(userId);
    let closed = false;

    const onAbort = () => {
      closed = true;
    };
    c.req.raw.signal.addEventListener("abort", onAbort);

    try {
      await stream.writeSSE({
        data: JSON.stringify({ type: "connected", lastId }),
      });

      while (!closed) {
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        if (closed) break;

        const incoming = await listNotificationsSince(userId, lastId, ctx.user);
        if (incoming.length > 0) {
          lastId = Math.max(lastId, ...incoming.map((n) => n.id));
          const notifications = hideTaskNotifications
            ? incoming.filter((n) => !isTaskRelatedNotification(n))
            : incoming;
          if (notifications.length > 0) {
            await stream.writeSSE({
              data: JSON.stringify({
                type: "notifications",
                notifications,
              }),
            });
          } else {
            await stream.writeSSE({ data: JSON.stringify({ type: "ping" }) });
          }
        } else {
          await stream.writeSSE({ data: JSON.stringify({ type: "ping" }) });
        }
      }
    } finally {
      c.req.raw.signal.removeEventListener("abort", onAbort);
    }
  });
}
