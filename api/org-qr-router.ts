import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import { Collections } from "@db/mongo/collections";
import type {
  OrgAttendanceQrActivityAction,
  OrgAttendanceQrActivityDoc,
  OrgAttendanceQrDoc,
  SafeUser,
} from "@db/mongo/types";
import { createRouter, authedQuery } from "./middleware";
import { ensureSchema } from "./lib/migrate";
import { isAuthDisabled } from "./lib/dev-mode";
import { getCollection, hasMongoConfigured, insertDoc, updateById } from "./queries/connection";
import { requireOrganizationId } from "./lib/tenant";
import { canManageAttendance } from "@/lib/leave-policy";
import * as mock from "./lib/mock-store";

function assertHrOrAdmin(user: {
  role?: string | null;
  department?: string | null;
  permissions?: string[] | null;
}) {
  if (!canManageAttendance(user)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only HR and admin can manage attendance QR codes",
    });
  }
}

function actorName(user: Pick<SafeUser, "name" | "email">) {
  return user.name?.trim() || user.email?.trim() || "Unknown";
}

function toPublicQr(doc: Pick<OrgAttendanceQrDoc, "token" | "createdAt" | "updatedAt">) {
  return {
    token: doc.token,
    /** Full string encoded into the QR image. */
    payload: `aumento-attendance:${doc.token}`,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function toPublicActivity(doc: OrgAttendanceQrActivityDoc) {
  return {
    id: doc.id,
    action: doc.action,
    userId: doc.userId,
    userName: doc.userName,
    createdAt: doc.createdAt,
  };
}

async function findOrgQr(organizationId: number) {
  const col = await getCollection<OrgAttendanceQrDoc>(Collections.orgAttendanceQr);
  return col.findOne({ organizationId });
}

async function recordActivity(params: {
  organizationId: number;
  action: OrgAttendanceQrActivityAction;
  userId: number;
  userName: string;
}) {
  const now = new Date();
  const doc = await insertDoc<OrgAttendanceQrActivityDoc>(
    Collections.orgAttendanceQrActivity,
    {
      organizationId: params.organizationId,
      action: params.action,
      userId: params.userId,
      userName: params.userName,
      createdAt: now,
    },
  );
  return toPublicActivity(doc);
}

async function upsertOrgQr(
  organizationId: number,
  updatedBy: number,
  action: "created" | "regenerated",
  userName: string,
) {
  const now = new Date();
  const existing = await findOrgQr(organizationId);
  let qr: ReturnType<typeof toPublicQr>;

  if (existing) {
    const updated = await updateById<OrgAttendanceQrDoc>(
      Collections.orgAttendanceQr,
      existing.id,
      {
        token: nanoid(40),
        updatedBy,
        updatedAt: now,
      },
    );
    if (!updated) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Could not update QR code",
      });
    }
    qr = toPublicQr(updated);
  } else {
    const created = await insertDoc<OrgAttendanceQrDoc>(Collections.orgAttendanceQr, {
      organizationId,
      token: nanoid(40),
      updatedBy,
      createdAt: now,
      updatedAt: now,
    });
    qr = toPublicQr(created);
  }

  await recordActivity({
    organizationId,
    action,
    userId: updatedBy,
    userName,
  });
  return qr;
}

export const orgQrRouter = createRouter({
  /** Current org QR, or null if none generated yet. */
  get: authedQuery.query(async ({ ctx }) => {
    assertHrOrAdmin(ctx.user);
    const organizationId = requireOrganizationId(ctx.user);

    if (isAuthDisabled() || !hasMongoConfigured()) {
      return mock.mockGetOrgAttendanceQr(organizationId);
    }

    await ensureSchema();
    const doc = await findOrgQr(organizationId);
    return doc ? toPublicQr(doc) : null;
  }),

  /** Recent create / regenerate / download activity for this org. */
  listActivity: authedQuery.query(async ({ ctx }) => {
    assertHrOrAdmin(ctx.user);
    const organizationId = requireOrganizationId(ctx.user);

    if (isAuthDisabled() || !hasMongoConfigured()) {
      return mock.mockListOrgAttendanceQrActivity(organizationId);
    }

    await ensureSchema();
    const col = await getCollection<OrgAttendanceQrActivityDoc>(
      Collections.orgAttendanceQrActivity,
    );
    const docs = await col
      .find({ organizationId })
      .sort({ createdAt: -1, id: -1 })
      .limit(50)
      .toArray();
    return docs.map(toPublicActivity);
  }),

  /** Create the first QR for the organization. */
  generate: authedQuery.mutation(async ({ ctx }) => {
    assertHrOrAdmin(ctx.user);
    const organizationId = requireOrganizationId(ctx.user);
    const name = actorName(ctx.user);

    if (isAuthDisabled() || !hasMongoConfigured()) {
      const existing = mock.mockGetOrgAttendanceQr(organizationId);
      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "A QR code already exists. Use regenerate instead.",
        });
      }
      return mock.mockGenerateOrgAttendanceQr(organizationId, ctx.user.id, name, "created");
    }

    await ensureSchema();
    const existing = await findOrgQr(organizationId);
    if (existing) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "A QR code already exists. Use regenerate instead.",
      });
    }
    return upsertOrgQr(organizationId, ctx.user.id, "created", name);
  }),

  /** Replace the QR token (invalidates previously printed codes). */
  regenerate: authedQuery.mutation(async ({ ctx }) => {
    assertHrOrAdmin(ctx.user);
    const organizationId = requireOrganizationId(ctx.user);
    const name = actorName(ctx.user);

    if (isAuthDisabled() || !hasMongoConfigured()) {
      return mock.mockGenerateOrgAttendanceQr(
        organizationId,
        ctx.user.id,
        name,
        "regenerated",
      );
    }

    await ensureSchema();
    return upsertOrgQr(organizationId, ctx.user.id, "regenerated", name);
  }),

  /** Record that the current user downloaded the QR PNG. */
  recordDownload: authedQuery.mutation(async ({ ctx }) => {
    assertHrOrAdmin(ctx.user);
    const organizationId = requireOrganizationId(ctx.user);
    const name = actorName(ctx.user);

    if (isAuthDisabled() || !hasMongoConfigured()) {
      const existing = mock.mockGetOrgAttendanceQr(organizationId);
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "No QR code to download" });
      }
      return mock.mockRecordOrgAttendanceQrDownload(organizationId, ctx.user.id, name);
    }

    await ensureSchema();
    const existing = await findOrgQr(organizationId);
    if (!existing) {
      throw new TRPCError({ code: "NOT_FOUND", message: "No QR code to download" });
    }
    return recordActivity({
      organizationId,
      action: "downloaded",
      userId: ctx.user.id,
      userName: name,
    });
  }),
});
