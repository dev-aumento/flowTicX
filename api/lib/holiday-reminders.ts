import { Collections } from "@db/mongo/collections";
import type { NotificationDoc, PublicHolidayDoc, UserDoc } from "@db/mongo/types";
import { workZoneDateKey } from "@/lib/timezone";
import { getCollection, insertDoc, hasMongoConfigured } from "../queries/connection";
import { ensureSchema } from "./migrate";
import { isAuthDisabled } from "./dev-mode";

/** Holidays from today through the next 7 calendar days (inclusive). */
const HOLIDAY_REMINDER_WINDOW_DAYS = 7;
const HOLIDAY_REMINDER_INTERVAL_MS = 60 * 60 * 1000; // hourly

function useMock() {
  return isAuthDisabled() || !hasMongoConfigured();
}

function addDaysToDateKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  if (!y || !m || !d) return dateKey;
  const base = Date.UTC(y, m - 1, d) + days * 86_400_000;
  const next = new Date(base);
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
}

function dayOrdinal(day: number): string {
  const j = day % 10;
  const k = day % 100;
  if (j === 1 && k !== 11) return `${day}st`;
  if (j === 2 && k !== 12) return `${day}nd`;
  if (j === 3 && k !== 13) return `${day}rd`;
  return `${day}th`;
}

export function formatHolidayReminderMessage(holiday: {
  name: string;
  date: string;
}): string {
  const [y, m, d] = holiday.date.split("-").map(Number);
  const day = d || 1;
  const monthLabel =
    Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d)
      ? new Date(Date.UTC(y, m - 1, 12)).toLocaleString("en-IN", {
          month: "long",
          timeZone: "UTC",
        })
      : "upcoming";

  return `The upcoming holiday is on ${dayOrdinal(day)} ${monthLabel} which is ${holiday.name}.`;
}

export async function runHolidayReminderJob(now = new Date()) {
  if (useMock()) return { sent: 0, holidays: 0 };

  await ensureSchema();

  const todayKey = workZoneDateKey(now);
  const windowEndKey = addDaysToDateKey(todayKey, HOLIDAY_REMINDER_WINDOW_DAYS);

  const holidayCol = await getCollection<PublicHolidayDoc>(Collections.publicHolidays);
  const holidays = await holidayCol
    .find({
      date: { $gte: todayKey, $lte: windowEndKey },
    })
    .sort({ date: 1 })
    .toArray();

  if (holidays.length === 0) return { sent: 0, holidays: 0 };

  const usersCol = await getCollection<UserDoc>(Collections.users);
  const employees = await usersCol.find({ status: "active" }).toArray();
  if (employees.length === 0) return { sent: 0, holidays: holidays.length };

  const notifCol = await getCollection<NotificationDoc>(Collections.notifications);
  const nowTs = new Date();
  let sent = 0;

  for (const holiday of holidays) {
    const message = formatHolidayReminderMessage(holiday);
    const title = "Upcoming public holiday";
    const orgEmployees = employees.filter(
      (u) => u.organizationId != null && u.organizationId === holiday.organizationId,
    );

    for (const user of orgEmployees) {
      const existing = await notifCol.findOne({
        userId: user.id,
        type: "holiday_reminder",
        holidayId: holiday.id,
      });
      if (existing) continue;

      await insertDoc<NotificationDoc>(Collections.notifications, {
        userId: user.id,
        organizationId: holiday.organizationId ?? user.organizationId,
        actorId: null,
        type: "holiday_reminder",
        title,
        message,
        taskId: null,
        projectId: null,
        activityId: null,
        leaveRequestId: null,
        holidayId: holiday.id,
        read: false,
        createdAt: nowTs,
      });
      sent += 1;
    }
  }

  return { sent, holidays: holidays.length };
}

let schedulerStarted = false;

export function startHolidayReminderScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;

  const tick = () => {
    void runHolidayReminderJob().catch((error) => {
      console.error("[holiday-reminder] job failed:", error);
    });
  };

  // Delay first run slightly so boot / ensureSchema can settle.
  setTimeout(tick, 15_000);
  setInterval(tick, HOLIDAY_REMINDER_INTERVAL_MS);
}
