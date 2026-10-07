import { Collections } from "@db/mongo/collections";
import type { UserDoc } from "@db/mongo/types";
import { getCollection, updateById } from "../queries/connection";
import { syncEmployeeFromUser } from "../queries/employees";
import { invalidateAuthUserCache } from "./auth";
import { removeSampleEmployeeWork } from "./sample-workspace";

/**
 * Notice that has reached its end date is cleared, and the person is marked inactive.
 * The user row stays so they remain on the Employees list.
 */
export async function expireFinishedNoticePeriods(organizationId?: number | null) {
  const col = await getCollection<UserDoc>(Collections.users);
  const filter: Record<string, unknown> = {
    onNoticePeriod: true,
    noticePeriodEndsAt: { $lte: new Date() },
  };
  if (organizationId != null && organizationId > 0) {
    filter.organizationId = organizationId;
  }

  const due = await col.find(filter).toArray();
  const now = new Date();
  for (const user of due) {
    const updated = await updateById<UserDoc>(Collections.users, user.id, {
      onNoticePeriod: false,
      noticePeriodDays: null,
      noticePeriodEndsAt: null,
      status: "inactive",
      updatedAt: now,
    });
    if (!updated) continue;
    invalidateAuthUserCache(user.id);
    await syncEmployeeFromUser(updated);
    if (user.sampleEmployee) await removeSampleEmployeeWork(user.id);
  }
  return due.length;
}

export function startNoticePeriodScheduler() {
  const run = () => {
    void expireFinishedNoticePeriods().catch((error) => {
      console.error("[notice-period] job failed:", error);
    });
  };
  run();
  const timer = setInterval(run, 60 * 60 * 1000);
  timer.unref?.();
}
