import { useMemo, useState } from "react";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { Timer, Calendar, Loader2, Pencil, ChevronDown, Coffee, LogIn, LogOut } from "lucide-react";
import { localDateKey, REQUIRED_DAILY_HOURS, formatHoursMinutes, formatHoursMinutesFloored } from "@/lib/work-hours-policy";
import { formatDuration, cn } from "@/lib/utils";
import { hasPermission } from "@/lib/permissions";
import { isAdminOrManagement, isAttendanceTrackableUser } from "@/lib/leave-policy";
import { UserSearchSelect } from "@/components/tasks/UserSearchSelect";
import { BreaksPanel } from "@/components/time-tracking/BreaksPanel";
import {
  EditAttendanceEntryDialog,
  formatEntryDateTimeRange,
  type AttendanceEntryRow,
} from "@/components/time-tracking/EditAttendanceEntryDialog";
import { formatWorkZoneDateKey, formatWorkZoneTime } from "@/lib/timezone";

function formatEntryDuration(minutes: number | null | undefined) {
  if (minutes == null) return "—";
  return formatDuration(minutes);
}

function formatDisplayDate(dateStr: string) {
  return formatWorkZoneDateKey(dateStr, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function hoursUtilization(totalHours: number) {
  return Math.min(Math.round((totalHours / REQUIRED_DAILY_HOURS) * 100), 100);
}

function utilizationColor(pct: number) {
  if (pct > 80) return "#10B981";
  if (pct > 50) return "#F59E0B";
  return "#DC2626";
}

function UtilizationBar({ totalHours }: { totalHours: number }) {
  const utilization = hoursUtilization(totalHours);
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${utilization}%`,
            backgroundColor: utilizationColor(utilization),
          }}
        />
      </div>
      <span className="text-xs text-gray-500 w-8 shrink-0">{utilization}%</span>
    </div>
  );
}

function formatClockTime(value: Date | string | null | undefined) {
  if (!value) return "—";
  return formatWorkZoneTime(value, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function TeamHourWorkBreak({
  totalHours,
  breakSeconds,
  clockIn,
  clockOut,
}: {
  totalHours: number;
  breakSeconds: number;
  clockIn?: Date | string | null;
  clockOut?: Date | string | null;
}) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 rounded-lg border border-gray-200 bg-white p-3">
      <div className="flex items-center gap-2.5">
        <div className="h-8 w-8 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0">
          <LogIn size={15} />
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wide text-gray-400 font-medium">
            Clock in
          </div>
          <div className="text-sm font-semibold text-[#1F2937]">
            {formatClockTime(clockIn)}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2.5">
        <div className="h-8 w-8 rounded-lg bg-rose-50 text-rose-700 flex items-center justify-center shrink-0">
          <LogOut size={15} />
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wide text-gray-400 font-medium">
            Clock out
          </div>
          <div className="text-sm font-semibold text-[#1F2937]">
            {clockIn && !clockOut ? "In progress" : formatClockTime(clockOut)}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2.5">
        <div className="h-8 w-8 rounded-lg bg-blue-50 text-[#2563EB] flex items-center justify-center shrink-0">
          <Timer size={15} />
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wide text-gray-400 font-medium">
            Working time
          </div>
          <div className="text-sm font-semibold text-[#1F2937]">
            {formatHoursMinutes(totalHours)}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2.5">
        <div className="h-8 w-8 rounded-lg bg-amber-50 text-amber-700 flex items-center justify-center shrink-0">
          <Coffee size={15} />
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wide text-gray-400 font-medium">
            Break time
          </div>
          <div className="text-sm font-semibold text-[#1F2937]">
            {formatHoursMinutesFloored(breakSeconds)}
          </div>
        </div>
      </div>
    </div>
  );
}

function DayEntriesPanel({
  title,
  subtitle,
  avatarName,
  avatarUrl,
  totalHours,
  entries,
  isLoading,
  emptyMessage,
  onEditEntry,
}: {
  title: string;
  subtitle: string;
  avatarName?: string | null;
  avatarUrl?: string | null;
  totalHours: number;
  entries: AttendanceEntryRow[];
  isLoading: boolean;
  emptyMessage: string;
  onEditEntry?: (entry: AttendanceEntryRow) => void;
}) {
  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-gray-50/50">
        <div className="flex items-center gap-3">
          <UserAvatar name={avatarName} avatar={avatarUrl} size={36} />
          <div>
            <h3 className="font-semibold text-[#1F2937]">{title}</h3>
            <p className="text-xs text-gray-400">{subtitle}</p>
          </div>
        </div>
        <span className="text-sm font-semibold text-[#2563EB]">{totalHours}h total</span>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 size={24} className="animate-spin text-gray-400" />
        </div>
      ) : entries.length > 0 ? (
        <div className="divide-y divide-gray-50">
          {entries.map((entry) => (
            <div
              key={entry.id}
              className="flex items-center gap-4 px-5 py-3 hover:bg-gray-50 transition-colors"
            >
              <Timer size={14} className="text-gray-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm text-gray-700 truncate">
                  {entry.note || "Attendance"}
                </div>
                <div className="text-xs text-gray-400">
                  {formatEntryDateTimeRange(entry.clockIn, entry.clockOut)}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <div className="text-sm font-medium text-[#1F2937]">
                  {formatEntryDuration(entry.duration)}
                </div>
                {entry.clockOut && onEditEntry ? (
                  <button
                    type="button"
                    onClick={() => onEditEntry(entry)}
                    className="h-8 px-2.5 rounded-lg border border-gray-200 text-xs font-medium text-[#2563EB] hover:bg-blue-50 transition-colors flex items-center gap-1"
                    aria-label="Edit clock in and clock out"
                  >
                    <Pencil size={12} />
                    Edit
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="py-12 text-center text-gray-400 text-sm">{emptyMessage}</div>
      )}
    </div>
  );
}

export function DayHoursSection({ embedded = true }: { embedded?: boolean }) {
  const { user } = useAuth();
  const canViewTeamHours =
    hasPermission(user, "time.view_team") || isAdminOrManagement(user);
  const utils = trpc.useUtils();

  const [selectedDate, setSelectedDate] = useState(() => localDateKey(new Date()));
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<number | "">("");
  const [expandedUserId, setExpandedUserId] = useState<number | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<AttendanceEntryRow | null>(null);

  const { data: usersData } = trpc.user.listForPicker.useQuery(
    { limit: 500 },
    { enabled: canViewTeamHours },
  );

  const viewingOtherEmployee = canViewTeamHours && selectedEmployeeId !== "";
  const showTeamTable = canViewTeamHours && !viewingOtherEmployee;
  const showDayDetail = !canViewTeamHours || viewingOtherEmployee;
  const breaksUserId = viewingOtherEmployee ? Number(selectedEmployeeId) : undefined;

  const { data: teamHours, isLoading: teamLoading } = trpc.timeEntry.getTeamHours.useQuery(
    { date: selectedDate },
    { enabled: showTeamTable, refetchInterval: showTeamTable ? 30_000 : false },
  );

  const { data: dayHours, isLoading: entriesLoading } = trpc.timeEntry.getDayHours.useQuery(
    {
      date: selectedDate,
      userId: viewingOtherEmployee ? Number(selectedEmployeeId) : undefined,
    },
    { enabled: showDayDetail, refetchInterval: showDayDetail ? 30_000 : false },
  );

  const hourEmployees = useMemo(
    () => (usersData?.users ?? []).filter(isAttendanceTrackableUser),
    [usersData?.users],
  );

  const selectedEmployee = useMemo(
    () => hourEmployees.find((u) => u.id === Number(selectedEmployeeId)),
    [hourEmployees, selectedEmployeeId],
  );

  const dayHoursTotal = dayHours?.totalHours ?? 0;
  const invalidateDayHours = () => {
    utils.timeEntry.getDayHours.invalidate();
    utils.timeEntry.getBreaks.invalidate();
    utils.timeEntry.getStats.invalidate();
    utils.timeEntry.getTeamHours.invalidate();
    utils.dashboard.getStats.invalidate();
  };

  const sectionSubtitle = showTeamTable
    ? `Team hours for ${formatDisplayDate(selectedDate)}`
    : viewingOtherEmployee
      ? `Hours for ${selectedEmployee?.name ?? "employee"} on ${formatDisplayDate(selectedDate)}`
      : `Your hours for ${formatDisplayDate(selectedDate)}`;

  return (
    <div className={`space-y-4 ${embedded ? "pt-4 border-t border-gray-100" : ""}`}>
      <div>
        <h2 className="font-semibold text-[#1F2937]">
          {canViewTeamHours && !embedded ? "Employee Hours" : "Daily Hours"}
        </h2>
        <p className="text-xs text-gray-400 mt-0.5">{sectionSubtitle}</p>
        <p className="text-xs text-gray-400 mt-1">
          Clock-in to clock-out time, excluding breaks
        </p>
      </div>

      <div
        className="flex flex-wrap items-center gap-3 p-4 bg-gray-50 rounded-xl border border-gray-100"
      >
        <div className="flex items-center gap-2">
          <Calendar size={16} className="text-gray-400 shrink-0" />
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => {
              setSelectedDate(e.target.value);
              setExpandedUserId(null);
            }}
            className="h-9 px-3 border border-gray-200 rounded-lg text-sm bg-white"
          />
        </div>

        {canViewTeamHours ? (
          <div className="w-full min-w-0 sm:w-[260px]">
            <UserSearchSelect
              mode="single"
              users={hourEmployees.map((person) => ({
                id: person.id,
                name: person.name || person.email || `User #${person.id}`,
                avatar: person.avatar,
              }))}
              value={selectedEmployeeId === "" ? null : selectedEmployeeId}
              onValueChange={(id) => setSelectedEmployeeId(id ?? "")}
              allowClear
              placeholder="All employees"
              searchPlaceholder="Search employees…"
              triggerClassName="h-9"
            />
          </div>
        ) : null}

        {!showTeamTable ? (
          <div className="text-right ml-auto">
            <div className="text-xs text-gray-400">Total hours</div>
            <div className="text-lg font-bold text-[#1F2937]">{dayHoursTotal}h</div>
          </div>
        ) : null}
      </div>

      {showDayDetail ? (
        <>
          <DayEntriesPanel
            title={viewingOtherEmployee ? (selectedEmployee?.name ?? "Employee") : (user?.name ?? "You")}
            subtitle={formatDisplayDate(selectedDate)}
            avatarName={viewingOtherEmployee ? selectedEmployee?.name : user?.name}
            avatarUrl={viewingOtherEmployee ? selectedEmployee?.avatar : user?.avatar}
            totalHours={dayHoursTotal}
            entries={dayHours?.entries ?? []}
            isLoading={entriesLoading}
            emptyMessage={
              viewingOtherEmployee
                ? "No attendance logged for this employee on the selected date."
                : "No attendance logged for you on the selected date."
            }
            onEditEntry={(entry) => {
              setEditingEntry(entry);
              setEditOpen(true);
            }}
          />
          <BreaksPanel date={selectedDate} userId={breaksUserId} />
          <EditAttendanceEntryDialog
            open={editOpen}
            onOpenChange={(open) => {
              setEditOpen(open);
              if (!open) setEditingEntry(null);
            }}
            entry={editingEntry}
            onSuccess={invalidateDayHours}
          />
        </>
      ) : (
        <div className="border border-gray-200 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 sm:px-5 py-4 border-b border-gray-100 bg-gray-50/50">
            <h3 className="font-semibold text-[#1F2937]">Employee Hours</h3>
            <span className="text-xs text-gray-400">{teamHours?.length || 0} employees</span>
          </div>
          {teamLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={24} className="animate-spin text-gray-400" />
            </div>
          ) : teamHours && teamHours.length > 0 ? (
            <>
              <div className="lg:hidden divide-y divide-gray-100">
                {teamHours.map((member) => {
                  const expanded = expandedUserId === member.userId;
                  const breakSeconds =
                    member.breakSeconds ?? Math.round((member.breakHours ?? 0) * 3600);
                  return (
                    <div key={member.userId} className="bg-white">
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedUserId(expanded ? null : member.userId)
                        }
                        aria-expanded={expanded}
                        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors"
                      >
                        <UserAvatar name={member.name} avatar={member.avatar} size={36} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-semibold text-[#1F2937]">
                            {member.name}
                          </div>
                          <div className="truncate text-xs text-gray-500 capitalize">
                            {member.role || "Employee"}
                            {" · "}
                            {member.totalHours}h
                          </div>
                        </div>
                        <ChevronDown
                          size={18}
                          className={cn(
                            "shrink-0 text-gray-400 transition-transform",
                            expanded && "rotate-180",
                          )}
                        />
                      </button>
                      {expanded ? (
                        <div className="space-y-3 border-t border-gray-100 bg-gray-50/70 px-4 py-3">
                          <div className="grid grid-cols-2 gap-2">
                            <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
                              <div className="text-[11px] uppercase tracking-wide text-gray-400 font-medium">
                                Role
                              </div>
                              <div className="text-sm font-semibold text-[#1F2937] capitalize">
                                {member.role || "—"}
                              </div>
                            </div>
                            <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
                              <div className="text-[11px] uppercase tracking-wide text-gray-400 font-medium">
                                Entries
                              </div>
                              <div className="text-sm font-semibold text-[#1F2937]">
                                {member.entriesCount}
                              </div>
                            </div>
                            <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
                              <div className="text-[11px] uppercase tracking-wide text-gray-400 font-medium">
                                Total hours
                              </div>
                              <div className="text-sm font-semibold text-[#1F2937]">
                                {member.totalHours}h
                              </div>
                            </div>
                            <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
                              <div className="text-[11px] uppercase tracking-wide text-gray-400 font-medium">
                                Utilization
                              </div>
                              <div className="mt-1.5">
                                <UtilizationBar totalHours={member.totalHours} />
                              </div>
                            </div>
                          </div>
                          <TeamHourWorkBreak
                            totalHours={member.totalHours}
                            breakSeconds={breakSeconds}
                            clockIn={member.clockIn}
                            clockOut={member.clockOut}
                          />
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>

              <div className="hidden lg:block overflow-x-auto">
                <div className="min-w-[44rem]">
                  <div className="grid grid-cols-[1fr_100px_100px_100px_120px] gap-4 px-5 py-3 bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    <span>Employee</span>
                    <span>Role</span>
                    <span>Entries</span>
                    <span>Total Hours</span>
                    <span>Utilization</span>
                  </div>
                  {teamHours.map((member) => {
                    const expanded = expandedUserId === member.userId;
                    const breakSeconds =
                      member.breakSeconds ?? Math.round((member.breakHours ?? 0) * 3600);
                    return (
                      <div key={member.userId} className="border-b border-gray-50">
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedUserId(expanded ? null : member.userId)
                          }
                          aria-expanded={expanded}
                          className="w-full grid grid-cols-[1fr_100px_100px_100px_120px] gap-4 px-5 py-3 hover:bg-gray-50 transition-colors items-center text-left"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <ChevronDown
                              size={16}
                              className={cn(
                                "shrink-0 text-gray-400 transition-transform",
                                expanded && "rotate-180",
                              )}
                            />
                            <UserAvatar name={member.name} avatar={member.avatar} size={28} />
                            <span className="text-sm text-gray-700 truncate">{member.name}</span>
                          </div>
                          <span className="text-xs text-gray-500 capitalize">{member.role}</span>
                          <span className="text-sm text-gray-700">{member.entriesCount}</span>
                          <span className="text-sm font-semibold text-[#1F2937]">
                            {member.totalHours}h
                          </span>
                          <UtilizationBar totalHours={member.totalHours} />
                        </button>
                        {expanded ? (
                          <div className="px-5 pb-3 pt-3 bg-gray-50/70 dark:bg-[#2c3446]">
                            <div className="ml-8">
                              <TeamHourWorkBreak
                                totalHours={member.totalHours}
                                breakSeconds={breakSeconds}
                                clockIn={member.clockIn}
                                clockOut={member.clockOut}
                              />
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          ) : (
            <div className="py-12 text-center text-gray-400 text-sm">No data for this date</div>
          )}
        </div>
      )}
    </div>
  );
}
