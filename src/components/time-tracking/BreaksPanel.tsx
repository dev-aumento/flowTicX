import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { formatDuration } from "@/lib/utils";
import { formatHoursMinutes } from "@/lib/work-hours-policy";
import { formatWorkZoneTime } from "@/lib/timezone";
import { Coffee, Loader2, Pencil, Plus, X, Check } from "lucide-react";

function formatBreakTime(value: Date | string) {
  return formatWorkZoneTime(value, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function toDatetimeLocalValue(value: Date | string) {
  const d = new Date(value);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function defaultBreakWindow(date: string) {
  const base = new Date(`${date}T13:00:00`);
  if (Number.isNaN(base.getTime())) {
    const now = new Date();
    const end = new Date(now.getTime() - 5 * 60_000);
    const start = new Date(end.getTime() - 30 * 60_000);
    return { start: toDatetimeLocalValue(start), end: toDatetimeLocalValue(end) };
  }
  const start = new Date(base);
  const end = new Date(base.getTime() + 30 * 60_000);
  return { start: toDatetimeLocalValue(start), end: toDatetimeLocalValue(end) };
}

function breakDurationMinutes(start: Date, end: Date | null, now = new Date()) {
  const endMs = end ? end.getTime() : now.getTime();
  return Math.max(0, Math.floor((endMs - start.getTime()) / 60000));
}

type BreakRow = {
  id: number;
  startTime: Date;
  endTime: Date | null;
  reason: string | null;
  manuallyEdited: boolean;
  pendingEdit?: {
    id: number;
    requestedBreakStart: Date;
    requestedBreakEnd: Date | null;
    reason: string;
  } | null;
};

function invalidateBreakRelatedQueries(
  utils: ReturnType<typeof trpc.useUtils>,
) {
  utils.timeEntry.getBreaks.invalidate();
  utils.timeEntry.getCurrentSession.invalidate();
  utils.timeEntry.list.invalidate();
  utils.timeEntry.getStats.invalidate();
  utils.timeEntry.getDayHours.invalidate();
  utils.timeEntry.getTeamHours.invalidate();
  utils.dashboard.getStats.invalidate();
}

function BreakEditForm({
  breakItem,
  onCancel,
  onSaved,
}: {
  breakItem: BreakRow;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [startTime, setStartTime] = useState(() => toDatetimeLocalValue(breakItem.startTime));
  const [endTime, setEndTime] = useState(() =>
    breakItem.endTime ? toDatetimeLocalValue(breakItem.endTime) : "",
  );
  const [reason, setReason] = useState(breakItem.reason ?? "");
  const utils = trpc.useUtils();

  const updateMutation = trpc.timeEntry.updateBreak.useMutation({
    onSuccess: async () => {
      invalidateBreakRelatedQueries(utils);
      await Promise.all([
        utils.timeEntry.getStats.refetch(),
        utils.timeEntry.getCurrentSession.refetch(),
      ]);
      onSaved();
    },
  });

  const canSave =
    reason.trim().length > 0 &&
    startTime.trim().length > 0 &&
    endTime.trim().length > 0 &&
    !updateMutation.isPending;

  return (
    <div className="px-5 py-4 bg-gray-50/80 border-t border-gray-100 space-y-3">
      <p className="text-xs text-gray-600 font-medium">
        Edit break times. A reason is required.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block text-xs text-gray-600">
          Break start
          <input
            type="datetime-local"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            className="mt-1 w-full h-9 px-3 border border-gray-200 rounded-lg text-sm bg-white"
          />
        </label>
        <label className="block text-xs text-gray-600">
          Break end
          <input
            type="datetime-local"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            className="mt-1 w-full h-9 px-3 border border-gray-200 rounded-lg text-sm bg-white"
          />
          {!breakItem.endTime ? (
            <span className="text-[10px] text-gray-400 mt-1 block">
              Set an end time if you forgot to stop the break
            </span>
          ) : null}
        </label>
      </div>
      <label className="block text-xs text-gray-600">
        Reason for edit
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          placeholder="Why are you changing this break time?"
          className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white resize-none"
        />
      </label>
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="h-8 px-3 rounded-lg text-xs font-medium text-gray-600 hover:bg-white border border-gray-200"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!canSave}
          onClick={() =>
            updateMutation.mutate({
              id: breakItem.id,
              startTime: new Date(startTime).toISOString(),
              endTime: endTime ? new Date(endTime).toISOString() : null,
              reason: reason.trim(),
            })
          }
          className="h-8 px-3 rounded-lg text-xs font-medium text-white bg-[#2563EB] hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5"
        >
          {updateMutation.isPending ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Check size={14} />
          )}
          Save
        </button>
      </div>
      {updateMutation.error ? (
        <p className="text-xs text-red-600">{updateMutation.error.message}</p>
      ) : null}
    </div>
  );
}

function AddBreakForm({
  date,
  userId,
  onCancel,
  onSaved,
}: {
  date: string;
  userId?: number;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const defaults = defaultBreakWindow(date);
  const [startTime, setStartTime] = useState(defaults.start);
  const [endTime, setEndTime] = useState(defaults.end);
  const [reason, setReason] = useState("");
  const utils = trpc.useUtils();

  const createMutation = trpc.timeEntry.createBreak.useMutation({
    onSuccess: async () => {
      invalidateBreakRelatedQueries(utils);
      await Promise.all([
        utils.timeEntry.getStats.refetch(),
        utils.timeEntry.getCurrentSession.refetch(),
      ]);
      onSaved();
    },
  });

  const canSave =
    reason.trim().length > 0 &&
    startTime.trim().length > 0 &&
    endTime.trim().length > 0 &&
    !createMutation.isPending;

  return (
    <div className="px-5 py-4 bg-blue-50/40 border-t border-gray-100 space-y-3">
      <p className="text-xs text-gray-600 font-medium">
        Add a custom break (for example if you forgot to start break). This time is
        excluded from the day total.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block text-xs text-gray-600">
          Break start
          <input
            type="datetime-local"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            className="mt-1 w-full h-9 px-3 border border-gray-200 rounded-lg text-sm bg-white"
          />
        </label>
        <label className="block text-xs text-gray-600">
          Break end
          <input
            type="datetime-local"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            className="mt-1 w-full h-9 px-3 border border-gray-200 rounded-lg text-sm bg-white"
          />
        </label>
      </div>
      <label className="block text-xs text-gray-600">
        Reason
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          placeholder="Why are you adding this break?"
          className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white resize-none"
        />
      </label>
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="h-8 px-3 rounded-lg text-xs font-medium text-gray-600 hover:bg-white border border-gray-200"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!canSave}
          onClick={() =>
            createMutation.mutate({
              ...(userId != null ? { userId } : {}),
              startTime: new Date(startTime).toISOString(),
              endTime: new Date(endTime).toISOString(),
              reason: reason.trim(),
            })
          }
          className="h-8 px-3 rounded-lg text-xs font-medium text-white bg-[#2563EB] hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5"
        >
          {createMutation.isPending ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Check size={14} />
          )}
          Add break
        </button>
      </div>
      {createMutation.error ? (
        <p className="text-xs text-red-600">{createMutation.error.message}</p>
      ) : null}
    </div>
  );
}

export function BreaksPanel({
  date,
  userId,
}: {
  date: string;
  userId?: number;
}) {
  const { user } = useAuth();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);

  const { data, isLoading } = trpc.timeEntry.getBreaks.useQuery(
    { date, userId },
    { refetchInterval: 30_000 },
  );

  const [tick, setTick] = useState(0);
  const breaks = data?.breaks ?? [];
  const hasActiveBreak = breaks.some((b) => !b.endTime);

  const canAddBreak =
    !userId || userId === user?.id || user?.role === "admin";

  useEffect(() => {
    if (!hasActiveBreak) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [hasActiveBreak]);

  const totalBreakMinutes = useMemo(
    () => breaks.reduce((sum, b) => sum + breakDurationMinutes(b.startTime, b.endTime), 0),
    [breaks, tick],
  );

  const breakRows = useMemo(
    () =>
      breaks.map((breakItem) => ({
        ...breakItem,
        minutes: breakDurationMinutes(breakItem.startTime, breakItem.endTime),
      })),
    [breaks, tick],
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 size={20} className="animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-gray-100 bg-gray-50/50">
        <div className="flex items-center gap-2 min-w-0">
          <Coffee size={16} className="text-amber-600 shrink-0" />
          <h3 className="font-semibold text-[#1F2937]">Breaks</h3>
          {breaks.length > 0 ? (
            <span className="text-sm font-medium text-amber-700">
              {formatHoursMinutes(totalBreakMinutes / 60)} total
            </span>
          ) : null}
        </div>
        {canAddBreak ? (
          <button
            type="button"
            onClick={() => {
              setEditingId(null);
              setAdding((open) => !open);
            }}
            className="h-8 px-2.5 rounded-lg text-xs font-medium text-[#2563EB] hover:bg-blue-50 flex items-center gap-1 shrink-0"
          >
            {adding ? <X size={14} /> : <Plus size={14} />}
            {adding ? "Close" : "Add break"}
          </button>
        ) : null}
      </div>

      {adding && canAddBreak ? (
        <AddBreakForm
          date={date}
          userId={userId}
          onCancel={() => setAdding(false)}
          onSaved={() => setAdding(false)}
        />
      ) : null}

      {breaks.length === 0 && !adding ? (
        <div className="px-5 py-8 text-center text-sm text-gray-400">
          No breaks recorded for this day.
          {canAddBreak ? " Use Add break if you forgot to start one." : null}
        </div>
      ) : null}

      {breaks.length > 0 ? (
        <div className="divide-y divide-gray-50">
          {breakRows.map((breakItem) => {
            const isEditing = editingId === breakItem.id;

            return (
              <div key={breakItem.id}>
                <div className="flex items-center gap-4 px-5 py-3 hover:bg-gray-50 transition-colors">
                  <Coffee size={14} className="text-amber-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-gray-700">
                      {formatBreakTime(breakItem.startTime)}
                      {" – "}
                      {breakItem.endTime ? formatBreakTime(breakItem.endTime) : "In progress"}
                    </div>
                    <div className="text-xs text-gray-400">
                      {formatDuration(breakItem.minutes)}
                      {breakItem.manuallyEdited && breakItem.reason ? (
                        <span className="ml-2 text-amber-600">· Edited: {breakItem.reason}</span>
                      ) : null}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setAdding(false);
                      setEditingId(isEditing ? null : breakItem.id);
                    }}
                    className="h-8 px-2.5 rounded-lg text-xs font-medium text-gray-600 hover:bg-gray-100 flex items-center gap-1 shrink-0"
                  >
                    {isEditing ? <X size={14} /> : <Pencil size={14} />}
                    {isEditing ? "Close" : "Edit"}
                  </button>
                </div>
                {isEditing ? (
                  <BreakEditForm
                    breakItem={breakItem}
                    onCancel={() => setEditingId(null)}
                    onSaved={() => setEditingId(null)}
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
