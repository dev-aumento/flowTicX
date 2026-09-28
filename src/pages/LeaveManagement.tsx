import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Navigate } from "react-router";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import {
  MONTHLY_PAID_LEAVES,
  TOTAL_SICK_LEAVES,
  TOTAL_WFH_DAYS,
  LEAVE_DURATION_OPTIONS,
  LEAVE_TYPE_OPTIONS,
  allocatePaidLeaveAcrossMonths,
  allowsHalfDayLeave,
  annualPaidLeaveEntitlement,
  annualSickLeaveEntitlement,
  annualWfhEntitlement,
  canManageLeaves,
  consumesPaidBalance,
  consumesSickBalance,
  durationHint,
  formatLeaveDays,
  isPaidLeaveMonthLocked,
  isHalfDayLeave,
  isWorkFromHomeLeave,
  firstOverlappingLeaveDate,
  leaveAlreadyExistsForEmployeeMessage,
  leaveDateKeysInYear,
  leaveDayUnits,
  leaveDaysInMonth,
  leaveTouchesMonth,
  leaveTypeLabel,
  paidLeaveMonthCapacities,
  remainingMonthlyPaidLeave,
  resolveEmploymentType,
  toJoiningDateKey,
  wfhRequestBlockedMessage,
  type LeaveDuration,
  type LeaveType,
} from "@/lib/leave-policy";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { UserSearchSelect } from "@/components/tasks/UserSearchSelect";
import { formatWorkZoneDateKey, formatWorkZoneDateTime, workZoneDateKey, workZoneDateParts } from "@/lib/timezone";
import { PublicHolidayListRow } from "@/components/leaves/PublicHolidayListRow";
import {
  approvedLeaveDateKeysForUser,
  LeaveDatePickerField,
} from "@/components/leaves/LeaveDatePickerField";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Home,
  Loader2,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type FilterTab = "pending" | "all" | "approved" | "rejected" | "cancelled" | "wfh";

function leaveRequestTypeBadgeClass(leaveType: string) {
  if (isWorkFromHomeLeave(leaveType)) {
    return "bg-teal-50 text-teal-700 ring-1 ring-teal-100";
  }
  return "bg-gray-100 text-gray-600";
}

type LeaveRequestRow = {
  id: number;
  userId: number;
  leaveType: string;
  isHalfDay?: boolean | null;
  startDate: string;
  endDate: string;
  days: number;
  reason: string;
  status: string;
  reviewNote?: string | null;
  reviewedAt?: Date | string | null;
  createdAt: Date | string;
  employee?: {
    id: number;
    name: string | null;
    email: string | null;
    avatar: string | null;
    department: string | null;
  } | null;
};

type EmployeeColumn = {
  id: number;
  name: string;
  email?: string | null;
  avatar: string | null;
  dateOfJoining?: Date | string | null;
  employmentType?: string | null;
  position?: string | null;
  onNoticePeriod?: boolean;
};

type ManualEntryEmployee = {
  id: number;
  name: string | null;
  email?: string | null;
  avatar: string | null;
  department: string | null;
  dateOfJoining?: Date | string | null;
  employmentType?: string | null;
  position?: string | null;
  onNoticePeriod?: boolean;
};

function employeeWfhBlockedReason(emp: ManualEntryEmployee | null | undefined) {
  if (!emp) return null;
  return wfhRequestBlockedMessage(
    {
      onNoticePeriod: Boolean(emp.onNoticePeriod),
      dateOfJoining: emp.dateOfJoining ?? null,
      employmentType: resolveEmploymentType(emp),
    },
    new Date(),
    { forEmployee: true },
  );
}

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

export default function LeaveManagement() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const [filter, setFilter] = useState<FilterTab>("all");
  const [selectedRequest, setSelectedRequest] = useState<LeaveRequestRow | null>(null);
  const [cellLeaves, setCellLeaves] = useState<{
    employeeName: string;
    label: string;
    requests: LeaveRequestRow[];
  } | null>(null);
  const currentYear = workZoneDateParts(new Date()).year;
  const todayKey = workZoneDateKey(new Date());
  const [usageYear, setUsageYear] = useState(currentYear);
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [holidayYear, setHolidayYear] = useState(currentYear);
  const [holidayDate, setHolidayDate] = useState("");
  const [holidayName, setHolidayName] = useState("");
  const [holidaysExpanded, setHolidaysExpanded] = useState(false);
  const [leaveUsageExpanded, setLeaveUsageExpanded] = useState(false);
  const [wfhUsageExpanded, setWfhUsageExpanded] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualWfhOpen, setManualWfhOpen] = useState(false);
  const [wfhSearch, setWfhSearch] = useState("");
  const [expandedWfhIds, setExpandedWfhIds] = useState<Set<number>>(() => new Set());
  const allowed = canManageLeaves(user);

  const { data, isLoading } = trpc.leave.listPending.useQuery(undefined, {
    enabled: allowed,
  });
  const { data: usersData } = trpc.user.listForPicker.useQuery(
    { limit: 500 },
    { enabled: allowed },
  );
  const { data: holidaysData, isLoading: holidaysLoading } = trpc.leave.listHolidays.useQuery(
    { year: holidayYear },
    { enabled: allowed },
  );
  const { data: overridesData } = trpc.leave.listUsageOverrides.useQuery(
    { year: usageYear },
    { enabled: allowed },
  );

  const reviewMutation = trpc.leave.review.useMutation({
    onSuccess: async (data, variables) => {
      const label =
        variables.status === "approved"
          ? "Leave approved"
          : variables.status === "rejected"
            ? "Leave rejected"
            : variables.status === "cancelled"
              ? "Leave cancelled"
              : "Leave set to pending";
      toast.success(label);
      const updatedRequest = data.request;
      if (updatedRequest != null) {
        const saved = updatedRequest;
        setSelectedRequest((prev) =>
          prev && prev.id === saved.id
            ? {
                ...prev,
                ...saved,
                employee: prev.employee,
              }
            : prev,
        );
      }
      setCellLeaves(null);
      await Promise.all([
        utils.leave.listPending.invalidate(),
        utils.leave.myBalance.invalidate(),
        utils.leave.myRequests.invalidate(),
        utils.notification.list.invalidate(),
      ]);
    },
    onError: (err) => {
      toast.error(err.message || "Could not update leave request");
    },
  });

  const updateDetailsMutation = trpc.leave.updateDetails.useMutation({
    onSuccess: async (data) => {
      toast.success("Leave details saved");
      const updatedRequest = data.request;
      if (updatedRequest != null) {
        const saved = updatedRequest;
        setSelectedRequest((prev) =>
          prev && prev.id === saved.id
            ? {
                ...prev,
                ...saved,
                employee: prev.employee,
              }
            : prev,
        );
      }
      await Promise.all([
        utils.leave.listPending.invalidate(),
        utils.leave.myRequests.invalidate(),
      ]);
    },
    onError: (err) => {
      toast.error(err.message || "Could not save leave details");
    },
  });

  const addHolidayMutation = trpc.leave.addHoliday.useMutation({
    onSuccess: async () => {
      toast.success("Public holiday added");
      setHolidayDate("");
      setHolidayName("");
      await utils.leave.listHolidays.invalidate();
    },
    onError: (err) => {
      toast.error(err.message || "Could not add holiday");
    },
  });

  const deleteHolidayMutation = trpc.leave.deleteHoliday.useMutation({
    onSuccess: async () => {
      toast.success("Holiday removed");
      await utils.leave.listHolidays.invalidate();
    },
    onError: (err) => {
      toast.error(err.message || "Could not remove holiday");
    },
  });

  const createManualMutation = trpc.leave.createManualEntry.useMutation({
    onSuccess: async (_data, variables) => {
      const isWfh = isWorkFromHomeLeave(variables.leaveType);
      toast.success(
        variables.status === "approved"
          ? isWfh
            ? "Manual WFH entry added"
            : "Manual leave entry added"
          : isWfh
            ? "Rejected WFH entry recorded"
            : "Rejected leave entry recorded",
      );
      setManualOpen(false);
      setManualWfhOpen(false);
      await Promise.all([
        utils.leave.listPending.invalidate(),
        utils.leave.myBalance.invalidate(),
        utils.leave.myRequests.invalidate(),
        utils.notification.list.invalidate(),
      ]);
    },
    onError: (err) => {
      toast.error(err.message || "Could not add entry");
    },
  });

  const setUsageOverrideMutation = trpc.leave.setUsageOverride.useMutation({
    onSuccess: async () => {
      await utils.leave.listUsageOverrides.invalidate({ year: usageYear });
      toast.success("Leave usage updated");
    },
    onError: (err) => {
      toast.error(err.message || "Could not update leave usage");
    },
  });

  const holidays = holidaysData?.holidays ?? [];
  const holidayYearOptions = useMemo(() => {
    const years = new Set<number>([currentYear, currentYear + 1, holidayYear, usageYear]);
    return [...years].sort((a, b) => b - a);
  }, [currentYear, holidayYear, usageYear]);

  const handleAddHoliday = () => {
    if (!holidayDate) {
      toast.error("Please select a holiday date");
      return;
    }
    if (holidayName.trim().length < 2) {
      toast.error("Please enter a holiday name");
      return;
    }
    addHolidayMutation.mutate({
      date: holidayDate,
      name: holidayName.trim(),
    });
  };

  const allRequests = (data?.requests ?? []) as LeaveRequestRow[];

  useEffect(() => {
    if (!selectedRequest) return;
    const next = allRequests.find((r) => r.id === selectedRequest.id);
    if (next) setSelectedRequest(next);
  }, [allRequests, selectedRequest?.id]);

  const requests = useMemo(() => {
    if (filter === "all") return allRequests;
    if (filter === "wfh") {
      return allRequests.filter((r) => isWorkFromHomeLeave(r.leaveType));
    }
    return allRequests.filter((r) => r.status === filter);
  }, [allRequests, filter]);

  const pendingCount = allRequests.filter((r) => r.status === "pending").length;
  const wfhCount = allRequests.filter((r) => isWorkFromHomeLeave(r.leaveType)).length;

  const employees = useMemo((): EmployeeColumn[] => {
    const isAdminUser = (role: string | null | undefined) =>
      String(role ?? "").toLowerCase() === "admin";

    const fromPicker = (usersData?.users ?? [])
      .filter((u) => !isAdminUser(u.role))
      .map((u) => ({
        id: u.id,
        name: u.name?.trim() || u.email || `User #${u.id}`,
        email: u.email ?? null,
        avatar: u.avatar ?? null,
        // Normalize to IST YYYY-MM-DD so day-20 cutoff is not affected by UTC serialization.
        dateOfJoining: toJoiningDateKey(u.dateOfJoining ?? null),
        employmentType: u.employmentType ?? null,
        position: u.position ?? null,
        onNoticePeriod: Boolean(u.onNoticePeriod),
      }));
    if (fromPicker.length > 0) {
      return [...fromPicker].sort((a, b) => a.name.localeCompare(b.name));
    }

    const adminIds = new Set(
      (usersData?.users ?? []).filter((u) => isAdminUser(u.role)).map((u) => u.id),
    );
    const byId = new Map<number, EmployeeColumn>();
    for (const req of allRequests) {
      if (adminIds.has(req.userId)) continue;
      if (byId.has(req.userId)) continue;
      byId.set(req.userId, {
        id: req.userId,
        name:
          req.employee?.name?.trim() ||
          req.employee?.email ||
          `User #${req.userId}`,
        email: req.employee?.email ?? null,
        avatar: req.employee?.avatar ?? null,
        dateOfJoining: null,
        employmentType: null,
        position: null,
        onNoticePeriod: false,
      });
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [usersData?.users, allRequests]);

  const filteredUsageEmployees = useMemo(() => {
    const q = employeeSearch.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter((emp) => {
      const name = emp.name.toLowerCase();
      const email = (emp.email ?? "").toLowerCase();
      return name.includes(q) || email.includes(q);
    });
  }, [employees, employeeSearch]);

  const usageYearOptions = useMemo(() => {
    const years = new Set<number>([currentYear, currentYear - 1]);
    for (const req of allRequests) {
      const startYear = Number(req.startDate.slice(0, 4));
      const endYear = Number(req.endDate.slice(0, 4));
      if (Number.isFinite(startYear)) years.add(startYear);
      if (Number.isFinite(endYear)) years.add(endYear);
    }
    return [...years].sort((a, b) => b - a);
  }, [allRequests, currentYear]);

  /** Approved + pending — applied paid leave should zero that month’s remaining PL. */
  const activeInYear = useMemo(
    () =>
      allRequests.filter(
        (r) =>
          (r.status === "approved" || r.status === "pending") &&
          (r.startDate.startsWith(String(usageYear)) ||
            r.endDate.startsWith(String(usageYear))),
      ),
    [allRequests, usageYear],
  );

  const overridePaidByKey = useMemo(() => {
    const map = new Map<string, number>();
    for (const override of overridesData?.overrides ?? []) {
      map.set(`${override.userId}-${override.month}`, override.paidDaysUsed);
    }
    return map;
  }, [overridesData?.overrides]);

  const monthlyUsage = useMemo(() => {
    type MonthBucket = {
      /** Allocated PL usage after borrowing from previous months. */
      paidDays: number;
      /** Calendar days of paid leave that fall in this month (before borrowing). */
      rawPaidDays: number;
      /** Leaves whose dates fall in this calendar month (no WFH). */
      requests: LeaveRequestRow[];
      /**
       * Paid leaves from a later month that borrowed this month’s PL.
       * Used only when this month has no calendar leave, so the info icon still works.
       */
      borrowRequests: LeaveRequestRow[];
    };

    const months = MONTH_LABELS.map((_, monthIndex) => {
      const month = monthIndex + 1;
      const byEmployee = new Map<number, MonthBucket>();
      for (const emp of employees) {
        byEmployee.set(emp.id, {
          paidDays: 0,
          rawPaidDays: 0,
          requests: [],
          borrowRequests: [],
        });
      }
      return { month, label: MONTH_LABELS[monthIndex], byEmployee };
    });

    // 1) Collect raw calendar paid days + requests per month.
    for (const req of activeInYear) {
      // Month detail lists show leave taken in that calendar month only (no WFH).
      if (isWorkFromHomeLeave(req.leaveType)) continue;

      const half = isHalfDayLeave(req);
      const userId = Number(req.userId);
      for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
        const month = monthIndex + 1;
        const touches = leaveTouchesMonth(
          req.startDate,
          req.endDate,
          usageYear,
          month,
          req.leaveType,
          half,
        );
        if (!touches) continue;

        const bucket = months[monthIndex].byEmployee.get(userId);
        if (!bucket) continue;
        if (!bucket.requests.some((r) => r.id === req.id)) {
          bucket.requests.push(req);
        }

        const days = leaveDaysInMonth(
          req.startDate,
          req.endDate,
          usageYear,
          month,
          req.leaveType,
          half,
        );
        if (days > 0 && consumesPaidBalance(req.leaveType)) {
          bucket.rawPaidDays += days;
        }
      }
    }

    // 2) Allocate PL across months: current month first; excess borrows only from
    //    the immediately previous month (not further back).
    //    Pre-joining + probation months have 0 capacity.
    for (const emp of employees) {
      const employmentType = resolveEmploymentType(emp);
      const capacities = paidLeaveMonthCapacities(
        usageYear,
        emp.dateOfJoining,
        employmentType,
        emp.onNoticePeriod,
      );
      const rawActive = months.map((row) => row.byEmployee.get(emp.id)?.rawPaidDays ?? 0);
      const allocatedActive = allocatePaidLeaveAcrossMonths(rawActive, capacities);

      for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
        const bucket = months[monthIndex].byEmployee.get(emp.id);
        if (!bucket) continue;
        bucket.paidDays = allocatedActive[monthIndex] ?? 0;
      }

      // When a later month overflows, it borrows only from the immediately previous
      // month — attach that later leave onto the borrowed month for the info icon.
      // Only used when the borrowed month has no leave of its own.
      for (let monthIndex = 1; monthIndex < 12; monthIndex += 1) {
        const raw = rawActive[monthIndex] ?? 0;
        const monthCap = capacities[monthIndex] ?? MONTHLY_PAID_LEAVES;
        if (raw <= monthCap) continue;
        const sourceBucket = months[monthIndex].byEmployee.get(emp.id);
        if (!sourceBucket) continue;
        const paidSourceReqs = sourceBucket.requests.filter((r) =>
          consumesPaidBalance(r.leaveType),
        );
        if (paidSourceReqs.length === 0) continue;

        const prev = monthIndex - 1;
        const prevBucket = months[prev].byEmployee.get(emp.id);
        if (!prevBucket) continue;
        const borrowedAmt = allocatedActive[prev] ?? 0;
        const prevRaw = rawActive[prev] ?? 0;
        if (borrowedAmt <= prevRaw) continue;
        // Prefer calendar-month leaves when present.
        if (prevBucket.requests.length > 0) continue;
        for (const req of paidSourceReqs) {
          if (!prevBucket.borrowRequests.some((r) => r.id === req.id)) {
            prevBucket.borrowRequests.push(req);
          }
        }
      }
    }

    const totalsByEmployee = new Map<
      number,
      { paid: number; sick: number; paidRequests: LeaveRequestRow[]; sickRequests: LeaveRequestRow[] }
    >();
    for (const emp of employees) {
      totalsByEmployee.set(emp.id, {
        paid: 0,
        sick: 0,
        paidRequests: [],
        sickRequests: [],
      });
    }

    // Year Used PL = applied (pending + approved) paid days in this year.
    // Denominator is always 12 (annual entitlement); monthly cells handle probation zeros.
    for (const req of activeInYear) {
      if (isWorkFromHomeLeave(req.leaveType)) continue;
      const half = isHalfDayLeave(req);
      let daysInYear = 0;
      for (let month = 1; month <= 12; month += 1) {
        daysInYear += leaveDaysInMonth(
          req.startDate,
          req.endDate,
          usageYear,
          month,
          req.leaveType,
          half,
        );
      }
      if (daysInYear <= 0) continue;
      const bucket = totalsByEmployee.get(req.userId) ?? {
        paid: 0,
        sick: 0,
        paidRequests: [],
        sickRequests: [],
      };
      if (consumesSickBalance(req.leaveType)) {
        // Sick year total still counts approved only (matches Used SL column).
        if (req.status === "approved") {
          bucket.sick += daysInYear;
          bucket.sickRequests.push(req);
        }
      } else if (consumesPaidBalance(req.leaveType)) {
        bucket.paid += daysInYear;
        bucket.paidRequests.push(req);
      }
      totalsByEmployee.set(req.userId, bucket);
    }

    // Manual month overrides can increase used beyond request-based totals.
    for (const emp of employees) {
      let overrideExtra = 0;
      for (const row of months) {
        const autoPaid = row.byEmployee.get(emp.id)?.paidDays ?? 0;
        const overridePaid = overridePaidByKey.get(`${emp.id}-${row.month}`);
        if (overridePaid != null && overridePaid > autoPaid) {
          overrideExtra += overridePaid - autoPaid;
        }
      }
      const bucket = totalsByEmployee.get(emp.id);
      if (bucket && overrideExtra > 0) {
        bucket.paid = Math.round((bucket.paid + overrideExtra) * 10) / 10;
      } else if (bucket) {
        bucket.paid = Math.round(bucket.paid * 10) / 10;
      }
    }

    return { months, totalsByEmployee };
  }, [activeInYear, employees, usageYear, overridePaidByKey]);

  /** All employees with WFH usage for the selected year (pending + approved). */
  const wfhUsageByEmployee = useMemo(() => {
    type WfhDay = {
      date: string;
      status: string;
      requestId: number;
      reason: string;
    };

    type WfhEntry = {
      employee: EmployeeColumn;
      days: WfhDay[];
      usedDays: number;
      pendingDays: number;
      approvedDays: number;
      requests: LeaveRequestRow[];
    };

    const byEmployee = new Map<number, WfhEntry>();

    for (const emp of employees) {
      byEmployee.set(emp.id, {
        employee: emp,
        days: [],
        usedDays: 0,
        pendingDays: 0,
        approvedDays: 0,
        requests: [],
      });
    }

    const wfhRequests = allRequests.filter(
      (r) =>
        isWorkFromHomeLeave(r.leaveType) &&
        (r.status === "approved" || r.status === "pending") &&
        (r.startDate.startsWith(String(usageYear)) ||
          r.endDate.startsWith(String(usageYear))),
    );

    for (const req of wfhRequests) {
      let bucket = byEmployee.get(req.userId);
      if (!bucket) {
        bucket = {
          employee: {
            id: req.userId,
            name:
              req.employee?.name?.trim() ||
              req.employee?.email ||
              `User #${req.userId}`,
            email: req.employee?.email ?? null,
            avatar: req.employee?.avatar ?? null,
          },
          days: [],
          usedDays: 0,
          pendingDays: 0,
          approvedDays: 0,
          requests: [],
        };
        byEmployee.set(req.userId, bucket);
      }

      bucket.requests.push(req);
      const dateKeys = leaveDateKeysInYear(req.startDate, req.endDate, usageYear);
      for (const date of dateKeys) {
        bucket.days.push({
          date,
          status: req.status,
          requestId: req.id,
          reason: req.reason,
        });
        bucket.usedDays += 1;
        if (req.status === "approved") bucket.approvedDays += 1;
        else bucket.pendingDays += 1;
      }
    }

    for (const bucket of byEmployee.values()) {
      bucket.days.sort((a, b) => a.date.localeCompare(b.date));
    }

    return [...byEmployee.values()].sort((a, b) =>
      a.employee.name.localeCompare(b.employee.name),
    );
  }, [allRequests, employees, usageYear]);

  type WfhDayRow = {
    date: string;
    status: string;
    requestId: number;
    reason: string;
  };

  type WfhListEntry = (typeof wfhUsageByEmployee)[number] & {
    matchedDays: WfhDayRow[];
  };

  /** Parse free-text into YYYY-MM-DD when possible (supports ISO and DD-MM-YYYY). */
  const parsedWfhSearchDate = useMemo(() => {
    const raw = wfhSearch.trim();
    if (!raw) return null;

    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

    const dmy = raw.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
    if (dmy) {
      const day = dmy[1].padStart(2, "0");
      const month = dmy[2].padStart(2, "0");
      const year = dmy[3];
      return `${year}-${month}-${day}`;
    }

    // Partial ISO like 2026-07 or 2026-07-0
    if (/^\d{4}-\d{2}(-\d{0,2})?$/.test(raw)) return raw;

    return null;
  }, [wfhSearch]);

  const filteredWfhUsage = useMemo((): WfhListEntry[] => {
    const q = wfhSearch.trim().toLowerCase();
    if (!q) {
      return wfhUsageByEmployee.map((entry) => ({
        ...entry,
        matchedDays: entry.days,
      }));
    }

    const dateKey = parsedWfhSearchDate;
    const results: WfhListEntry[] = [];

    for (const entry of wfhUsageByEmployee) {
      if (dateKey) {
        const matchingDays = entry.days.filter((d) => d.date.startsWith(dateKey));
        if (matchingDays.length === 0) continue;
        results.push({ ...entry, matchedDays: matchingDays });
        continue;
      }

      const name = entry.employee.name.toLowerCase();
      const email = (entry.employee.email ?? "").toLowerCase();
      const matchingDays = entry.days.filter(
        (d) =>
          d.date.includes(q) ||
          formatWorkZoneDateKey(d.date, {
            weekday: "short",
            day: "numeric",
            month: "short",
            year: "numeric",
          })
            .toLowerCase()
            .includes(q),
      );
      if (!name.includes(q) && !email.includes(q) && matchingDays.length === 0) continue;
      results.push({
        ...entry,
        matchedDays: matchingDays.length > 0 && !name.includes(q) && !email.includes(q)
          ? matchingDays
          : entry.days,
      });
    }

    return results;
  }, [wfhUsageByEmployee, wfhSearch, parsedWfhSearchDate]);

  // Auto-expand employees when searching by date so matching WFH days are visible.
  const dateSearchEmployeeKey = useMemo(() => {
    if (!parsedWfhSearchDate) return "";
    return filteredWfhUsage.map((e) => e.employee.id).join(",");
  }, [parsedWfhSearchDate, filteredWfhUsage]);

  useEffect(() => {
    if (!parsedWfhSearchDate || !dateSearchEmployeeKey) return;
    setExpandedWfhIds(
      new Set(
        dateSearchEmployeeKey
          .split(",")
          .filter(Boolean)
          .map((id) => Number(id)),
      ),
    );
  }, [parsedWfhSearchDate, dateSearchEmployeeKey]);

  const toggleWfhExpanded = (employeeId: number) => {
    setExpandedWfhIds((prev) => {
      const next = new Set(prev);
      if (next.has(employeeId)) next.delete(employeeId);
      else next.add(employeeId);
      return next;
    });
  };

  const saveMonthlyRemaining = (
    userId: number,
    month: number,
    autoPaidDays: number,
    nextRemaining: number,
  ) => {
    const autoRemaining = remainingMonthlyPaidLeave(autoPaidDays);
    const rounded =
      Math.round(Math.min(Math.max(0, nextRemaining), MONTHLY_PAID_LEAVES) * 2) / 2;
    // Remaining can't go above the auto-calculated remaining (applied leaves win).
    const clamped = Math.min(rounded, autoRemaining);
    setUsageOverrideMutation.mutate({
      userId,
      year: usageYear,
      month,
      // Clear override when matching auto remaining (API treats 1 as “no usage stored”).
      remainingPaid: clamped >= autoRemaining ? MONTHLY_PAID_LEAVES : clamped,
    });
  };

  const openCellLeaves = (
    employee: EmployeeColumn,
    label: string,
    requestsForCell: LeaveRequestRow[],
  ) => {
    if (requestsForCell.length === 0) return;
    if (requestsForCell.length === 1) {
      setSelectedRequest(requestsForCell[0]);
      return;
    }
    setCellLeaves({
      employeeName: employee.name,
      label,
      requests: requestsForCell,
    });
  };

  if (!allowed) {
    return <Navigate to="/leaves" replace />;
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <ClipboardList size={24} className="text-[#0EA5E9]" />
            <h1 className="text-2xl font-bold text-[#1F2937]">Leave management</h1>
          </div>
          <p className="text-sm text-gray-500">
            Review and approve leave requests from employees.
            {pendingCount > 0 ? ` ${pendingCount} pending.` : ""}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {(
          [
            { key: "all", label: "All" },
            { key: "pending", label: "Pending" },
            { key: "approved", label: "Approved" },
            { key: "rejected", label: "Rejected" },
            { key: "cancelled", label: "Cancelled" },
            { key: "wfh", label: "WFH Requests" },
          ] as const
        ).map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setFilter(tab.key)}
            className={cn(
              "h-9 px-3 rounded-lg text-sm font-medium border transition-colors",
              filter === tab.key
                ? tab.key === "wfh"
                  ? "bg-teal-600 text-white border-teal-600"
                  : "bg-[#2563EB] text-white border-[#2563EB]"
                : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50",
            )}
          >
            {tab.label}
            {tab.key === "pending" && pendingCount > 0 ? ` (${pendingCount})` : ""}
            {tab.key === "wfh" && wfhCount > 0 ? ` (${wfhCount})` : ""}
          </button>
        ))}
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={24} className="animate-spin text-gray-400" />
          </div>
        ) : requests.length === 0 ? (
          <div className="py-16 text-center text-sm text-gray-500">
            {filter === "wfh"
              ? "No work-from-home requests yet."
              : "No leave requests in this view."}
          </div>
        ) : (
          <div className="max-h-[26.25rem] overflow-y-auto overscroll-contain divide-y divide-gray-100 scrollbar-thin">
            {requests.map((req) => {
              const reviewing =
                reviewMutation.isPending && reviewMutation.variables?.id === req.id;
              return (
                <div
                  key={req.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedRequest(req)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelectedRequest(req);
                    }
                  }}
                  className="p-5 flex flex-col gap-4 sm:flex-row sm:items-start cursor-pointer hover:bg-gray-50/80 transition-colors"
                >
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <UserAvatar
                      name={req.employee?.name}
                      avatar={req.employee?.avatar}
                      size={40}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-[#1F2937]">
                          {req.employee?.name ?? req.employee?.email ?? `User #${req.userId}`}
                        </span>
                        <StatusBadge status={req.status} />
                        <span
                          className={cn(
                            "text-[11px] font-medium px-2 py-0.5 rounded-full",
                            leaveRequestTypeBadgeClass(req.leaveType),
                          )}
                        >
                          {isWorkFromHomeLeave(req.leaveType)
                            ? "WFH"
                            : leaveTypeLabel(req.leaveType as LeaveType, {
                                isHalfDay: req.isHalfDay,
                                days: req.days,
                              })}
                        </span>
                      </div>
                      {req.employee?.department ? (
                        <div className="text-xs text-gray-400 mt-0.5">
                          {req.employee.department}
                        </div>
                      ) : null}
                      <div className="text-sm text-gray-700 mt-2">
                        <span className="font-medium">
                          {req.startDate === req.endDate
                            ? req.startDate
                            : `${req.startDate} → ${req.endDate}`}
                        </span>
                        <span className="text-gray-400">
                          {" "}
                          · {formatLeaveDays(req.days)}
                        </span>
                      </div>
                      <p className="text-sm text-gray-600 mt-1.5 whitespace-pre-wrap line-clamp-2">
                        {req.reason}
                      </p>
                      <p className="text-[11px] text-gray-400 mt-2">
                        Applied {formatWorkZoneDateTime(req.createdAt)}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {req.status === "pending" ? (
                      <>
                        <button
                          type="button"
                          disabled={reviewing}
                          onClick={(e) => {
                            e.stopPropagation();
                            reviewMutation.mutate({ id: req.id, status: "approved" });
                          }}
                          className="h-9 px-3 rounded-lg text-sm font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 inline-flex items-center gap-1.5 disabled:opacity-50"
                        >
                          {reviewing && reviewMutation.variables?.status === "approved" ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <Check size={14} />
                          )}
                          Approve
                        </button>
                        <button
                          type="button"
                          disabled={reviewing}
                          onClick={(e) => {
                            e.stopPropagation();
                            reviewMutation.mutate({ id: req.id, status: "rejected" });
                          }}
                          className="h-9 px-3 rounded-lg text-sm font-medium bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 inline-flex items-center gap-1.5 disabled:opacity-50"
                        >
                          {reviewing && reviewMutation.variables?.status === "rejected" ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <X size={14} />
                          )}
                          Reject
                        </button>
                      </>
                    ) : null}
                    <ChevronRight size={16} className="text-gray-300" />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>


      <div className="flex items-center justify-end gap-2 w-full">
        <button type="button" onClick={() => setManualOpen(true)} className="h-10 px-4 rounded-lg bg-[#2563EB] text-white text-sm font-semibold inline-flex items-center gap-1.5 hover:bg-[#1D4ED8] shrink-0">
          <Plus size={16} /> Manual leave entry
        </button>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <button
          type="button"
          onClick={() => setLeaveUsageExpanded((open) => !open)}
          aria-expanded={leaveUsageExpanded}
          className="w-full px-5 py-3.5 flex items-center justify-between gap-3 text-left hover:bg-gray-50 transition-colors"
        >
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-[#1F2937]">Employee leave usage</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Monthly paid leave remaining and annual sick leave usage
              {!leaveUsageExpanded ? ` · ${usageYear}` : ""}
            </p>
          </div>
          <ChevronDown
            size={18}
            className={cn(
              "shrink-0 text-gray-400 transition-transform",
              leaveUsageExpanded && "rotate-180",
            )}
          />
        </button>

        {leaveUsageExpanded ? (
          <div className="border-t border-gray-100">
            <div className="px-4 sm:px-5 py-4 border-b border-gray-100 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-gray-500 max-w-3xl">
                Each eligible month shows {MONTHLY_PAID_LEAVES} paid leave. Months before joining and
                the probation window show 0 (3 months for full-time, 6 for interns). Joining on/after
                the 20th starts that window the next month — e.g. join 20 Apr → no PL in May–Jul.
                Used PL is used/entitlement; Remain PL is entitlement minus used. Extra paid days
                in a month borrow only from the immediately previous month (e.g. August → July),
                not from earlier months. Sick leave is {TOTAL_SICK_LEAVES}/year (1 per 4 months);
                WFH is {TOTAL_WFH_DAYS}/year (5 per 3 months) — both prorated by joining month.
              </p>

              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search
                    size={15}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
                  />
                  <input
                    type="search"
                    value={employeeSearch}
                    onChange={(e) => setEmployeeSearch(e.target.value)}
                    placeholder="Search employees…"
                    className="h-9 w-52 sm:w-64 pl-9 pr-3 rounded-lg border border-gray-200 bg-white text-sm text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]"
                  />
                </div>
                <label className="flex items-center gap-2 text-sm text-gray-600 shrink-0">
                  Year
                  <select
                    value={usageYear}
                    onChange={(e) => setUsageYear(Number(e.target.value))}
                    className="h-9 px-2.5 rounded-lg border border-gray-200 bg-white text-sm text-gray-800"
                  >
                    {usageYearOptions.map((year) => (
                      <option key={year} value={year}>
                        {year}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            {employees.length === 0 ? (
              <div className="py-12 text-center text-sm text-gray-500">
                No employees to show yet.
              </div>
            ) : filteredUsageEmployees.length === 0 ? (
              <div className="py-12 text-center text-sm text-gray-500">
                No employees match “{employeeSearch.trim()}”.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1100px] text-sm border-collapse">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="sticky left-0 z-10 bg-gray-50 text-left text-sm font-semibold text-gray-500 pl-3 pr-2 py-2.5 border-b border-gray-100 min-w-[160px]">
                        Employee
                        {employeeSearch.trim() ? (
                          <span className="ml-1 font-normal text-gray-400">
                            ({filteredUsageEmployees.length})
                          </span>
                        ) : null}
                      </th>
                      {monthlyUsage.months.map((row) => (
                        <th
                          key={row.month}
                          className="text-center text-sm font-semibold text-gray-600 px-1 py-2.5 border-b border-gray-100 min-w-[44px]"
                        >
                          {row.label}
                        </th>
                      ))}
                      <th className="text-center text-sm font-semibold text-blue-800 px-1 py-2.5 border-b border-gray-100 bg-blue-50/60 whitespace-nowrap">
                        Used PL
                      </th>
                      <th className="text-center text-sm font-semibold text-green-800 px-1 py-2.5 border-b border-gray-100 bg-green-50/60 whitespace-nowrap">
                        Remain PL
                      </th>
                      <th className="text-center text-sm font-semibold text-red-800 px-1 py-2.5 border-b border-gray-100 bg-red-50/60 whitespace-nowrap">
                        Used SL
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                {filteredUsageEmployees.map((emp) => {
                  const totals = monthlyUsage.totalsByEmployee.get(emp.id);
                  const paidDays = totals?.paid ?? 0;
                  const sickDays = totals?.sick ?? 0;
                  const employmentType = resolveEmploymentType(emp);
                  const monthCaps = paidLeaveMonthCapacities(
                    usageYear,
                    emp.dateOfJoining,
                    employmentType,
                    emp.onNoticePeriod,
                  );
                  const paidEntitlement = annualPaidLeaveEntitlement(
                    usageYear,
                    emp.dateOfJoining,
                    employmentType,
                    emp.onNoticePeriod,
                  );
                  const paidRemaining = Math.max(0, paidEntitlement - paidDays);
                  const sickEntitlement = annualSickLeaveEntitlement(
                    usageYear,
                    emp.dateOfJoining,
                  );
                  const sickRemaining = Math.max(0, sickEntitlement - sickDays);

                  return (
                    <tr key={emp.id} className="hover:bg-gray-50/60">
                      <td className="sticky left-0 z-10 bg-white text-sm font-medium text-gray-800 pl-3 pr-2 py-2 border-b border-gray-50">
                        <div className="flex items-center gap-2 min-w-0">
                          <UserAvatar name={emp.name} avatar={emp.avatar} size={25} />
                          <span
                            className="leading-snug break-words"
                            title={
                              emp.dateOfJoining
                                ? `${emp.name} · joined ${emp.dateOfJoining}`
                                : emp.name
                            }
                          >
                            {emp.name}
                          </span>
                        </div>
                      </td>
                      {monthlyUsage.months.map((row) => {
                        const cell = row.byEmployee.get(emp.id) ?? {
                          paidDays: 0,
                          rawPaidDays: 0,
                          requests: [] as LeaveRequestRow[],
                          borrowRequests: [] as LeaveRequestRow[],
                        };
                        const monthCapacity = monthCaps[row.month - 1] ?? MONTHLY_PAID_LEAVES;
                        const probationLocked = isPaidLeaveMonthLocked(
                          usageYear,
                          row.month,
                          emp.dateOfJoining,
                          employmentType,
                          emp.onNoticePeriod,
                        );
                        // Allocated usage (includes borrowing from previous months).
                        const autoPaid = cell.paidDays;
                        const overridePaid = overridePaidByKey.get(`${emp.id}-${row.month}`);
                        const effectivePaid = Math.max(autoPaid, overridePaid ?? 0);
                        const remaining = probationLocked
                          ? 0
                          : remainingMonthlyPaidLeave(effectivePaid, monthCapacity);
                        // Calendar leaves first; borrowRequests cover months that only lent PL.
                        const detailRequests =
                          cell.requests.length > 0
                            ? cell.requests
                            : cell.borrowRequests;
                        const hasLeave = detailRequests.length > 0;
                        const usedPaid = effectivePaid > 0;
                        const borrowed = (cell.paidDays ?? 0) > (cell.rawPaidDays ?? 0);
                        const isManual =
                          !probationLocked &&
                          overridePaid != null &&
                          overridePaid > autoPaid;
                        return (
                          <td
                            key={row.month}
                            className="text-center p-0 py-1.5 border-b border-gray-50"
                          >
                            <div className="inline-flex items-center justify-center gap-0.5">
                              <MonthlyRemainingInput
                                value={remaining}
                                max={remainingMonthlyPaidLeave(autoPaid, monthCapacity)}
                                disabled={
                                  setUsageOverrideMutation.isPending || probationLocked
                                }
                                isManual={isManual}
                                usedPaid={usedPaid}
                                hasLeave={hasLeave}
                                title={
                                  probationLocked
                                    ? emp.onNoticePeriod
                                      ? "No paid leave while on notice period (current and future months)"
                                      : monthCapacity === 0 && emp.dateOfJoining
                                      ? employmentType === "intern"
                                        ? "No paid leave (before joining, or 6 months: 3 internship + 3 probation; starts next month if joined on/after the 20th)"
                                        : "No paid leave (before joining, or 3 months probation; starts next month if joined on/after the 20th)"
                                      : "No paid leave for this month"
                                    : isManual
                                      ? `Manual PL remaining · auto remaining ${remainingMonthlyPaidLeave(autoPaid, monthCapacity)}`
                                      : borrowed
                                        ? `Borrowed for later leave · ${effectivePaid} used · ${remaining} remaining`
                                        : usedPaid
                                          ? `${effectivePaid} paid leave day(s) used · ${remaining} remaining`
                                          : hasLeave
                                            ? `Leave taken (not PL) · ${remaining} paid leave remaining`
                                            : `${monthCapacity} paid leave available · click to edit`
                                }
                                onCommit={(next) =>
                                  saveMonthlyRemaining(emp.id, row.month, autoPaid, next)
                                }
                              />
                              {hasLeave ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    openCellLeaves(
                                      emp,
                                      `${row.label} ${usageYear}`,
                                      detailRequests,
                                    )
                                  }
                                  title="View leave requests"
                                  className="h-5 w-5 rounded text-[10px] font-bold text-gray-400 hover:text-[#2563EB] hover:bg-blue-50"
                                >
                                  i
                                </button>
                              ) : null}
                            </div>
                          </td>
                        );
                      })}
                      <td className="text-center px-1 py-1.5 border-b border-gray-50 bg-blue-50/30">
                        <button
                          type="button"
                          disabled={paidDays === 0}
                          onClick={() =>
                            openCellLeaves(
                              emp,
                              `Paid leave ${usageYear}`,
                              totals?.paidRequests ?? [],
                            )
                          }
                          title={`${paidDays} used of ${paidEntitlement} entitled paid leaves this year`}
                          className={cn(
                            "inline-flex h-8 px-1 items-center justify-center rounded-md text-sm tabular-nums whitespace-nowrap",
                            paidDays > 0
                              ? "font-semibold text-blue-700 bg-blue-100/80 hover:bg-blue-100"
                              : "text-gray-400",
                          )}
                        >
                          {paidDays}/{paidEntitlement}
                        </button>
                      </td>
                      <td className="text-center px-1 py-1.5 border-b border-gray-50 bg-green-50/30">
                        <span
                          className="inline-flex h-8 px-1 items-center justify-center text-sm tabular-nums text-green-800"
                          title={`${paidEntitlement} entitled − ${paidDays} used = ${paidRemaining} remaining`}
                        >
                          {paidRemaining}
                        </span>
                      </td>
                      <td className="text-center px-1 py-1.5 border-b border-gray-50 bg-red-50/30">
                        <button
                          type="button"
                          disabled={sickDays === 0}
                          onClick={() =>
                            openCellLeaves(
                              emp,
                              `Sick leave ${usageYear}`,
                              totals?.sickRequests ?? [],
                            )
                          }
                          title={`${sickDays} used · ${sickRemaining} remaining of ${sickEntitlement}`}
                          className={cn(
                            "inline-flex h-8 px-1 items-center justify-center rounded-md text-sm tabular-nums whitespace-nowrap",
                            sickDays > 0
                              ? "font-semibold text-red-700 bg-red-100/80 hover:bg-red-100"
                              : "text-gray-400",
                          )}
                        >
                          {sickDays}/{sickEntitlement}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
              </div>
            )}
          </div>
        ) : null}
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <button
          type="button"
          onClick={() => setWfhUsageExpanded((open) => !open)}
          aria-expanded={wfhUsageExpanded}
          className="w-full px-5 py-3.5 flex items-center justify-between gap-3 text-left hover:bg-gray-50 transition-colors"
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Home size={18} className="text-teal-600" />
              <h2 className="text-sm font-semibold text-[#1F2937]">Work from home usage</h2>
            </div>
            <p className="text-xs text-gray-500 mt-0.5">
              Up to {TOTAL_WFH_DAYS} WFH days/year (5 per 3 months), prorated by joining month
              {!wfhUsageExpanded ? ` · ${usageYear}` : ""}
            </p>
          </div>
          <ChevronDown
            size={18}
            className={cn(
              "shrink-0 text-gray-400 transition-transform",
              wfhUsageExpanded && "rotate-180",
            )}
          />
        </button>

        {wfhUsageExpanded ? (
          <div className="border-t border-gray-100">
            <div className="px-5 py-4 border-b border-gray-100 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <p className="text-xs text-gray-500">
                  Showing {usageYear} · pending and approved count toward the total · WFH
                  allotment drops by 5 for each full 3-month span before joining
                </p>
                <button type="button" onClick={() => setManualWfhOpen(true)} className="h-10 px-4 rounded-lg bg-teal-600 text-white text-sm font-semibold inline-flex items-center gap-1.5 hover:bg-teal-700 shrink-0">
                  <Plus size={16} /> Manual WFH entry
                </button>
              </div>

              <div className="relative max-w-md">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"/>
                <input type="search" value={wfhSearch} onChange={(e) => setWfhSearch(e.target.value)} placeholder="Search employee or date (e.g. 2026-07-03 or 03-07-2026)…" className="w-full h-10 pl-9 pr-3 rounded-lg border border-gray-200 bg-white text-sm text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-600"/>
              </div>
              {parsedWfhSearchDate ? (
                <p className="text-xs text-teal-700">
                  Showing employees with WFH on dates matching{" "}
                  <span className="font-semibold">{parsedWfhSearchDate}</span>
                  {filteredWfhUsage.length > 0 ? ` · ${filteredWfhUsage.length} found` : ""}
                </p>
              ) : null}
            </div>

            {employees.length === 0 ? (
              <div className="py-12 text-center text-sm text-gray-500">No employees to show yet.</div>
            ) : filteredWfhUsage.length === 0 ? (
              <div className="py-12 text-center text-sm text-gray-500">
                No employees match “{wfhSearch.trim()}”.
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {filteredWfhUsage.map((entry) => {
                  const wfhEntitlement = annualWfhEntitlement(
                    usageYear,
                    entry.employee.dateOfJoining,
                  );
                  const remaining = Math.max(0, wfhEntitlement - entry.usedDays);
                  const expanded = expandedWfhIds.has(entry.employee.id);
                  const daysToShow = entry.matchedDays;
                  const hasWfh = entry.usedDays > 0;

                  return (
                    <div key={entry.employee.id} className="bg-white">
                      <button type="button" onClick={() => toggleWfhExpanded(entry.employee.id)} aria-expanded={expanded} className="w-full px-5 py-3.5 flex items-center gap-3 text-left hover:bg-gray-50 transition-colors">
                        <ChevronDown size={16} className={cn("shrink-0 text-gray-400 transition-transform", expanded && "rotate-180",)}/>
                        <UserAvatar name={entry.employee.name} avatar={entry.employee.avatar} size={36}/>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-[#1F2937] truncate">
                            {entry.employee.name}
                          </div>
                          {entry.employee.email ? (
                            <div className="text-xs text-gray-400 truncate">{entry.employee.email}</div>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap items-center justify-end gap-1.5 text-xs shrink-0">
                          <span className="inline-flex items-center rounded-md bg-teal-50 px-2 py-0.5 font-semibold text-teal-700 tabular-nums">
                            {entry.usedDays}/{wfhEntitlement}
                          </span>
                          <span className="inline-flex items-center rounded-md bg-gray-50 px-2 py-0.5 font-medium text-gray-600 border border-gray-200 tabular-nums">
                            {remaining} left
                          </span>
                          {entry.pendingDays > 0 ? (
                            <span className="inline-flex items-center rounded-md bg-amber-50 px-2 py-0.5 font-medium text-amber-700 tabular-nums">
                              {entry.pendingDays} pending
                            </span>
                          ) : null}
                        </div>
                      </button>

                      {expanded ? (
                        <div className="px-5 pb-4 pl-14 sm:pl-[4.25rem]">
                          {!hasWfh ? (
                            <p className="text-xs text-gray-400 italic py-2">
                              No work from home days taken in {usageYear}.
                            </p>
                          ) : daysToShow.length === 0 ? (
                            <p className="text-xs text-gray-400 italic py-2">
                              No matching WFH dates for this search.
                            </p>
                          ) : (
                            <div className="rounded-lg border border-gray-200 bg-gray-50/50 p-3">
                              <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-2">
                                WFH entries ({daysToShow.length})
                                {parsedWfhSearchDate ? " · matching search" : ""}
                              </div>
                              <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                                {daysToShow.map((day) => (
                                  <li key={`${day.requestId}-${day.date}`}>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const req = entry.requests.find((r) => r.id === day.requestId);
                                        if (req) setSelectedRequest(req);
                                      }}
                                      title={day.reason}
                                      className="w-full flex items-center justify-between gap-2 rounded-lg border border-gray-100 bg-white px-3 py-2 text-left hover:border-teal-200 hover:bg-teal-50/50 transition-colors"
                                    >
                                      <span className="text-sm text-[#1F2937]">
                                        {formatWorkZoneDateKey(day.date, {
                                          weekday: "short",
                                          day: "numeric",
                                          month: "short",
                                          year: "numeric",
                                        })}
                                      </span>
                                      <span
                                        className={cn(
                                          "shrink-0 text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded",
                                          day.status === "approved"
                                            ? "bg-emerald-50 text-emerald-700"
                                            : "bg-amber-50 text-amber-700",
                                        )}
                                      >
                                        {day.status}
                                      </span>
                                    </button>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : null}
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <button
          type="button"
          onClick={() => setHolidaysExpanded((open) => !open)}
          aria-expanded={holidaysExpanded}
          className="w-full px-5 py-3.5 flex items-center justify-between gap-3 text-left hover:bg-gray-50 transition-colors"
        >
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-[#1F2937]">Public holidays</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Add company holidays. Employees can see them on the Leaves page.
              {!holidaysExpanded && holidays.length > 0
                ? ` · ${holidays.length} in ${holidayYear}`
                : ""}
            </p>
          </div>
          <ChevronDown
            size={18}
            className={cn(
              "shrink-0 text-gray-400 transition-transform",
              holidaysExpanded && "rotate-180",
            )}
          />
        </button>

        {holidaysExpanded ? (
          <div className="px-5 pb-5 space-y-4 border-t border-gray-100 pt-4">
            <div className="flex justify-end">
              <select
                value={holidayYear}
                onChange={(e) => setHolidayYear(Number(e.target.value))}
                className="h-9 px-3 rounded-lg border border-gray-200 text-sm bg-white"
              >
                {holidayYearOptions.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
              <div className="sm:w-44">
                <label className="block text-xs font-medium text-gray-500 mb-1">Date</label>
                <input
                  type="date"
                  value={holidayDate}
                  onChange={(e) => setHolidayDate(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]"
                />
              </div>
              <div className="flex-1 min-w-0">
                <label className="block text-xs font-medium text-gray-500 mb-1">Holiday name</label>
                <input type="text" value={holidayName} onChange={(e) => setHolidayName(e.target.value)} placeholder="e.g. Republic Day" className="w-full h-10 px-3 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]"/>
              </div>
              <button type="button" onClick={handleAddHoliday} disabled={addHolidayMutation.isPending} className="h-10 px-4 rounded-lg bg-[#2563EB] text-white text-sm font-semibold inline-flex items-center justify-center gap-1.5 hover:bg-[#1D4ED8] disabled:opacity-60 shrink-0">
                {addHolidayMutation.isPending ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Plus size={16} />
                )}
                Add holiday
              </button>
            </div>

            {holidaysLoading ? (
              <div className="flex justify-center py-6">
                <Loader2 size={20} className="animate-spin text-gray-400" />
              </div>
            ) : holidays.length === 0 ? (
              <p className="text-sm text-gray-500 py-2">
                No public holidays for {holidayYear} yet.
              </p>
            ) : (
              <div className="divide-y divide-gray-100 border border-gray-100 rounded-lg overflow-hidden">
                {holidays.map((holiday) => (
                  <PublicHolidayListRow
                    key={holiday.id}
                    date={holiday.date}
                    name={holiday.name}
                    todayKey={todayKey}
                    className="px-4 py-3"
                    actions={
                      <button
                        type="button"
                        title="Remove holiday"
                        aria-label={`Remove ${holiday.name}`}
                        disabled={deleteHolidayMutation.isPending}
                        onClick={() => deleteHolidayMutation.mutate({ id: holiday.id })}
                        className="h-8 w-8 inline-flex items-center justify-center rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-50"
                      >
                        <Trash2 size={15} />
                      </button>
                    }
                  />
                ))}
              </div>
            )}
          </div>
        ) : null}
      </div>

      <Dialog
        open={!!cellLeaves}
        onOpenChange={(open) => {
          if (!open) setCellLeaves(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Leave details</DialogTitle>
            <DialogDescription>
              {cellLeaves
                ? `${cellLeaves.employeeName} · ${cellLeaves.label}`
                : "Leave requests"}
            </DialogDescription>
          </DialogHeader>
          <div className="divide-y divide-gray-100 max-h-[60vh] overflow-y-auto -mx-1 px-1">
            {cellLeaves?.requests.map((req) => (
              <button
                key={req.id}
                type="button"
                onClick={() => {
                  setCellLeaves(null);
                  setSelectedRequest(req);
                }}
                className="w-full text-left py-3 hover:bg-gray-50 transition-colors rounded-lg px-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-gray-800">
                    {leaveTypeLabel(req.leaveType as LeaveType, {
                      isHalfDay: req.isHalfDay,
                      days: req.days,
                    })}
                  </span>
                  <StatusBadge status={req.status} />
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  {req.startDate === req.endDate
                    ? req.startDate
                    : `${req.startDate} → ${req.endDate}`}
                  {" · "}
                  {formatLeaveDays(req.days)}
                </div>
                <p className="text-xs text-gray-600 mt-1 line-clamp-2">{req.reason}</p>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <LeaveRequestDetailDialog
        request={selectedRequest}
        open={!!selectedRequest}
        reviewing={
          !!selectedRequest &&
          reviewMutation.isPending &&
          reviewMutation.variables?.id === selectedRequest.id
        }
        savingDetails={
          !!selectedRequest &&
          updateDetailsMutation.isPending &&
          updateDetailsMutation.variables?.id === selectedRequest.id
        }
        reviewStatus={reviewMutation.variables?.status}
        onOpenChange={(open) => {
          if (!open) setSelectedRequest(null);
        }}
        onSetStatus={(status, note) => {
          if (!selectedRequest) return;
          reviewMutation.mutate({
            id: selectedRequest.id,
            status,
            reviewNote: note || undefined,
          });
        }}
        onSaveDetails={(payload) => {
          if (!selectedRequest) return;
          updateDetailsMutation.mutate({
            id: selectedRequest.id,
            reason: payload.reason,
            reviewNote: payload.reviewNote,
          });
        }}
      />

      <ManualLeaveEntryDialog
        open={manualOpen}
        onOpenChange={setManualOpen}
        employees={(usersData?.users ?? []).map((u) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          avatar: u.avatar ?? null,
          department: u.department ?? null,
          dateOfJoining: toJoiningDateKey(u.dateOfJoining ?? null),
          employmentType: u.employmentType ?? null,
          position: u.position ?? null,
          onNoticePeriod: Boolean(u.onNoticePeriod),
        }))}
        existingLeaves={allRequests}
        submitting={createManualMutation.isPending && !manualWfhOpen}
        onSubmit={(payload) => createManualMutation.mutate(payload)}
      />

      <ManualWfhEntryDialog
        open={manualWfhOpen}
        onOpenChange={setManualWfhOpen}
        employees={(usersData?.users ?? []).map((u) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          avatar: u.avatar ?? null,
          department: u.department ?? null,
          dateOfJoining: toJoiningDateKey(u.dateOfJoining ?? null),
          employmentType: u.employmentType ?? null,
          position: u.position ?? null,
          onNoticePeriod: Boolean(u.onNoticePeriod),
        }))}
        existingLeaves={allRequests}
        submitting={createManualMutation.isPending && manualWfhOpen}
        onSubmit={(payload) => createManualMutation.mutate(payload)}
      />
    </motion.div>
  );
}

function MonthlyRemainingInput({
  value,
  max,
  disabled,
  isManual,
  usedPaid,
  hasLeave,
  title,
  onCommit,
}: {
  value: number;
  max: number;
  disabled?: boolean;
  isManual?: boolean;
  usedPaid?: boolean;
  hasLeave?: boolean;
  title?: string;
  onCommit: (next: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = () => {
    const parsed = Number(draft);
    if (!Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    const rounded = Math.round(parsed * 2) / 2;
    if (rounded === value) {
      setDraft(String(value));
      return;
    }
    onCommit(rounded);
  };

  return (
    <input
      type="number"
      inputMode="decimal"
      min={0}
      max={max}
      step={0.5}
      value={draft}
      disabled={disabled}
      title={title}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.currentTarget.blur();
        }
        if (e.key === "Escape") {
          setDraft(String(value));
          e.currentTarget.blur();
        }
      }}
      className={cn(
        "w-8 h-8 text-center rounded-md text-sm tabular-nums border border-transparent focus:outline-none focus:ring-2 focus:ring-[#2563EB]/25 focus:border-[#2563EB] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
        disabled
          ? "font-medium text-gray-400 bg-gray-100 cursor-not-allowed"
          : isManual
            ? "font-semibold text-violet-700 bg-violet-50"
            : usedPaid
              ? "font-semibold text-[#2563EB] bg-blue-50"
              : hasLeave
                ? "font-semibold text-amber-700 bg-amber-50"
                : "text-gray-600 bg-gray-50 hover:bg-gray-100",
      )}
    />
  );
}

function employeeHasLeaveOnRange(
  existingLeaves: Array<{
    userId: number;
    status: string;
    startDate: string;
    endDate: string;
  }>,
  userId: number,
  startDate: string,
  endDate: string,
) {
  const uid = Number(userId);
  for (const req of existingLeaves) {
    if (Number(req.userId) !== uid) continue;
    const status = String(req.status ?? "").toLowerCase();
    if (status !== "pending" && status !== "approved") continue;
    if (firstOverlappingLeaveDate(startDate, endDate, req)) return true;
  }
  return false;
}

function ManualLeaveEntryDialog({
  open,
  onOpenChange,
  employees,
  existingLeaves,
  submitting,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employees: ManualEntryEmployee[];
  existingLeaves: Array<{
    userId: number;
    status: string;
    startDate: string;
    endDate: string;
  }>;
  submitting: boolean;
  onSubmit: (payload: {
    userId: number;
    leaveType: "paid" | "sick" | "unpaid" | "wfh";
    startDate: string;
    endDate: string;
    reason: string;
    isHalfDay: boolean;
    status: "approved" | "rejected";
    reviewNote?: string;
  }) => void;
}) {
  const [userId, setUserId] = useState<number | "">("");
  const [leaveType, setLeaveType] = useState<"paid" | "sick" | "unpaid" | "wfh">("paid");
  const [duration, setDuration] = useState<LeaveDuration>("full");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState<"approved" | "rejected">("approved");
  const [reviewNote, setReviewNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const isHalfDay = duration === "half";
  const effectiveEnd = isHalfDay ? startDate : endDate || startDate;
  const days =
    startDate && effectiveEnd
      ? leaveDayUnits(leaveType, startDate, effectiveEnd, isHalfDay)
      : 0;

  const selectedEmployee =
    userId === "" ? null : employees.find((e) => e.id === userId) ?? null;
  const wfhBlockedReason = employeeWfhBlockedReason(selectedEmployee);

  const blockedDates = useMemo(
    () => approvedLeaveDateKeysForUser(existingLeaves, userId),
    [existingLeaves, userId],
  );

  useEffect(() => {
    if (!open) return;
    setUserId("");
    setLeaveType("paid");
    setDuration("full");
    setStartDate("");
    setEndDate("");
    setReason("");
    setStatus("approved");
    setReviewNote("");
    setError(null);
  }, [open]);

  useEffect(() => {
    if (isHalfDay && startDate) setEndDate(startDate);
  }, [isHalfDay, startDate]);

  useEffect(() => {
    if (startDate && blockedDates.has(startDate)) {
      setStartDate("");
      setEndDate("");
      return;
    }
    if (endDate && blockedDates.has(endDate)) setEndDate("");
  }, [blockedDates, startDate, endDate]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setError(null);

    if (userId === "") {
      setError("Please select an employee.");
      return;
    }
    if (!startDate) {
      setError("Please select the leave date.");
      return;
    }
    if (days <= 0) {
      setError("End date must be on or after the start date.");
      return;
    }
    if (!isWorkFromHomeLeave(leaveType) && reason.trim().length < 3) {
      setError("Please enter a reason (at least 3 characters).");
      return;
    }

    const submitEnd = isHalfDay ? startDate : endDate || startDate;
    if (employeeHasLeaveOnRange(existingLeaves, userId, startDate, submitEnd)) {
      const message = leaveAlreadyExistsForEmployeeMessage(startDate);
      setError(message);
      toast.error(message);
      return;
    }

    if (isWorkFromHomeLeave(leaveType) && wfhBlockedReason) {
      setError(wfhBlockedReason);
      toast.error(wfhBlockedReason);
      return;
    }

    onSubmit({
      userId,
      leaveType,
      startDate,
      endDate: submitEnd,
      reason: isWorkFromHomeLeave(leaveType) ? "" : reason.trim(),
      isHalfDay: isHalfDay && allowsHalfDayLeave(leaveType),
      status,
      reviewNote: reviewNote.trim() || undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Manual Leave Entry</DialogTitle>
          <DialogDescription>
            Record leave for an employee as approved or rejected.
            {days > 0
              ? ` · ${leaveTypeLabel(leaveType, { isHalfDay, days })} · ${formatLeaveDays(days)}`
              : ""}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-1">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-500">Employee</label>
            <UserSearchSelect
              mode="single"
              users={employees.map((emp) => ({
                id: emp.id,
                name: emp.name || emp.email || `User #${emp.id}`,
                avatar: emp.avatar,
              }))}
              value={userId === "" ? null : userId}
              onValueChange={(id) => {
                setUserId(id ?? "");
                setStartDate("");
                setEndDate("");
              }}
              placeholder="Select employee…"
              searchPlaceholder="Search employees…"
            />
            {selectedEmployee ? (
              <div className="flex items-center gap-3 pt-2 pb-1 border-b border-gray-100">
                <UserAvatar
                  name={selectedEmployee.name}
                  avatar={selectedEmployee.avatar}
                  size={40}
                />
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-[#1F2937]">
                    {selectedEmployee.name || selectedEmployee.email || `User #${selectedEmployee.id}`}
                  </div>
                  {selectedEmployee.department ? (
                    <div className="text-xs text-gray-400">{selectedEmployee.department}</div>
                  ) : null}
                  {selectedEmployee.email ? (
                    <div className="text-xs text-gray-500">{selectedEmployee.email}</div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-500">Leave type</label>
            <div className="flex flex-wrap gap-2">
              {LEAVE_TYPE_OPTIONS.map((opt) => {
                const wfhLocked =
                  isWorkFromHomeLeave(opt.value) && Boolean(wfhBlockedReason);
                return (
                <button
                  key={opt.value}
                  type="button"
                  disabled={wfhLocked}
                  onClick={() => {
                    if (wfhLocked) return;
                    setLeaveType(opt.value);
                    if (isWorkFromHomeLeave(opt.value)) setDuration("full");
                  }}
                  className={cn(
                    "h-9 px-3 rounded-full border text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                    leaveType === opt.value
                      ? "bg-[#2563EB] border-[#2563EB] text-white"
                      : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50",
                  )}
                >
                  {opt.label}
                </button>
                );
              })}
            </div>
            {wfhBlockedReason ? (
              <p className="text-xs text-amber-700">{wfhBlockedReason}.</p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-500">Duration</label>
            <div className="flex flex-wrap gap-2">
              {LEAVE_DURATION_OPTIONS.map((opt) => {
                const disabled =
                  opt.value === "half" && !allowsHalfDayLeave(leaveType);
                return (
                  <button
                    key={opt.value}
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      if (disabled) return;
                      setDuration(opt.value);
                      if (opt.value === "half" && startDate) setEndDate(startDate);
                    }}
                    className={cn(
                      "h-9 px-3 rounded-full border text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                      duration === opt.value
                        ? "bg-[#2563EB] border-[#2563EB] text-white"
                        : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50",
                    )}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-gray-400">{durationHint(leaveType, duration)}</p>
          </div>

          <div className={cn("grid gap-3", isHalfDay ? "grid-cols-1" : "grid-cols-2")}>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-500">
                {isHalfDay ? "Date of leave" : "From"}
              </label>
              <LeaveDatePickerField
                value={startDate}
                onChange={(next) => {
                  setStartDate(next);
                  if (isHalfDay) setEndDate(next);
                }}
                blockedDates={blockedDates}
                disabled={userId === ""}
                placeholder={userId === "" ? "Select employee first" : "Select date"}
              />
            </div>
            {!isHalfDay ? (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-500">
                  To <span className="font-normal text-gray-400">(optional)</span>
                </label>
                <LeaveDatePickerField
                  value={endDate}
                  onChange={setEndDate}
                  blockedDates={blockedDates}
                  minDate={startDate || undefined}
                  disabled={userId === ""}
                  placeholder={userId === "" ? "Select employee first" : "Select date"}
                />
              </div>
            ) : null}
          </div>

          {days > 0 ? (
            <div className="flex items-center justify-between gap-3 border-b border-gray-100 pb-3">
              <span className="text-xs text-gray-400">Duration</span>
              <span className="text-sm font-medium text-[#1F2937]">{formatLeaveDays(days)}</span>
            </div>
          ) : null}

          {!isWorkFromHomeLeave(leaveType) ? (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-500">Leave reason</label>
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Reason for leave…" className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]"/>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-500">Status</label>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  { value: "approved" as const, label: "Approved" },
                  { value: "rejected" as const, label: "Rejected" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setStatus(opt.value)}
                  className={cn(
                    "h-9 px-3 rounded-full border text-xs font-semibold transition-colors",
                    status === opt.value
                      ? opt.value === "approved"
                        ? "bg-emerald-600 border-emerald-600 text-white"
                        : "bg-red-600 border-red-600 text-white"
                      : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50",
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-500">
              Review note <span className="font-normal text-gray-400">(optional)</span>
            </label>
            <textarea value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} rows={2} placeholder="Optional note for the employee…" className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]"/>
          </div>

          {error ? (
            <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
              {error}
            </p>
          ) : null}

          <DialogFooter className="gap-2 sm:gap-2">
            <button type="button" onClick={() => onOpenChange(false)} disabled={submitting} className="h-10 px-4 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50">
              Cancel
            </button>
            <button type="submit" disabled={submitting || (isWorkFromHomeLeave(leaveType) && Boolean(wfhBlockedReason))} className="h-10 px-4 rounded-lg bg-[#2563EB] text-white text-sm font-semibold inline-flex items-center justify-center gap-1.5 hover:bg-[#1D4ED8] disabled:opacity-60">
              {submitting ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
              Save leave entry
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ManualWfhEntryDialog({
  open,
  onOpenChange,
  employees,
  existingLeaves,
  submitting,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employees: ManualEntryEmployee[];
  existingLeaves: Array<{
    userId: number;
    status: string;
    startDate: string;
    endDate: string;
  }>;
  submitting: boolean;
  onSubmit: (payload: {
    userId: number;
    leaveType: "wfh";
    startDate: string;
    endDate: string;
    reason: string;
    isHalfDay: boolean;
    status: "approved" | "rejected";
    reviewNote?: string;
  }) => void;
}) {
  const [userId, setUserId] = useState<number | "">("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [status, setStatus] = useState<"approved" | "rejected">("approved");
  const [reviewNote, setReviewNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const effectiveEnd = endDate || startDate;
  const days =
    startDate && effectiveEnd ? leaveDayUnits("wfh", startDate, effectiveEnd, false) : 0;

  const selectedEmployee =
    userId === "" ? null : employees.find((e) => e.id === userId) ?? null;
  const wfhBlockedReason = employeeWfhBlockedReason(selectedEmployee);

  const blockedDates = useMemo(
    () => approvedLeaveDateKeysForUser(existingLeaves, userId),
    [existingLeaves, userId],
  );

  useEffect(() => {
    if (!open) return;
    setUserId("");
    setStartDate("");
    setEndDate("");
    setStatus("approved");
    setReviewNote("");
    setError(null);
  }, [open]);

  useEffect(() => {
    if (startDate && blockedDates.has(startDate)) {
      setStartDate("");
      setEndDate("");
      return;
    }
    if (endDate && blockedDates.has(endDate)) setEndDate("");
  }, [blockedDates, startDate, endDate]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setError(null);

    if (userId === "") {
      setError("Please select an employee.");
      return;
    }
    if (!startDate) {
      setError("Please select the WFH date.");
      return;
    }
    if (days <= 0) {
      setError("End date must be on or after the start date.");
      return;
    }

    const submitEnd = endDate || startDate;
    if (employeeHasLeaveOnRange(existingLeaves, userId, startDate, submitEnd)) {
      const message = leaveAlreadyExistsForEmployeeMessage(startDate);
      setError(message);
      toast.error(message);
      return;
    }

    if (wfhBlockedReason) {
      setError(wfhBlockedReason);
      toast.error(wfhBlockedReason);
      return;
    }

    onSubmit({
      userId,
      leaveType: "wfh",
      startDate,
      endDate: submitEnd,
      reason: "",
      isHalfDay: false,
      status,
      reviewNote: reviewNote.trim() || undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Manual WFH Entry</DialogTitle>
          <DialogDescription>
            Record work from home for an employee as approved or rejected.
            {days > 0 ? ` · ${formatLeaveDays(days)}` : ""}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-1">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-500">Employee</label>
            <UserSearchSelect
              mode="single"
              users={employees.map((emp) => ({
                id: emp.id,
                name: emp.name || emp.email || `User #${emp.id}`,
                avatar: emp.avatar,
              }))}
              value={userId === "" ? null : userId}
              onValueChange={(id) => {
                setUserId(id ?? "");
                setStartDate("");
                setEndDate("");
              }}
              placeholder="Select employee…"
              searchPlaceholder="Search employees…"
              triggerClassName="focus:ring-teal-500/20 focus:border-teal-600"
            />
            {selectedEmployee ? (
              <div className="flex items-center gap-3 pt-2 pb-1 border-b border-gray-100">
                <UserAvatar
                  name={selectedEmployee.name}
                  avatar={selectedEmployee.avatar}
                  size={40}
                />
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-[#1F2937]">
                    {selectedEmployee.name ||
                      selectedEmployee.email ||
                      `User #${selectedEmployee.id}`}
                  </div>
                  {selectedEmployee.department ? (
                    <div className="text-xs text-gray-400">{selectedEmployee.department}</div>
                  ) : null}
                  {selectedEmployee.email ? (
                    <div className="text-xs text-gray-500">{selectedEmployee.email}</div>
                  ) : null}
                </div>
              </div>
            ) : null}
            {wfhBlockedReason ? (
              <p className="text-xs text-amber-700 pt-1">{wfhBlockedReason}.</p>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-500">From</label>
              <LeaveDatePickerField
                value={startDate}
                onChange={setStartDate}
                blockedDates={blockedDates}
                disabled={userId === ""}
                placeholder={userId === "" ? "Select employee first" : "Select date"}
                focusRingClassName="focus:ring-teal-500/20 focus:border-teal-600"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-500">
                To <span className="font-normal text-gray-400">(optional)</span>
              </label>
              <LeaveDatePickerField
                value={endDate}
                onChange={setEndDate}
                blockedDates={blockedDates}
                minDate={startDate || undefined}
                disabled={userId === ""}
                placeholder={userId === "" ? "Select employee first" : "Select date"}
                focusRingClassName="focus:ring-teal-500/20 focus:border-teal-600"
              />
            </div>
          </div>

          {days > 0 ? (
            <div className="flex items-center justify-between gap-3 border-b border-gray-100 pb-3">
              <span className="text-xs text-gray-400">Duration</span>
              <span className="text-sm font-medium text-[#1F2937]">{formatLeaveDays(days)}</span>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-500">Status</label>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  { value: "approved" as const, label: "Approved" },
                  { value: "rejected" as const, label: "Rejected" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setStatus(opt.value)}
                  className={cn(
                    "h-9 px-3 rounded-full border text-xs font-semibold transition-colors",
                    status === opt.value
                      ? opt.value === "approved"
                        ? "bg-emerald-600 border-emerald-600 text-white"
                        : "bg-red-600 border-red-600 text-white"
                      : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50",
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-500">
              Review note <span className="font-normal text-gray-400">(optional)</span>
            </label>
            <textarea
              value={reviewNote}
              onChange={(e) => setReviewNote(e.target.value)}
              rows={2}
              placeholder="Optional note for the employee…"
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-600"
            />
          </div>

          {error ? (
            <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
              {error}
            </p>
          ) : null}

          <DialogFooter className="gap-2 sm:gap-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
              className="h-10 px-4 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || Boolean(wfhBlockedReason)}
              className="h-10 px-4 rounded-lg bg-teal-600 text-white text-sm font-semibold inline-flex items-center justify-center gap-1.5 hover:bg-teal-700 disabled:opacity-60"
            >
              {submitting ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
              Save WFH entry
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function LeaveRequestDetailDialog({
  request,
  open,
  reviewing,
  savingDetails,
  reviewStatus,
  onOpenChange,
  onSetStatus,
  onSaveDetails,
}: {
  request: LeaveRequestRow | null;
  open: boolean;
  reviewing: boolean;
  savingDetails: boolean;
  reviewStatus?: "approved" | "rejected" | "cancelled" | "pending";
  onOpenChange: (open: boolean) => void;
  onSetStatus: (
    status: "approved" | "rejected" | "cancelled" | "pending",
    note?: string,
  ) => void;
  onSaveDetails: (payload: { reason: string; reviewNote: string }) => void;
}) {
  const [reason, setReason] = useState("");
  const [reviewNote, setReviewNote] = useState("");

  useEffect(() => {
    if (!open || !request) return;
    setReason(request.reason ?? "");
    setReviewNote(request.reviewNote ?? "");
  }, [open, request?.id, request?.reason, request?.reviewNote]);

  if (!request) return null;

  const isWfh = isWorkFromHomeLeave(request.leaveType);
  const originalReason = request.reason ?? "";
  const originalNote = request.reviewNote ?? "";
  const reasonChanged = reason.trim() !== originalReason.trim();
  const noteChanged = reviewNote.trim() !== originalNote.trim();
  const hasChanges = reasonChanged || noteChanged;
  const reasonValid = isWfh || reason.trim().length >= 3;
  const canSave = hasChanges && reasonValid && !reviewing && !savingDetails;

  const dateLabel =
    request.startDate === request.endDate
      ? formatWorkZoneDateKey(request.startDate, {
          weekday: "long",
          month: "long",
          day: "numeric",
          year: "numeric",
        })
      : `${formatWorkZoneDateKey(request.startDate, {
          month: "short",
          day: "numeric",
          year: "numeric",
        })} → ${formatWorkZoneDateKey(request.endDate, {
          month: "short",
          day: "numeric",
          year: "numeric",
        })}`;

  const statusActions: Array<{
    status: "approved" | "rejected" | "cancelled" | "pending";
    label: string;
    className: string;
  }> = [
    {
      status: "approved",
      label: "Approve",
      className:
        "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100",
    },
    {
      status: "rejected",
      label: "Reject",
      className: "bg-red-50 text-red-600 border-red-200 hover:bg-red-100",
    },
    {
      status: "cancelled",
      label: "Cancel",
      className: "bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100",
    },
    {
      status: "pending",
      label: "Pending",
      className: "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100",
    },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl lg:max-h-[calc(100vh-2rem)]">
        <DialogHeader>
          <DialogTitle>Leave request details</DialogTitle>
          <DialogDescription>
            {leaveTypeLabel(request.leaveType as LeaveType, {
              isHalfDay: request.isHalfDay,
              days: request.days,
            })}{" "}
            · {formatLeaveDays(request.days)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          <div className="flex items-center gap-3 pb-3 border-b border-gray-100">
            <UserAvatar
              name={request.employee?.name}
              avatar={request.employee?.avatar}
              size={44}
            />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-[#1F2937]">
                {request.employee?.name ?? request.employee?.email ?? `User #${request.userId}`}
              </div>
              {request.employee?.department ? (
                <div className="text-xs text-gray-400">{request.employee.department}</div>
              ) : null}
              {request.employee?.email ? (
                <div className="text-xs text-gray-500">{request.employee.email}</div>
              ) : null}
            </div>
          </div>

          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-gray-400">Status</span>
            <StatusBadge status={request.status} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8">
            <DetailRow
              label="Leave type"
              value={leaveTypeLabel(request.leaveType as LeaveType, {
                isHalfDay: request.isHalfDay,
                days: request.days,
              })}
            />
            <DetailRow label="Dates" value={dateLabel} />
            <DetailRow
              label="Duration"
              value={formatLeaveDays(request.days)}
            />
            <DetailRow label="Applied on" value={formatWorkZoneDateTime(request.createdAt)} />

            {request.status !== "pending" && request.reviewedAt ? (
              <DetailRow
                label={
                  request.status === "approved"
                    ? "Approved on"
                    : request.status === "rejected"
                      ? "Rejected on"
                      : request.status === "cancelled"
                        ? "Cancelled on"
                        : "Reviewed on"
                }
                value={formatWorkZoneDateTime(request.reviewedAt)}
              />
            ) : null}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {!isWfh ? (
              <div>
                <label className="block text-xs text-gray-400 mb-1">Reason</label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  disabled={reviewing || savingDetails}
                  placeholder="Reason for leave…"
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB] disabled:opacity-60"
                />
                {!reasonValid ? (
                  <p className="text-[11px] text-red-500 mt-1">
                    Reason must be at least 3 characters.
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className={isWfh ? "sm:col-span-2" : undefined}>
              <label className="block text-xs text-gray-400 mb-1">
                Note (optional)
              </label>
              <textarea
                value={reviewNote}
                onChange={(e) => setReviewNote(e.target.value)}
                rows={3}
                disabled={reviewing || savingDetails}
                placeholder="Add or update a note for the employee…"
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB] disabled:opacity-60"
              />
            </div>
          </div>

          <div className="pt-2 border-t border-gray-100 space-y-3">

            <button
              type="button"
              disabled={!canSave}
              onClick={() =>
                onSaveDetails({
                  reason: reason.trim(),
                  reviewNote: reviewNote.trim(),
                })
              }
              className="w-full h-10 rounded-lg bg-[#2563EB] text-white text-sm font-semibold inline-flex items-center justify-center gap-1.5 hover:bg-[#1D4ED8] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {savingDetails ? <Loader2 size={16} className="animate-spin" /> : null}
              Save
            </button>

            <p className="text-xs text-gray-500">Update leave status</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {statusActions.map((action) => {
                const isCurrent = request.status === action.status;
                const isThisPending =
                  reviewing && reviewStatus === action.status;
                return (
                  <button
                    key={action.status}
                    type="button"
                    disabled={reviewing || savingDetails || isCurrent}
                    onClick={() =>
                      onSetStatus(action.status, reviewNote.trim() || undefined)
                    }
                    title={isCurrent ? `Already ${action.status}` : undefined}
                    className={cn(
                      "h-10 rounded-lg text-sm font-medium border inline-flex items-center justify-center gap-1.5 disabled:opacity-50",
                      action.className,
                      isCurrent && "ring-2 ring-offset-1 ring-gray-300",
                    )}
                  >
                    {isThisPending ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : action.status === "approved" ? (
                      <Check size={14} />
                    ) : action.status === "rejected" ? (
                      <X size={14} />
                    ) : null}
                    {action.label}
                    {isCurrent ? " ✓" : ""}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-gray-100 pb-3 last:border-b-0 last:pb-0">
      <div className="text-xs text-gray-400 mb-1">{label}</div>
      <div className="text-sm text-[#1F2937] whitespace-pre-wrap">{value || "—"}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles =
    status === "approved"
      ? "bg-emerald-50 text-emerald-700"
      : status === "rejected"
        ? "bg-red-50 text-red-600"
        : status === "cancelled"
          ? "bg-gray-100 text-gray-600"
          : "bg-amber-50 text-amber-700";
  return (
    <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full capitalize ${styles}`}>
      {status}
    </span>
  );
}
