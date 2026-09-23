import type { trpc } from "@/providers/trpc";

type TrpcUtils = ReturnType<typeof trpc.useUtils>;

/** Refresh task timer queries after attendance clock-out or break. */
export function invalidateActiveTaskTimers(utils: TrpcUtils) {
  void utils.task.getMyActiveTimer.invalidate();
  void utils.task.getActiveTimer.invalidate();
  void utils.task.getTimeTracked.invalidate();
}
