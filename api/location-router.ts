import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { Collections } from "@db/mongo/collections";
import type { LeaveRequestDoc, WorkLocationDoc } from "@db/mongo/types";
import { createRouter, authedQuery } from "./middleware";
import { assertPlanFeature } from "./lib/plan-guard";
import { ensureSchema } from "./lib/migrate";
import { isAuthDisabled } from "./lib/dev-mode";
import {
  findById,
  getCollection,
  hasMongoConfigured,
  insertDoc,
  updateById,
} from "./queries/connection";
import { orgFilter, requireOrganizationId, belongsToUserOrg } from "./lib/tenant";
import { canManageAttendance } from "@/lib/leave-policy";
import {
  DEFAULT_LOCATION_RADIUS_M,
  findMatchingGeofence,
} from "@/lib/geofence";
import { workZoneDateKey } from "@/lib/timezone";
import * as mock from "./lib/mock-store";

/** Approved work-from-home covering today — employee can clock in without geofence. */
async function hasApprovedWfhOnDate(userId: number, dateKey: string): Promise<boolean> {
  if (isAuthDisabled() || !hasMongoConfigured()) {
    return mock.mockHasApprovedWfhOnDate(userId, dateKey);
  }
  await ensureSchema();
  const col = await getCollection<LeaveRequestDoc>(Collections.leaveRequests);
  const hit = await col.findOne(
    {
      userId,
      status: "approved",
      leaveType: "wfh",
      startDate: { $lte: dateKey },
      endDate: { $gte: dateKey },
    },
    { projection: { id: 1 } },
  );
  return hit != null;
}

async function listActiveGeofences(user: {
  id: number;
  organizationId?: number | null;
  role?: string | null;
}) {
  if (isAuthDisabled() || !hasMongoConfigured()) {
    return mock.mockListActiveWorkLocations();
  }
  await ensureSchema();
  const col = await getCollection<WorkLocationDoc>(Collections.workLocations);
  const docs = await col
    .find({ ...orgFilter(user), archived: { $ne: true } })
    .project({
      id: 1,
      name: 1,
      latitude: 1,
      longitude: 1,
      radiusMeters: 1,
    })
    .toArray();
  return docs.map((d) => ({
    id: d.id,
    name: d.name,
    latitude: d.latitude,
    longitude: d.longitude,
    radiusMeters: d.radiusMeters,
  }));
}

function assertHrOrAdmin(user: {
  role?: string | null;
  department?: string | null;
  permissions?: string[] | null;
}) {
  if (!canManageAttendance(user)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only HR and admin can manage locations",
    });
  }
}

function toPublicLocation(doc: WorkLocationDoc) {
  return {
    id: doc.id,
    name: doc.name,
    address: doc.address,
    latitude: doc.latitude,
    longitude: doc.longitude,
    radiusMeters: doc.radiusMeters,
    archived: doc.archived,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

const locationInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  address: z.string().trim().max(500).nullable().optional(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  radiusMeters: z.number().int().min(25).max(10_000).default(DEFAULT_LOCATION_RADIUS_M),
});

const NOMINATIM_UA =
  "AumentoTracker/1.0 (work-location-geofence; contact=support@aumentox26.local)";

async function nominatimFetch(url: URL) {
  const res = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "User-Agent": NOMINATIM_UA,
    },
  });
  if (!res.ok) {
    throw new TRPCError({
      code: "BAD_GATEWAY",
      message: "Location search is temporarily unavailable. Try again.",
    });
  }
  return res.json();
}

export const locationRouter = createRouter({
  /** Place autocomplete via Nominatim (server-side to avoid browser CORS blocks). */
  searchPlaces: authedQuery
    .input(z.object({ query: z.string().trim().min(2).max(200) }))
    .query(async ({ ctx, input }) => {
      assertHrOrAdmin(ctx.user);
      const url = new URL("https://nominatim.openstreetmap.org/search");
      url.searchParams.set("format", "jsonv2");
      url.searchParams.set("q", input.query);
      url.searchParams.set("limit", "8");
      url.searchParams.set("addressdetails", "0");
      const data = (await nominatimFetch(url)) as Array<{
        place_id: number;
        display_name: string;
        lat: string;
        lon: string;
      }>;
      return data.map((hit) => ({
        id: String(hit.place_id),
        label: hit.display_name,
        latitude: Number(hit.lat),
        longitude: Number(hit.lon),
      }));
    }),

  reverseGeocode: authedQuery
    .input(
      z.object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
      }),
    )
    .query(async ({ ctx, input }) => {
      assertHrOrAdmin(ctx.user);
      const url = new URL("https://nominatim.openstreetmap.org/reverse");
      url.searchParams.set("format", "jsonv2");
      url.searchParams.set("lat", String(input.latitude));
      url.searchParams.set("lon", String(input.longitude));
      const data = (await nominatimFetch(url)) as { display_name?: string };
      return {
        address: data.display_name ?? null,
        shortName: data.display_name?.split(",")[0]?.trim() ?? null,
      };
    }),

  list: authedQuery
    .input(
      z
        .object({
          includeArchived: z.boolean().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      assertHrOrAdmin(ctx.user);
      if (isAuthDisabled() || !hasMongoConfigured()) {
        return mock.mockListWorkLocations({
          includeArchived: input?.includeArchived ?? false,
        });
      }

      await ensureSchema();
      const col = await getCollection<WorkLocationDoc>(Collections.workLocations);
      const filter: Record<string, unknown> = {
        ...orgFilter(ctx.user),
      };
      if (!input?.includeArchived) {
        filter.archived = { $ne: true };
      }
      const docs = await col.find(filter).sort({ name: 1 }).toArray();
      return docs.map(toPublicLocation);
    }),

  /** Active geofences used when validating employee clock-in. */
  listActiveForClockIn: authedQuery.query(async ({ ctx }) => {
    return listActiveGeofences(ctx.user);
  }),

  /**
   * Whether the current user must send GPS for clock-in.
   * False when no geofences exist, or when they have approved WFH covering today.
   */
  clockInPolicy: authedQuery.query(async ({ ctx }) => {
    const today = workZoneDateKey(new Date());
    if (await hasApprovedWfhOnDate(ctx.user.id, today)) {
      return { required: false as const, reason: "wfh" as const };
    }
    const locations = await listActiveGeofences(ctx.user);
    if (locations.length === 0) {
      return { required: false as const, reason: "none" as const };
    }
    return { required: true as const, reason: "geofence" as const };
  }),

  create: authedQuery
    .input(locationInputSchema)
    .mutation(async ({ ctx, input }) => {
      await assertPlanFeature(ctx.user, "attendance");
      assertHrOrAdmin(ctx.user);
      if (isAuthDisabled() || !hasMongoConfigured()) {
        return mock.mockCreateWorkLocation({
          ...input,
          address: input.address ?? null,
          createdBy: ctx.user.id,
        });
      }

      await ensureSchema();
      const now = new Date();
      const doc = await insertDoc<WorkLocationDoc>(Collections.workLocations, {
        organizationId: requireOrganizationId(ctx.user),
        name: input.name.trim(),
        address: input.address?.trim() || null,
        latitude: input.latitude,
        longitude: input.longitude,
        radiusMeters: input.radiusMeters,
        archived: false,
        createdBy: ctx.user.id,
        createdAt: now,
        updatedAt: now,
      });
      return toPublicLocation(doc);
    }),

  update: authedQuery
    .input(
      locationInputSchema.extend({
        id: z.number().int().positive(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertHrOrAdmin(ctx.user);
      if (isAuthDisabled() || !hasMongoConfigured()) {
        return mock.mockUpdateWorkLocation(input.id, {
          name: input.name,
          address: input.address ?? null,
          latitude: input.latitude,
          longitude: input.longitude,
          radiusMeters: input.radiusMeters,
        });
      }

      await ensureSchema();
      const existing = await findById<WorkLocationDoc>(
        Collections.workLocations,
        input.id,
      );
      if (!existing || !belongsToUserOrg(ctx.user, existing.organizationId)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Location not found" });
      }

      const updated = await updateById<WorkLocationDoc>(
        Collections.workLocations,
        input.id,
        {
          name: input.name.trim(),
          address: input.address?.trim() || null,
          latitude: input.latitude,
          longitude: input.longitude,
          radiusMeters: input.radiusMeters,
          updatedAt: new Date(),
        },
      );
      if (!updated) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Location not found" });
      }
      return toPublicLocation(updated);
    }),

  setArchived: authedQuery
    .input(
      z.object({
        id: z.number().int().positive(),
        archived: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertHrOrAdmin(ctx.user);
      if (isAuthDisabled() || !hasMongoConfigured()) {
        return mock.mockSetWorkLocationArchived(input.id, input.archived);
      }

      await ensureSchema();
      const existing = await findById<WorkLocationDoc>(
        Collections.workLocations,
        input.id,
      );
      if (!existing || !belongsToUserOrg(ctx.user, existing.organizationId)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Location not found" });
      }

      const updated = await updateById<WorkLocationDoc>(
        Collections.workLocations,
        input.id,
        {
          archived: input.archived,
          updatedAt: new Date(),
        },
      );
      if (!updated) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Location not found" });
      }
      return toPublicLocation(updated);
    }),

  delete: authedQuery
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      assertHrOrAdmin(ctx.user);
      if (isAuthDisabled() || !hasMongoConfigured()) {
        return mock.mockDeleteWorkLocation(input.id);
      }

      await ensureSchema();
      const existing = await findById<WorkLocationDoc>(
        Collections.workLocations,
        input.id,
      );
      if (!existing || !belongsToUserOrg(ctx.user, existing.organizationId)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Location not found" });
      }

      const col = await getCollection<WorkLocationDoc>(Collections.workLocations);
      await col.deleteOne({ id: input.id });
      return { ok: true as const };
    }),
});

/** Shared clock-in geofence guard used by timeEntry.clockIn. */
export async function assertClockInWithinGeofence(params: {
  user: { id: number; organizationId?: number | null; role?: string | null };
  latitude?: number;
  longitude?: number;
  accuracyMeters?: number;
}) {
  const today = workZoneDateKey(new Date());
  if (await hasApprovedWfhOnDate(params.user.id, today)) {
    // Approved WFH for today — location / geofence not required.
    return null;
  }

  const locations = await listActiveGeofences(params.user);

  if (locations.length === 0) {
    // No geofences configured — allow clock-in from anywhere.
    return null;
  }

  if (
    params.latitude == null ||
    params.longitude == null ||
    !Number.isFinite(params.latitude) ||
    !Number.isFinite(params.longitude)
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Location is required to clock in. Enable location access and try again.",
    });
  }

  const match = findMatchingGeofence(
    params.latitude,
    params.longitude,
    locations,
    {
      accuracyMeters: params.accuracyMeters,
      mode: "enter",
    },
  );
  if (!match) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "You are outside the allowed work location radius. Move closer to the office to clock in.",
    });
  }

  return match;
}
