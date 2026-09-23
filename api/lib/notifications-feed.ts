import { isAuthDisabled } from "./dev-mode";
import * as mock from "./mock-store";
import { ensureSchema } from "./migrate";
import { getCollection, hasMongoConfigured } from "../queries/connection";
import { Collections } from "@db/mongo/collections";
import type { NotificationDoc } from "@db/mongo/types";
import {
  personalizeNotificationCopy,
  type ViewerIdentity,
} from "@/lib/viewer-second-person";

function useMock() {
  return isAuthDisabled() || !hasMongoConfigured();
}

export async function getLatestNotificationId(userId: number) {
  if (useMock()) return mock.mockLatestNotificationId(userId);

  await ensureSchema();
  const col = await getCollection<NotificationDoc>(Collections.notifications);
  const latest = await col.find({ userId }).sort({ id: -1 }).limit(1).next();
  return latest?.id ?? 0;
}

export async function listNotificationsSince(
  userId: number,
  sinceId: number,
  viewer?: ViewerIdentity | null,
) {
  if (useMock()) return mock.mockNotificationsSince(userId, sinceId, viewer);

  await ensureSchema();
  const col = await getCollection<NotificationDoc>(Collections.notifications);
  const rows = await col
    .find({ userId, id: { $gt: sinceId } })
    .sort({ id: 1 })
    .toArray();
  return rows.map((row) => personalizeNotificationCopy(row, viewer));
}
