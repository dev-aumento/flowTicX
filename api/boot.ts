import "dotenv/config";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { HttpBindings } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./router";
import { createContext } from "./context";
import { env } from "./lib/env";
import { ensureSchema } from "./lib/migrate";
import { hasMongoConfigured } from "./queries/mongo";
import { notificationStreamHandler } from "./notification-stream";
import { startAutoClockOutScheduler } from "./lib/auto-clock-out";
import { startHolidayReminderScheduler } from "./lib/holiday-reminders";
import { startDeadlineReminderScheduler } from "./lib/deadline-reminders";

const app = new Hono<{ Bindings: HttpBindings }>();

app.use(bodyLimit({ maxSize: 1024 * 1024 * 1024 }));
app.get("/api/health", (c) => c.json({ ok: true }));
app.get("/api/notifications/stream", notificationStreamHandler);
app.use("/api/trpc/*", async (c) => {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext,
  });
});
app.all("/api/*", (c) => c.json({ error: "Not Found" }, 404));

export default app;

if (hasMongoConfigured()) {
  const schemaReady = ensureSchema()
    .then(() => {
      console.log("[boot] Mongo schema ready");
    })
    .catch((error) => {
      console.error("[boot] Schema warm-up failed (will retry on first request):", error);
    });

  void schemaReady.finally(() => {
    startAutoClockOutScheduler();
    startHolidayReminderScheduler();
    startDeadlineReminderScheduler();
  });
} else {
  console.log("[boot] Running without a database (in-memory store). Register an account to sign in.");
  startAutoClockOutScheduler();
  startHolidayReminderScheduler();
  startDeadlineReminderScheduler();
}

if (env.isProduction) {
  const { serve } = await import("@hono/node-server");
  const { serveStaticFiles } = await import("./lib/vite");
  serveStaticFiles(app);

  const port = parseInt(process.env.PORT || "3000");
  serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, () => {
    console.log(`Server running on http://0.0.0.0:${port}/`);
  });
}
