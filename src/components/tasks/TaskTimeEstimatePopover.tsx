import { useEffect, useState } from "react";
import { Loader2, SlidersHorizontal } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { trpc } from "@/providers/trpc";
import { cn } from "@/lib/utils";
import {
  estimatedHoursFromParts,
  splitEstimatedHoursMinutes,
} from "@/lib/task-time-estimate";

type TaskTimeEstimatePopoverProps = {
  taskId: number;
  estimatedHours?: string | number | null;
  canEdit?: boolean;
};

export function TaskTimeEstimatePopover({
  taskId,
  estimatedHours,
  canEdit = true,
}: TaskTimeEstimatePopoverProps) {
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [hours, setHours] = useState("");
  const [minutes, setMinutes] = useState("");

  const updateMutation = trpc.task.update.useMutation({
    onSuccess: () => {
      utils.task.getById.invalidate({ id: taskId });
      utils.task.list.invalidate();
      setOpen(false);
    },
  });

  useEffect(() => {
    if (!open) return;
    const parts = splitEstimatedHoursMinutes(estimatedHours);
    setHours(parts.hours);
    setMinutes(parts.minutes);
  }, [open, estimatedHours]);

  const handleSave = () => {
    if (!canEdit || updateMutation.isPending) return;
    const value = estimatedHoursFromParts(hours, minutes);
    updateMutation.mutate({
      id: taskId,
      estimatedHours: value,
    });
  };

  return (
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center justify-center h-7 w-7 rounded-md text-gray-400 hover:text-[#2563EB] hover:bg-gray-50 transition-colors"
          aria-label={open ? "Hide time estimate settings" : "Set time estimate"}
          aria-expanded={open}
        >
          <SlidersHorizontal size={14} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={6}
        className="z-[140] w-[min(24rem,calc(100vw-3rem))] p-0 rounded-xl shadow-lg overflow-hidden"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        
        <div className="px-4 py-3 space-y-3">
          <div>
            <p className="text-sm font-semibold text-[#1F2937]">Task time estimate</p>
            <p className="mt-1 text-xs text-gray-500">
              Enter the best estimate of the time you expect the task will take.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-gray-600">Hours:</span>
              <input
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                value={hours}
                disabled={!canEdit}
                onChange={(e) => {
                  const next = e.target.value.replace(/[^\d]/g, "");
                  setHours(next);
                }}
                placeholder="0"
                className={cn(
                  "h-9 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm tabular-nums",
                  "focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]",
                  !canEdit && "opacity-60 cursor-not-allowed",
                )}
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-gray-600">Minutes:</span>
              <input
                type="number"
                min={0}
                max={59}
                step={1}
                inputMode="numeric"
                value={minutes}
                disabled={!canEdit}
                onChange={(e) => {
                  const raw = e.target.value.replace(/[^\d]/g, "");
                  const next = raw === "" ? "" : String(Math.min(59, parseInt(raw, 10) || 0));
                  setMinutes(next);
                }}
                placeholder="0"
                className={cn(
                  "h-9 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm tabular-nums",
                  "focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]",
                  !canEdit && "opacity-60 cursor-not-allowed",
                )}
              />
            </label>
          </div>
          {canEdit && (
            <button
              type="button"
              onClick={handleSave}
              disabled={updateMutation.isPending}
              className="h-9 w-full inline-flex items-center justify-center gap-2 rounded-lg bg-[#2563EB] text-white text-sm font-medium hover:bg-[#1D4ED8] disabled:opacity-50 transition-colors"
            >
              {updateMutation.isPending ? (
                <>
                  <Loader2 size={15} className="animate-spin" />
                  Saving…
                </>
              ) : (
                "Save"
              )}
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
