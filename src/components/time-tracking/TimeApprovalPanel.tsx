import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { formatTimeAgo } from "@/lib/utils";
import { formatWorkZoneDateTime } from "@/lib/timezone";
import { Check, Loader2, X } from "lucide-react";

function formatApprovalTime(value: Date | string | null | undefined) {
  return formatWorkZoneDateTime(value, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function TimeApprovalPanel() {
  const utils = trpc.useUtils();
  const [reviewNote, setReviewNote] = useState<Record<number, string>>({});
  const { data, isLoading } = trpc.timeEntry.listPendingApprovals.useQuery(undefined, {
    refetchInterval: 30000,
  });

  const reviewMutation = trpc.timeEntry.reviewTimeApproval.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.timeEntry.listPendingApprovals.invalidate(),
        utils.timeEntry.getCurrentSession.invalidate(),
        utils.timeEntry.getStats.invalidate(),
        utils.timeEntry.getBreaks.invalidate(),
        utils.timeEntry.getDayHours.invalidate(),
        utils.timeEntry.list.invalidate(),
        utils.timeEntry.getTeamHours.invalidate(),
        utils.dashboard.getStats.invalidate(),
        utils.notification.list.invalidate(),
      ]);
    },
  });

  const requests = data?.requests ?? [];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 size={22} className="animate-spin text-gray-400" />
      </div>
    );
  }

  if (requests.length === 0) {
    return (
      <div className="border border-gray-200 rounded-xl px-5 py-8 text-center text-sm text-gray-400">
        No pending time approval requests.
      </div>
    );
  }

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 bg-gray-50/50">
        <h3 className="font-semibold text-[#1F2937]">Pending time approvals</h3>
        <p className="text-xs text-gray-500 mt-0.5">
          Review manual clock-in requests from employees.
        </p>
      </div>

      <div className="divide-y divide-gray-100">
        {requests.map((request) => {
          const isClockIn = request.type === "clock_in";
          const note = reviewNote[request.id] ?? "";
          const isReviewingThis =
            reviewMutation.isPending && reviewMutation.variables?.id === request.id;
          const reviewingAction = isReviewingThis ? reviewMutation.variables?.action : null;

          return (
            <div key={request.id} className="px-5 py-4 space-y-3">
              <div className="flex items-start gap-3">
                <UserAvatar name={request.user?.name} avatar={request.user?.avatar} size={36} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-gray-900">
                      {request.user?.name ?? "Unknown employee"}
                    </p>
                    <span
                      className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide ${
                        isClockIn
                          ? "bg-blue-50 text-blue-700"
                          : "bg-amber-50 text-amber-700"
                      }`}
                    >
                      {isClockIn ? "Manual clock-in" : "Break edit"}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">
                    Submitted {formatTimeAgo(request.createdAt)}
                  </p>
                </div>
              </div>

              <div className="rounded-lg bg-gray-50 border border-gray-100 px-3 py-2.5 text-sm text-gray-700 space-y-1">
                {isClockIn ? (
                  <>
                    <p>
                      <span className="text-gray-500">Actual clock-in:</span>{" "}
                      {formatApprovalTime(request.originalClockIn)}
                    </p>
                    <p>
                      <span className="text-gray-500">Requested start:</span>{" "}
                      {formatApprovalTime(request.requestedClockIn)}
                    </p>
                  </>
                ) : (
                  <>
                    <p>
                      <span className="text-gray-500">Current break:</span>{" "}
                      {formatApprovalTime(request.originalBreakStart)}
                      {" – "}
                      {request.originalBreakEnd
                        ? formatApprovalTime(request.originalBreakEnd)
                        : "In progress"}
                    </p>
                    <p>
                      <span className="text-gray-500">Requested break:</span>{" "}
                      {formatApprovalTime(request.requestedBreakStart)}
                      {" – "}
                      {request.requestedBreakEnd
                        ? formatApprovalTime(request.requestedBreakEnd)
                        : "In progress"}
                    </p>
                  </>
                )}
                <p>
                  <span className="text-gray-500">Reason:</span> {request.reason}
                </p>
              </div>

              <label className="block text-xs text-gray-500">
                Review note (optional)
                <input
                  type="text"
                  value={note}
                  onChange={(e) =>
                    setReviewNote((prev) => ({ ...prev, [request.id]: e.target.value }))
                  }
                  placeholder="Add a note for the employee if rejecting"
                  className="mt-1 w-full h-9 px-3 border border-gray-200 rounded-lg bg-white text-xs placeholder:text-xs text-gray-800 md:text-sm md:placeholder:text-sm dark:border-[#64748b] dark:bg-[#151c2c] dark:text-white dark:placeholder:text-slate-400"
                />
              </label>

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  disabled={reviewMutation.isPending}
                  onClick={() =>
                    reviewMutation.mutate({
                      id: request.id,
                      action: "reject",
                      reviewNote: note.trim() || undefined,
                    })
                  }
                  className="h-8 px-3 rounded-lg text-xs font-medium text-gray-600 hover:bg-gray-100 border border-gray-200 flex items-center gap-1.5 disabled:opacity-50"
                >
                  {reviewingAction === "reject" ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <X size={14} />
                  )}
                  Reject
                </button>
                <button
                  type="button"
                  disabled={reviewMutation.isPending}
                  onClick={() =>
                    reviewMutation.mutate({
                      id: request.id,
                      action: "approve",
                      reviewNote: note.trim() || undefined,
                    })
                  }
                  className="h-8 px-3 rounded-lg text-xs font-medium text-white bg-[#2563EB] hover:bg-blue-700 flex items-center gap-1.5 disabled:opacity-50"
                >
                  {reviewingAction === "approve" ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Check size={14} />
                  )}
                  Approve
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
