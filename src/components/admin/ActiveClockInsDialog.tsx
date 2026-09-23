import { useEffect, useState } from "react";
import { trpc } from "@/providers/trpc";
import { UserAvatar } from "@/components/shared/UserAvatar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { formatElapsedHMS } from "@/lib/utils";
import { formatWorkZoneTime } from "@/lib/timezone";
import { Loader2 } from "lucide-react";

type ActiveClockInsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

function formatClockInTime(value: Date | string) {
  return formatWorkZoneTime(value, {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function ActiveClockInsDialog({ open, onOpenChange }: ActiveClockInsDialogProps) {
  const [now, setNow] = useState(() => Date.now());
  const { data: clockIns = [], isLoading, dataUpdatedAt } =
    trpc.dashboard.getActiveClockIns.useQuery(undefined, {
      enabled: open,
      refetchInterval: open ? 15_000 : false,
    });

  useEffect(() => {
    if (!open) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Active clock-ins</DialogTitle>
          <DialogDescription>
            Employees currently clocked in ({clockIns.length})
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 size={24} className="animate-spin text-gray-400" />
          </div>
        ) : clockIns.length === 0 ? (
          <div className="py-10 text-center text-sm text-gray-400">
            No one is clocked in right now
          </div>
        ) : (
          <div className="max-h-[60vh] overflow-y-auto -mx-1 px-1 divide-y divide-gray-100">
            {clockIns.map((entry) => {
              const displaySeconds = entry.paused
                ? entry.workElapsedSeconds
                : entry.workElapsedSeconds +
                  Math.max(0, Math.floor((now - dataUpdatedAt) / 1000));

              return (
                <div key={entry.sessionId} className="flex items-center gap-3 py-3">
                  <UserAvatar name={entry.name} avatar={entry.avatar} size={36} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-[#1F2937] truncate">
                      {entry.name}
                    </div>
                    <div className="text-xs text-gray-400 truncate capitalize">
                      {[entry.role, entry.department].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-semibold tabular-nums text-[#1F2937]">
                      {formatElapsedHMS(displaySeconds)}
                    </div>
                    <div className="text-[11px] text-gray-400">
                      {entry.paused ? (
                        <span className="text-amber-600">On break</span>
                      ) : (
                        <>Since {formatClockInTime(entry.startTime)}</>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
