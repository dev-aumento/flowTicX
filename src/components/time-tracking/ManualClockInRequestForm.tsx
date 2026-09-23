import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { formatWorkZoneTime } from "@/lib/timezone";
import { Loader2, Send } from "lucide-react";

function toDatetimeLocalValue(value: Date | string) {
  const d = new Date(value);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatTime(value: Date | string) {
  return formatWorkZoneTime(value, {
    hour: "numeric",
    minute: "2-digit",
  });
}

type ClockInRequest = {
  id: number;
  requestedClockIn: Date | string;
  reason: string;
  status: "pending" | "approved" | "rejected";
};

function ClockInRequestStatus({
  request,
  sessionStartTime,
  variant,
}: {
  request: ClockInRequest;
  sessionStartTime: Date | string;
  variant: "light" | "dark";
}) {
  const isDark = variant === "dark";
  const isPending = request.status === "pending";
  const isApproved = request.status === "approved";
  const borderClass = isPending
    ? isDark
      ? "border-amber-300/40 bg-amber-500/15 text-amber-100"
      : "border-amber-200 bg-amber-50 text-amber-800"
    : isApproved
      ? isDark
        ? "border-emerald-300/40 bg-emerald-500/15 text-emerald-100"
        : "border-emerald-200 bg-emerald-50 text-emerald-800"
      : isDark
        ? "border-gray-400/40 bg-white/10 text-gray-200"
        : "border-gray-200 bg-gray-50 text-gray-700";

  const title = isPending
    ? "Manual clock-in pending approval"
    : isApproved
      ? "Manual clock-in request approved"
      : "Manual clock-in request rejected";

  return (
    <div className={`rounded-lg border px-3 py-2.5 text-xs ${borderClass}`}>
      <p className="font-medium">{title}</p>
      <p className={`mt-1 ${isDark ? "opacity-90" : ""}`}>
        Requested start: {formatTime(request.requestedClockIn)} · Actual:{" "}
        {formatTime(sessionStartTime)}
      </p>
      <p className={`mt-1 ${isDark ? "opacity-80" : "opacity-80"}`}>{request.reason}</p>
      {!isPending ? (
        <p className={`mt-1.5 ${isDark ? "opacity-70" : "text-gray-500"}`}>
          Only one manual clock-in request is allowed per session.
        </p>
      ) : null}
    </div>
  );
}

export function ManualClockInRequestForm({
  sessionStartTime,
  clockInRequest,
  pendingRequest,
  onSuccess,
  variant = "light",
}: {
  sessionStartTime: Date | string;
  clockInRequest?: ClockInRequest | null;
  pendingRequest?: {
    id: number;
    requestedClockIn: Date | string;
    reason: string;
  } | null;
  onSuccess?: () => void;
  variant?: "light" | "dark";
}) {
  const sessionStart = new Date(sessionStartTime);
  const defaultRequested = new Date(sessionStart.getTime() - 60 * 60 * 1000);
  const [requestedClockIn, setRequestedClockIn] = useState(() =>
    toDatetimeLocalValue(defaultRequested),
  );
  const [reason, setReason] = useState("");

  const existingRequest =
    clockInRequest ??
    (pendingRequest
      ? { ...pendingRequest, status: "pending" as const }
      : null);

  const requestMutation = trpc.timeEntry.requestManualClockIn.useMutation({
    onSuccess: () => {
      setReason("");
      onSuccess?.();
    },
  });

  const isDark = variant === "dark";
  const canSubmit =
    reason.trim().length > 0 && !requestMutation.isPending && !existingRequest;

  if (existingRequest) {
    return (
      <ClockInRequestStatus
        request={existingRequest}
        sessionStartTime={sessionStartTime}
        variant={variant}
      />
    );
  }

  return (
    <div
      className={`border-t pt-2 space-y-2 ${
        isDark ? "border-white/20" : "border-gray-100"
      }`}
    >
      <p className={`text-xs font-medium ${isDark ? "text-blue-100" : "text-gray-600"}`}>
        Manual clock-in time
      </p>
      <p className={`text-[10px] leading-snug ${isDark ? "text-blue-100/80" : "text-gray-400"}`}>
        Actual clock-in: {formatTime(sessionStartTime)}. Request an earlier start time — admin
        approval is required. You can only submit one request per session.
      </p>
      <label className={`block text-[10px] ${isDark ? "text-blue-100/90" : "text-gray-500"}`}>
        Requested start time
        <input
          type="datetime-local"
          value={requestedClockIn}
          max={toDatetimeLocalValue(sessionStart)}
          onChange={(e) => setRequestedClockIn(e.target.value)}
          className={`mt-1 w-full h-8 px-2.5 rounded-lg text-xs ${
            isDark
              ? "bg-white/15 border border-white/25 text-white [color-scheme:dark]"
              : "bg-white border border-gray-200 text-gray-800"
          }`}
        />
      </label>
      <label className={`block text-[10px] ${isDark ? "text-blue-100/90" : "text-gray-500"}`}>
        Reason
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          placeholder="Why do you need an earlier clock-in time?"
          className={`mt-1 w-full px-2.5 py-2 rounded-lg text-xs resize-none ${
            isDark
              ? "bg-white/15 border border-white/25 text-white placeholder-white/50"
              : "bg-white border border-gray-200 text-gray-800"
          }`}
        />
      </label>
      <button
        type="button"
        disabled={!canSubmit}
        onClick={() =>
          requestMutation.mutate({
            requestedClockIn: new Date(requestedClockIn).toISOString(),
            reason: reason.trim(),
          })
        }
        className={`w-full h-8 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 disabled:opacity-50 ${
          isDark
            ? "bg-white/20 text-white hover:bg-white/30"
            : "bg-[#2563EB] text-white hover:bg-blue-700"
        }`}
      >
        {requestMutation.isPending ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <Send size={14} />
        )}
        Submit for approval
      </button>
      {requestMutation.error ? (
        <p className={`text-[10px] ${isDark ? "text-red-200" : "text-red-600"}`}>
          {requestMutation.error.message}
        </p>
      ) : null}
    </div>
  );
}
