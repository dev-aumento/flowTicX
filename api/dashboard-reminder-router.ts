import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, authedQuery } from "./middleware";
import { ensureSchema } from "./lib/migrate";
import { isAuthDisabled } from "./lib/dev-mode";
import {
  getCollection,
  hasMongoConfigured,
  insertDoc,
  updateById,
} from "./queries/connection";
import { Collections } from "@db/mongo/collections";
import type { DashboardReminderDoc, UserDoc } from "@db/mongo/types";
import { orgFilter, requireOrganizationId } from "./lib/tenant";
import { isAdminOrManagement } from "@/lib/leave-policy";
import { workZoneDateKey } from "@/lib/timezone";

const REMINDER_COLORS = [
  "#2563EB",
  "#10B981",
  "#F59E0B",
  "#8B5CF6",
  "#EC4899",
  "#0EA5E9",
];

function canUseDashboardCalendar(user: {
  role?: string | null;
  department?: string | null;
}) {
  const role = String(user.role ?? "").toLowerCase();
  if (role === "admin" || role === "manager") return true;
  return isAdminOrManagement(user);
}

function assertCalendarAccess(user: {
  role?: string | null;
  department?: string | null;
}) {
  if (!canUseDashboardCalendar(user)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Calendar reminders are available to admins and project managers",
    });
  }
}

const dateKeySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date");

const timeSchema = z
  .string()
  .regex(/^\d{2}:\d{2}$/, "Invalid time")
  .nullable()
  .optional();

type MockReminder = DashboardReminderDoc & { createdByName?: string | null };
const mockReminders: MockReminder[] = [];
let mockNextId = 1;

function useMock() {
  return isAuthDisabled() || !hasMongoConfigured();
}

function toClient(
  doc: DashboardReminderDoc,
  createdByName?: string | null,
) {
  return {
    ...doc,
    createdByName: createdByName ?? null,
    createdAt:
      doc.createdAt instanceof Date ? doc.createdAt.toISOString() : String(doc.createdAt),
    updatedAt:
      doc.updatedAt instanceof Date ? doc.updatedAt.toISOString() : String(doc.updatedAt),
  };
}

function pickColor(index: number) {
  return REMINDER_COLORS[index % REMINDER_COLORS.length];
}

async function withCreatorNames(docs: DashboardReminderDoc[]) {
  if (docs.length === 0) return [];
  const userIds = [...new Set(docs.map((d) => d.userId))];
  const userCol = await getCollection<UserDoc>(Collections.users);
  const users = await userCol
    .find({ id: { $in: userIds } })
    .project({ id: 1, name: 1 })
    .toArray();
  const nameById = new Map(users.map((u) => [u.id, u.name || "Teammate"]));
  return docs.map((doc) => toClient(doc, nameById.get(doc.userId) ?? null));
}

export const dashboardReminderRouter = createRouter({
  listByMonth: authedQuery
    .input(
      z.object({
        year: z.number().int().min(2000).max(2100),
        month: z.number().int().min(1).max(12),
      }),
    )
    .query(async ({ ctx, input }) => {
      assertCalendarAccess(ctx.user);
      const organizationId = ctx.user.organizationId ?? 1;
      const prefix = `${input.year}-${String(input.month).padStart(2, "0")}`;

      if (useMock()) {
        return mockReminders
          .filter(
            (r) =>
              r.organizationId === organizationId &&
              r.dateKey.startsWith(prefix),
          )
          .sort((a, b) =>
            a.dateKey === b.dateKey
              ? String(a.time ?? "").localeCompare(String(b.time ?? ""))
              : a.dateKey.localeCompare(b.dateKey),
          )
          .map((r) => toClient(r, r.createdByName ?? null));
      }

      await ensureSchema();
      const col = await getCollection<DashboardReminderDoc>(
        Collections.dashboardReminders,
      );
      // Shared org calendar — admins & project managers see everyone's entries.
      const docs = await col
        .find({
          ...orgFilter(ctx.user),
          dateKey: { $gte: `${prefix}-01`, $lte: `${prefix}-31` },
        })
        .sort({ dateKey: 1, time: 1 })
        .toArray();
      return withCreatorNames(docs);
    }),

  create: authedQuery
    .input(
      z.object({
        title: z.string().trim().min(1).max(200),
        note: z.string().trim().max(1000).optional().nullable(),
        dateKey: dateKeySchema,
        time: timeSchema,
        color: z.string().trim().max(20).optional().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertCalendarAccess(ctx.user);
      const now = new Date();
      const organizationId = requireOrganizationId(ctx.user);
      const color =
        input.color?.trim() ||
        pickColor(mockReminders.length + ctx.user.id + now.getDate());
      const createdByName = ctx.user.name || "Teammate";

      if (useMock()) {
        const doc: MockReminder = {
          id: mockNextId++,
          organizationId,
          userId: ctx.user.id,
          title: input.title.trim(),
          note: input.note?.trim() || null,
          dateKey: input.dateKey,
          time: input.time ?? null,
          color,
          createdAt: now,
          updatedAt: now,
          createdByName,
        };
        mockReminders.push(doc);
        return toClient(doc, createdByName);
      }

      await ensureSchema();
      const doc = await insertDoc<DashboardReminderDoc>(
        Collections.dashboardReminders,
        {
          organizationId,
          userId: ctx.user.id,
          title: input.title.trim(),
          note: input.note?.trim() || null,
          dateKey: input.dateKey,
          time: input.time ?? null,
          color,
          createdAt: now,
          updatedAt: now,
        },
      );
      return toClient(doc, createdByName);
    }),

  update: authedQuery
    .input(
      z.object({
        id: z.number().int().positive(),
        title: z.string().trim().min(1).max(200).optional(),
        note: z.string().trim().max(1000).optional().nullable(),
        dateKey: dateKeySchema.optional(),
        time: timeSchema,
        color: z.string().trim().max(20).optional().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertCalendarAccess(ctx.user);
      const { id, ...rest } = input;
      const organizationId = ctx.user.organizationId ?? 1;

      if (useMock()) {
        const idx = mockReminders.findIndex(
          (r) => r.id === id && r.organizationId === organizationId,
        );
        if (idx < 0) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Reminder not found" });
        }
        const prev = mockReminders[idx]!;
        const next: MockReminder = {
          ...prev,
          title: rest.title?.trim() ?? prev.title,
          note:
            rest.note === undefined
              ? prev.note
              : rest.note?.trim() || null,
          dateKey: rest.dateKey ?? prev.dateKey,
          time: rest.time === undefined ? prev.time : rest.time,
          color: rest.color === undefined ? prev.color : rest.color,
          updatedAt: new Date(),
        };
        mockReminders[idx] = next;
        return toClient(next, next.createdByName ?? null);
      }

      await ensureSchema();
      const col = await getCollection<DashboardReminderDoc>(
        Collections.dashboardReminders,
      );
      const existing = await col.findOne({
        id,
        ...orgFilter(ctx.user),
      });
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Reminder not found" });
      }

      const patch: Partial<DashboardReminderDoc> = { updatedAt: new Date() };
      if (rest.title !== undefined) patch.title = rest.title.trim();
      if (rest.note !== undefined) patch.note = rest.note?.trim() || null;
      if (rest.dateKey !== undefined) patch.dateKey = rest.dateKey;
      if (rest.time !== undefined) patch.time = rest.time;
      if (rest.color !== undefined) patch.color = rest.color;

      const updated = await updateById<DashboardReminderDoc>(
        Collections.dashboardReminders,
        id,
        patch,
      );
      if (!updated) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Reminder not found" });
      }
      const [withName] = await withCreatorNames([updated]);
      return withName!;
    }),

  remove: authedQuery
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      assertCalendarAccess(ctx.user);
      const organizationId = ctx.user.organizationId ?? 1;

      if (useMock()) {
        const idx = mockReminders.findIndex(
          (r) => r.id === input.id && r.organizationId === organizationId,
        );
        if (idx < 0) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Reminder not found" });
        }
        mockReminders.splice(idx, 1);
        return { success: true };
      }

      await ensureSchema();
      const col = await getCollection<DashboardReminderDoc>(
        Collections.dashboardReminders,
      );
      const result = await col.deleteOne({
        id: input.id,
        ...orgFilter(ctx.user),
      });
      if (!result.deletedCount) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Reminder not found" });
      }
      return { success: true };
    }),

  listToday: authedQuery.query(async ({ ctx }) => {
    assertCalendarAccess(ctx.user);
    const todayKey = workZoneDateKey(new Date());
    const organizationId = ctx.user.organizationId ?? 1;

    if (useMock()) {
      return mockReminders
        .filter(
          (r) =>
            r.organizationId === organizationId &&
            r.dateKey === todayKey,
        )
        .sort((a, b) => String(a.time ?? "").localeCompare(String(b.time ?? "")))
        .map((r) => toClient(r, r.createdByName ?? null));
    }

    await ensureSchema();
    const col = await getCollection<DashboardReminderDoc>(
      Collections.dashboardReminders,
    );
    const docs = await col
      .find({
        ...orgFilter(ctx.user),
        dateKey: todayKey,
      })
      .sort({ time: 1 })
      .toArray();
    return withCreatorNames(docs);
  }),
});
