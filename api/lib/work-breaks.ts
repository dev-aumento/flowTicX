import { Collections } from "@db/mongo/collections";
import type { WorkBreakDoc } from "@db/mongo/types";
import { getCollection, insertDoc, updateById } from "../queries/connection";

export async function openWorkBreak(
  userId: number,
  workSessionId: number,
  timeEntryId: number | null,
  startTime: Date,
) {
  return insertDoc<WorkBreakDoc>(Collections.workBreaks, {
    userId,
    workSessionId,
    timeEntryId,
    startTime,
    endTime: null,
    reason: null,
    manuallyEdited: false,
    createdAt: startTime,
    updatedAt: startTime,
  });
}

export async function closeOpenWorkBreak(workSessionId: number, endTime: Date) {
  const col = await getCollection<WorkBreakDoc>(Collections.workBreaks);
  const open = await col.findOne({ workSessionId, endTime: null });
  if (!open) return null;
  return updateById<WorkBreakDoc>(Collections.workBreaks, open.id, {
    endTime,
    updatedAt: endTime,
  });
}

export async function closeOpenBreaksForSession(workSessionId: number, endTime: Date) {
  const col = await getCollection<WorkBreakDoc>(Collections.workBreaks);
  await col.updateMany(
    { workSessionId, endTime: null },
    { $set: { endTime, updatedAt: endTime } },
  );
}
