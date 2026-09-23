import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { formatElapsedHMS, formatTimeEntryLogged, getTimeEntrySeconds } from "@/lib/utils";
import { staffTimerRoleLabel } from "@/lib/department-options";
import { Check, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type TimeEntry = NonNullable<
  ReturnType<typeof trpc.task.getTimeTracked.useQuery>["data"]
>["entries"][number];

function toDatetimeLocalValue(value: Date | string) {
  const d = new Date(value);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function invalidateTaskTime(utils: ReturnType<typeof trpc.useUtils>, taskId: number) {
  utils.task.getTimeTracked.invalidate({ taskId });
  utils.task.getById.invalidate({ id: taskId });
  utils.timeEntry.getStats.invalidate();
}

function TaskTimeEntryEditForm({
  taskId,
  entry,
  onCancel,
  onSaved,
}: {
  taskId: number;
  entry: TimeEntry;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const initialSeconds = getTimeEntrySeconds(entry);
  const [dateTime, setDateTime] = useState(() => toDatetimeLocalValue(entry.clockIn!));
  const [hours, setHours] = useState(() => String(Math.floor(initialSeconds / 3600)));
  const [minutes, setMinutes] = useState(() =>
    String(Math.floor((initialSeconds % 3600) / 60)),
  );
  const [reason, setReason] = useState("");
  const utils = trpc.useUtils();

  const updateMutation = trpc.task.updateTimeEntry.useMutation({
    onSuccess: () => {
      invalidateTaskTime(utils, taskId);
      onSaved();
    },
  });

  const hoursNum = Math.max(0, Number.parseInt(hours || "0", 10) || 0);
  const minutesNum = Math.min(59, Math.max(0, Number.parseInt(minutes || "0", 10) || 0));
  const durationMinutes = hoursNum * 60 + minutesNum;
  const canSave =
    reason.trim().length > 0 &&
    durationMinutes > 0 &&
    Boolean(dateTime) &&
    !updateMutation.isPending;

  const handleSave = () => {
    if (!canSave) return;
    const start = new Date(dateTime);
    if (Number.isNaN(start.getTime())) return;
    const end = new Date(start.getTime() + durationMinutes * 60 * 1000);
    updateMutation.mutate({
      taskId,
      entryId: entry.id,
      clockIn: start.toISOString(),
      clockOut: end.toISOString(),
      reason: reason.trim(),
    });
  };

  return (
    <div className="rounded-lg border border-[#D6E4FF] bg-[#F3F8FF] overflow-hidden">
      <div className="grid grid-cols-[1.4fr_0.7fr_1fr] gap-2 px-3 py-2 border-b border-[#D6E4FF] bg-white/70 text-[11px] font-medium text-gray-400">
        <span>Date</span>
        <span>Time</span>
        <span className="text-right">Created by</span>
      </div>

      <div className="p-3 space-y-2.5 dark:bg-[#0b1220]">
        <div className="flex flex-wrap items-end gap-2">
          <label className="block text-xs text-gray-500 min-w-[11rem] flex-1">
            Date
            <input
              type="datetime-local"
              value={dateTime}
              onChange={(e) => setDateTime(e.target.value)}
              className="mt-1 w-full h-8 px-2 border border-gray-200 rounded-md text-sm bg-white"
            />
          </label>

          <label className="block text-xs text-gray-500 w-[4.5rem]">
            Hours:
            <input
              type="number"
              min={0}
              max={999}
              value={hours}
              onChange={(e) => setHours(e.target.value.replace(/[^\d]/g, ""))}
              placeholder="0h"
              className="mt-1 w-full h-8 px-2 border border-gray-200 rounded-md text-sm bg-white text-center"
            />
          </label>

          <label className="block text-xs text-gray-500 w-[4.5rem]">
            Minutes:
            <input
              type="number"
              min={0}
              max={59}
              value={minutes}
              onChange={(e) => setMinutes(e.target.value.replace(/[^\d]/g, ""))}
              placeholder="0m"
              className="mt-1 w-full h-8 px-2 border border-gray-200 rounded-md text-sm bg-white text-center"
            />
          </label>

          <div className="flex items-center gap-1.5 pb-0.5">
            <button
              type="button"
              disabled={!canSave}
              onClick={handleSave}
              className="h-8 w-8 inline-flex items-center justify-center rounded-md text-white bg-[#2563EB] hover:bg-blue-700 disabled:opacity-50"
              aria-label="Save entry"
              title="Save entry"
            >
              {updateMutation.isPending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Check size={14} />
              )}
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="h-8 w-8 inline-flex items-center justify-center rounded-md text-gray-400 hover:text-gray-700 hover:bg-white"
              aria-label="Cancel"
              title="Cancel"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason for edit..."
          className="w-full h-9 px-3 border border-[#93C5FD] rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20"
        />

        {updateMutation.error ? (
          <p className="text-xs text-red-600">{updateMutation.error.message}</p>
        ) : null}
      </div>
    </div>
  );
}

function TaskTimeEntryAddForm({
  taskId,
  currentUserId,
  canPickUser,
  users,
  onCancel,
  onSaved,
}: {
  taskId: number;
  currentUserId: number;
  canPickUser: boolean;
  users: Array<{ id: number; name: string | null }>;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const now = new Date();
  const [userId, setUserId] = useState(currentUserId);
  const [dateTime, setDateTime] = useState(() => toDatetimeLocalValue(now));
  const [hours, setHours] = useState("");
  const [minutes, setMinutes] = useState("");
  const [note, setNote] = useState("");
  const utils = trpc.useUtils();

  const addMutation = trpc.task.addManualTimeEntry.useMutation({
    onSuccess: () => {
      invalidateTaskTime(utils, taskId);
      onSaved();
    },
  });

  const hoursNum = Math.max(0, Number.parseInt(hours || "0", 10) || 0);
  const minutesNum = Math.min(59, Math.max(0, Number.parseInt(minutes || "0", 10) || 0));
  const durationMinutes = hoursNum * 60 + minutesNum;
  const canSave = !addMutation.isPending && durationMinutes > 0 && Boolean(dateTime);

  const handleSave = () => {
    if (!canSave) return;
    const start = new Date(dateTime);
    if (Number.isNaN(start.getTime())) return;
    const end = new Date(start.getTime() + durationMinutes * 60 * 1000);
    addMutation.mutate({
      taskId,
      userId: canPickUser ? userId : undefined,
      clockIn: start.toISOString(),
      clockOut: end.toISOString(),
      note: note.trim() || undefined,
    });
  };

  return (
    <div className="rounded-lg border border-[#D6E4FF] bg-[#F3F8FF] overflow-hidden">
      <div className="grid grid-cols-[1.4fr_0.7fr_1fr] gap-2 px-3 py-2 border-b border-[#D6E4FF] bg-white/70 text-[11px] font-medium text-gray-400">
        <span>Date</span>
        <span>Time</span>
        <span className="text-right">Created by</span>
      </div>

      <div className="p-3 space-y-2.5">
        {canPickUser ? (
          <label className="block text-xs text-gray-500">
            Employee
            <select
              value={userId}
              onChange={(e) => setUserId(Number(e.target.value))}
              className="mt-1 w-full h-8 px-2 border border-gray-200 rounded-md text-sm bg-white"
            >
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name ?? `User #${u.id}`}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <div className="flex flex-wrap items-end gap-2">
          <label className="block text-xs text-gray-500 min-w-[11rem] flex-1">
            Date
            <input
              type="datetime-local"
              value={dateTime}
              onChange={(e) => setDateTime(e.target.value)}
              className="mt-1 w-full h-8 px-2 border border-gray-200 rounded-md text-sm bg-white"
            />
          </label>

          <label className="block text-xs text-gray-500 w-[4.5rem]">
            Hours:
            <input
              type="number"
              min={0}
              max={999}
              value={hours}
              onChange={(e) => setHours(e.target.value.replace(/[^\d]/g, ""))}
              placeholder="0h"
              className="mt-1 w-full h-8 px-2 border border-gray-200 rounded-md text-sm bg-white text-center"
            />
          </label>

          <label className="block text-xs text-gray-500 w-[4.5rem]">
            Minutes:
            <input
              type="number"
              min={0}
              max={59}
              value={minutes}
              onChange={(e) => setMinutes(e.target.value.replace(/[^\d]/g, ""))}
              placeholder="0m"
              className="mt-1 w-full h-8 px-2 border border-gray-200 rounded-md text-sm bg-white text-center"
            />
          </label>

          <div className="flex items-center gap-1.5 pb-0.5">
            <button
              type="button"
              disabled={!canSave}
              onClick={handleSave}
              className="h-8 w-8 inline-flex items-center justify-center rounded-md text-white bg-[#2563EB] hover:bg-blue-700 disabled:opacity-50"
              aria-label="Save entry"
              title="Save entry"
            >
              {addMutation.isPending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Check size={14} />
              )}
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="h-8 w-8 inline-flex items-center justify-center rounded-md text-gray-400 hover:text-gray-700 hover:bg-white"
              aria-label="Cancel"
              title="Cancel"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Comment..."
          className="w-full h-9 px-3 border border-[#93C5FD] rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20"
        />

        {addMutation.error ? (
          <p className="text-xs text-red-600">{addMutation.error.message}</p>
        ) : null}
      </div>
    </div>
  );
}

export function TaskTimeLoggedSection({
  taskId,
  timeData,
  hasActiveSession,
  canManageTime,
  currentUserId,
  canPickUser,
  users,
}: {
  taskId: number;
  timeData: ReturnType<typeof trpc.task.getTimeTracked.useQuery>["data"];
  hasActiveSession: boolean;
  canManageTime: boolean;
  currentUserId: number;
  canPickUser: boolean;
  users: Array<{ id: number; name: string | null }>;
}) {
  const utils = trpc.useUtils();
  const [editingEntryId, setEditingEntryId] = useState<number | null>(null);
  const [showAddManual, setShowAddManual] = useState(false);
  const [entryPendingDelete, setEntryPendingDelete] = useState<TimeEntry | null>(null);

  const deleteMutation = trpc.task.deleteTimeEntry.useMutation({
    onSuccess: () => {
      invalidateTaskTime(utils, taskId);
      setEntryPendingDelete(null);
      setEditingEntryId(null);
    },
  });

  const entries = timeData?.entries ?? [];
  const hasEntries = entries.length > 0;

  const canEditEntry = (entry: TimeEntry) =>
    canManageTime ||
    (entry.userId != null &&
      currentUserId != null &&
      Number(entry.userId) === Number(currentUserId));

  return (
    <div className="space-y-2">
      {hasEntries ? (
        <>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Time logged</p>
          <div className="max-h-[calc(3*4.25rem+0.5rem)] overflow-y-auto overscroll-contain space-y-2 pr-1">
            {entries.map((entry) => {
              const isEditing = editingEntryId === entry.id;
              const editable = !!entry.clockOut && canEditEntry(entry);
              const roleLabel = staffTimerRoleLabel(entry.user);

              return (
                <div key={entry.id} className="space-y-2">
                  <div className="flex items-start justify-between gap-2 text-sm min-h-[4.25rem]">
                    <div className="flex items-start gap-2 min-w-0">
                      <UserAvatar name={entry.user?.name} avatar={entry.user?.avatar} size={22} />
                      <div className="min-w-0">
                        <p className="text-gray-800 font-medium truncate">
                          {entry.user?.name ?? "Unknown"}
                          {roleLabel ? (
                            <>
                              <span className="text-gray-400 font-normal"> · </span>
                              <span className="text-gray-600 font-normal">{roleLabel}</span>
                            </>
                          ) : null}
                        </p>
                        {entry.clockIn && (
                          <p className="text-xs text-gray-500 mt-0.5 leading-snug">
                            {formatTimeEntryLogged(entry.clockIn, entry.clockOut)}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-start gap-0.5 shrink-0 pt-0.5">
                      <span className="font-mono text-xs font-semibold text-gray-600 tabular-nums mr-1">
                        {formatElapsedHMS(getTimeEntrySeconds(entry))}
                      </span>
                      {editable ? (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              setShowAddManual(false);
                              setEditingEntryId(isEditing ? null : entry.id);
                            }}
                            className="h-7 w-7 inline-flex items-center justify-center rounded-md text-gray-400 hover:text-[#2563EB] hover:bg-gray-50"
                            aria-label={isEditing ? "Close edit" : "Edit time entry"}
                            title={isEditing ? "Close edit" : "Edit time entry"}
                          >
                            {isEditing ? <X size={14} /> : <Pencil size={14} />}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setShowAddManual(false);
                              setEditingEntryId(null);
                              setEntryPendingDelete(entry);
                            }}
                            className="h-7 w-7 inline-flex items-center justify-center rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50"
                            aria-label="Delete time entry"
                            title="Delete time entry"
                          >
                            <Trash2 size={14} />
                          </button>
                        </>
                      ) : null}
                    </div>
                  </div>
                  {isEditing && entry.clockOut ? (
                    <TaskTimeEntryEditForm
                      taskId={taskId}
                      entry={entry}
                      onCancel={() => setEditingEntryId(null)}
                      onSaved={() => setEditingEntryId(null)}
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
        </>
      ) : !hasActiveSession ? (
        <p className="text-sm text-gray-400">No time logged yet.</p>
      ) : null}

      {canManageTime ? (
        <div className="pt-1 border-t border-gray-100">
          {showAddManual ? (
            <TaskTimeEntryAddForm
              taskId={taskId}
              currentUserId={currentUserId}
              canPickUser={canPickUser}
              users={users}
              onCancel={() => setShowAddManual(false)}
              onSaved={() => setShowAddManual(false)}
            />
          ) : (
            <button
              type="button"
              onClick={() => {
                setEditingEntryId(null);
                setShowAddManual(true);
              }}
              className="mt-2 w-full h-8 rounded-lg text-xs font-medium text-[#2563EB] hover:bg-blue-50 flex items-center justify-center gap-1.5"
            >
              <Plus size={14} />
              Add entry
            </button>
          )}
        </div>
      ) : null}

      <AlertDialog
        open={entryPendingDelete != null}
        onOpenChange={(open) => {
          if (!open && !deleteMutation.isPending) {
            setEntryPendingDelete(null);
          }
        }}
      >
        <AlertDialogContent overlayClassName="z-[130]" className="z-[130]">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete time entry?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove{" "}
              {entryPendingDelete
                ? `${formatElapsedHMS(getTimeEntrySeconds(entryPendingDelete))} logged by ${
                    entryPendingDelete.user?.name ?? "this user"
                  }`
                : "this time entry"}
              . This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteMutation.error ? (
            <p className="text-sm text-red-600">{deleteMutation.error.message}</p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              disabled={deleteMutation.isPending || entryPendingDelete == null}
              onClick={(e) => {
                e.preventDefault();
                if (!entryPendingDelete) return;
                deleteMutation.mutate({
                  taskId,
                  entryId: entryPendingDelete.id,
                });
              }}
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
