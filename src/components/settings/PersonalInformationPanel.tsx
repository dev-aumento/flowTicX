import { useEffect, useState, type ReactNode } from "react";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { hasPermission } from "@/lib/permissions";
import { isClientPortalUser } from "@/lib/client-portal";
import { canManageNoticePeriod } from "@/lib/leave-policy";
import { departmentSelectOptions, departmentSelectScopeForRole } from "@/lib/department-options";
import { Loader2, Pencil, Phone, FileUp, Download, Trash2, Paperclip } from "lucide-react";
import { motion } from "framer-motion";
import {
  formatCalendarYmd,
  calendarYmdFromUnknown,
  calendarYmdKey,
  formatWorkZoneDateTime,
} from "@/lib/timezone";
import { CalendarDateSelect } from "@/components/shared/CalendarDateSelect";
import { refreshDashboardPage } from "@/lib/dashboard-refresh";
import { downloadFileFromBase64, readFileAsBase64 } from "@/lib/task-files";
import { Checkbox } from "@/components/ui/checkbox";

export const SEX_OPTIONS = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "other", label: "Other" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
] as const;

export const BLOOD_GROUP_OPTIONS = [
  "A+",
  "A-",
  "B+",
  "B-",
  "AB+",
  "AB-",
  "O+",
  "O-",
] as const;

type PersonalForm = {
  firstName: string;
  lastName: string;
  secondName: string;
  email: string;
  position: string;
  department: string;
  phone: string;
  city: string;
  address: string;
  familyContactNumber: string;
  personalEmail: string;
  bloodGroup: string;
  aadhaarCard: string;
  panCard: string;
  dateOfBirth: string;
  dateOfJoining: string;
  sex: string;
  headOfDepartmentUserIds: number[];
  privateNotes: string;
  employmentType: "full_time" | "intern";
  onNoticePeriod: boolean;
};

const EMPTY_FORM: PersonalForm = {
  firstName: "",
  lastName: "",
  secondName: "",
  email: "",
  position: "",
  department: "",
  phone: "",
  city: "",
  address: "",
  familyContactNumber: "",
  personalEmail: "",
  bloodGroup: "",
  aadhaarCard: "",
  panCard: "",
  dateOfBirth: "",
  dateOfJoining: "",
  sex: "",
  headOfDepartmentUserIds: [],
  privateNotes: "",
  employmentType: "full_time",
  onNoticePeriod: false,
};

function toDateInputValue(value: Date | string | null | undefined) {
  const parts = calendarYmdFromUnknown(value);
  return parts ? calendarYmdKey(parts) : "";
}

function formatDisplayDate(value: Date | string | null | undefined) {
  return formatCalendarYmd(calendarYmdFromUnknown(value));
}

function isImplausibleBirthYear(value: Date | string | null | undefined) {
  const parts = calendarYmdFromUnknown(value);
  return Boolean(parts && parts.year < 1920);
}

function sexLabel(value: string | null | undefined) {
  return SEX_OPTIONS.find((o) => o.value === value)?.label ?? "—";
}

function formFromPersonalData(data: {
  firstName?: string | null;
  lastName?: string | null;
  secondName?: string | null;
  email?: string | null;
  position?: string | null;
  department?: string | null;
  phone?: string | null;
  city?: string | null;
  address?: string | null;
  familyContactNumber?: string | null;
  personalEmail?: string | null;
  bloodGroup?: string | null;
  aadhaarCard?: string | null;
  panCard?: string | null;
  dateOfBirth?: Date | string | null;
  dateOfJoining?: Date | string | null;
  sex?: string | null;
  headOfDepartmentUserIds?: number[];
  privateNotes?: string | null;
  employmentType?: "full_time" | "intern" | string | null;
  onNoticePeriod?: boolean | null;
}): PersonalForm {
  return {
    firstName: data.firstName ?? "",
    lastName: data.lastName ?? "",
    secondName: data.secondName ?? "",
    email: data.email ?? "",
    position: data.position ?? "",
    department: data.department ?? "",
    phone: data.phone ?? "",
    city: data.city ?? "",
    address: data.address ?? "",
    familyContactNumber: data.familyContactNumber ?? "",
    personalEmail: data.personalEmail ?? "",
    bloodGroup: data.bloodGroup ?? "",
    aadhaarCard: data.aadhaarCard ?? "",
    panCard: data.panCard ?? "",
    dateOfBirth: toDateInputValue(data.dateOfBirth),
    dateOfJoining: toDateInputValue(data.dateOfJoining),
    sex: data.sex ?? "",
    headOfDepartmentUserIds: data.headOfDepartmentUserIds ?? [],
    privateNotes: data.privateNotes ?? "",
    employmentType: data.employmentType === "intern" ? "intern" : "full_time",
    onNoticePeriod: Boolean(data.onNoticePeriod),
  };
}

function FieldRow({
  label,
  value,
  href,
  trailing,
  className,
}: {
  label: string;
  value: ReactNode;
  href?: string;
  trailing?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`py-3 min-w-0 ${className ?? ""}`}>
      <div className="text-xs text-gray-400 mb-1">{label}</div>
      <div className="flex items-center gap-2 text-sm text-[#1F2937]">
        {href ? (
          <a href={href} className="text-[#2563EB] hover:underline break-all">
            {value}
          </a>
        ) : (
          <span className="break-words">{value || "—"}</span>
        )}
        {trailing}
      </div>
    </div>
  );
}

function FormField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <label className="block text-xs text-gray-500 mb-1.5">{label}</label>
      {children}
    </div>
  );
}

const inputClass =
  "w-full h-10 px-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]";

type PersonalInformationPanelProps = {
  /** When set, loads and saves personal info for another user (admin/HR). */
  userId?: number;
  onSaved?: () => void;
  onError?: (message: string) => void;
  /** Employee details dialog: three columns on desktop. */
  wide?: boolean;
};

export function PersonalInformationPanel({
  userId,
  onSaved,
  onError,
  wide = false,
}: PersonalInformationPanelProps) {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState<PersonalForm>(EMPTY_FORM);

  const isSelf = userId == null || userId === user?.id;
  const fieldGrid = wide
    ? "rounded-xl border border-gray-200 bg-white px-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8"
    : "rounded-xl border border-gray-200 bg-white px-4 grid grid-cols-1 md:grid-cols-2 gap-x-4";
  const formGrid = wide
    ? "rounded-xl border border-gray-200 bg-white p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-5"
    : "rounded-xl border border-gray-200 bg-white p-4 grid grid-cols-1 md:grid-cols-2 gap-4";
  const spanAll = wide ? "sm:col-span-2 lg:col-span-3" : "md:col-span-2";
  const compact = isClientPortalUser(user);
  const canManageHeadOfDepartment = hasPermission(user, "profile.head_of_department");
  const canEditEmploymentType = hasPermission(user, "employees.manage");
  const canEditNoticePeriod = canManageNoticePeriod(user);
  /** Project managers without employees.manage may only change the notice-period flag. */
  const noticeOnlyEditor = Boolean(
    !isSelf && canEditNoticePeriod && !hasPermission(user, "employees.manage"),
  );
  const canChangeWorkEmail = wide && !noticeOnlyEditor;

  const selfQuery = trpc.auth.getPersonalInfo.useQuery(undefined, { enabled: isSelf });
  const adminQuery = trpc.user.getPersonalInfo.useQuery(
    { id: userId! },
    { enabled: !isSelf && userId != null },
  );
  const data = isSelf ? selfQuery.data : adminQuery.data;
  const isLoading = isSelf ? selfQuery.isLoading : adminQuery.isLoading;

  const { data: usersData } = trpc.user.listForPicker.useQuery(
    { limit: 500 },
    { enabled: canManageHeadOfDepartment },
  );

  const selfUpdateMutation = trpc.auth.updatePersonalInfo.useMutation({
    onSuccess: async (updated) => {
      utils.auth.getPersonalInfo.setData(undefined, updated);
      utils.auth.me.invalidate();
      await Promise.all([
        utils.user.listForPicker.invalidate(),
        refreshDashboardPage(utils),
      ]);
      setEditing(false);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
      onSaved?.();
    },
    onError: (error) => {
      onError?.(error.message || "Could not save personal information.");
    },
  });

  const adminUpdateMutation = trpc.user.updatePersonalInfo.useMutation({
    onSuccess: async (updated) => {
      if (userId != null) {
        utils.user.getPersonalInfo.setData({ id: userId }, updated);
        await Promise.all([
          utils.user.getById.invalidate({ id: userId }),
          utils.user.list.invalidate(),
          utils.user.listForPicker.invalidate(),
          refreshDashboardPage(utils),
        ]);
      }
      setEditing(false);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
      onSaved?.();
    },
    onError: (error) => {
      onError?.(error.message || "Could not save personal information.");
    },
  });

  const updateMutation = isSelf ? selfUpdateMutation : adminUpdateMutation;

  useEffect(() => {
    if (!data) return;
    setForm(formFromPersonalData(data));
  }, [data]);

  const headNames =
    data?.headsOfDepartment?.map((h) => h.name).filter(Boolean).join(", ") || "—";

  const employeeOptions = (usersData?.users ?? []).filter((u) => u.id > 0);

  const selectedHeads = form.headOfDepartmentUserIds
    .map((id) => {
      const fromPicker = employeeOptions.find((u) => u.id === id);
      if (fromPicker) return fromPicker;
      const fromSaved = data?.headsOfDepartment?.find((h) => h.id === id);
      if (fromSaved) {
        return { id: fromSaved.id, name: fromSaved.name, email: null, avatar: null };
      }
      return null;
    })
    .filter((u): u is NonNullable<typeof u> => Boolean(u));

  const addHeadOfDepartment = (userId: number) => {
    if (!userId) return;
    setForm((prev) => ({
      ...prev,
      headOfDepartmentUserIds: prev.headOfDepartmentUserIds.includes(userId)
        ? prev.headOfDepartmentUserIds
        : [...prev.headOfDepartmentUserIds, userId],
    }));
  };

  const removeHeadOfDepartment = (userId: number) => {
    setForm((prev) => ({
      ...prev,
      headOfDepartmentUserIds: prev.headOfDepartmentUserIds.filter((id) => id !== userId),
    }));
  };

  const handleSave = () => {
    if (!data) {
      onError?.("Personal information is still loading.");
      return;
    }
    if (!form.firstName.trim()) {
      onError?.("First name is required.");
      return;
    }
    const workEmail = form.email.trim().toLowerCase();
    if (canChangeWorkEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(workEmail)) {
      onError?.("Enter a valid work email.");
      return;
    }

    const payload = compact
      ? {
          firstName: form.firstName.trim() || null,
          lastName: form.lastName.trim() || null,
          email: data.email?.trim() ? undefined : form.email.trim() || undefined,
          phone: form.phone.trim() || null,
        }
      : {
          firstName: form.firstName.trim() || null,
          lastName: form.lastName.trim() || null,
          secondName: form.secondName.trim() || null,
          email: canChangeWorkEmail
            ? workEmail
            : data.email?.trim()
              ? undefined
              : form.email.trim() || undefined,
          position: form.position.trim() || null,
          department: form.department.trim() || null,
          phone: form.phone.trim() || null,
          city: form.city.trim() || null,
          address: form.address.trim() || null,
          familyContactNumber: form.familyContactNumber.trim() || null,
          personalEmail: form.personalEmail.trim() || null,
          bloodGroup: form.bloodGroup.trim() || null,
          aadhaarCard: form.aadhaarCard.trim() || null,
          panCard: form.panCard.trim() || null,
          dateOfBirth: form.dateOfBirth || null,
          dateOfJoining: form.dateOfJoining || null,
          sex: form.sex
            ? (form.sex as "male" | "female" | "other" | "prefer_not_to_say")
            : null,
          ...(canManageHeadOfDepartment
            ? { headOfDepartmentUserIds: form.headOfDepartmentUserIds }
            : {}),
          ...(canEditEmploymentType ? { employmentType: form.employmentType } : {}),
          ...(canEditNoticePeriod ? { onNoticePeriod: form.onNoticePeriod } : {}),
          ...(isSelf ? { privateNotes: form.privateNotes.trim() || null } : {}),
        };

    if (isSelf) {
      selfUpdateMutation.mutate(payload);
      return;
    }

    if (userId != null) {
      if (noticeOnlyEditor) {
        adminUpdateMutation.mutate({ id: userId, onNoticePeriod: form.onNoticePeriod });
        return;
      }
      adminUpdateMutation.mutate({ id: userId, ...payload });
    }
  };

  if (isLoading || !data) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 size={28} className="animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} className="space-y-4">
      <div className="flex justify-between gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <h2 className="text-lg font-semibold text-[#1F2937]">Personal Information</h2>
          {saved && <span className="text-sm text-emerald-600 font-medium">Saved</span>}
        </div>
        {!editing ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-sm text-gray-500 hover:text-[#2563EB] transition-colors"
          >
            edit
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                if (data) setForm(formFromPersonalData(data));
              }}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={updateMutation.isPending}
              className="h-9 px-4 bg-[#2563EB] text-white rounded-lg text-sm font-medium hover:bg-[#1D4ED8] disabled:opacity-50 inline-flex items-center gap-2"
            >
              {updateMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Pencil size={14} />}
              Save
            </button>
          </div>
        )}
      </div>

      <div className={wide && !compact ? "space-y-4" : undefined}>
      {compact ? (
        !editing ? (
          <div className="rounded-xl border border-gray-200 bg-white px-4 grid grid-cols-1 md:grid-cols-2 gap-x-4">
            <FieldRow label="First name" value={data.firstName} className="border-b border-gray-100" />
            <FieldRow label="Last name" value={data.lastName} className="border-b border-gray-100" />
            <FieldRow
              label="Email"
              value={data.email}
              href={data.email ? `mailto:${data.email}` : undefined}
              className="border-b border-gray-100"
            />
            <FieldRow
              label="Mobile number"
              value={data.phone}
              href={data.phone ? `tel:${data.phone}` : undefined}
              trailing={data.phone ? <Phone size={14} className="text-gray-400" /> : null}
            />
          </div>
        ) : (
          <div className="rounded-xl border border-gray-200 bg-white p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField label="First name">
              <input
                type="text"
                value={form.firstName}
                onChange={(e) => setForm((prev) => ({ ...prev, firstName: e.target.value }))}
                className={inputClass}
              />
            </FormField>
            <FormField label="Last name">
              <input
                type="text"
                value={form.lastName}
                onChange={(e) => setForm((prev) => ({ ...prev, lastName: e.target.value }))}
                className={inputClass}
              />
            </FormField>
            <FormField label="Email">
              <input
                type="email"
                value={form.email}
                disabled={Boolean(data.email?.trim())}
                readOnly={Boolean(data.email?.trim())}
                onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
                className={
                  data.email?.trim()
                    ? `${inputClass} bg-gray-50 text-gray-600 cursor-not-allowed`
                    : inputClass
                }
              />
              {data.email?.trim() ? (
                <p className="text-xs leading-relaxed break-words text-gray-400 mt-1">Email cannot be changed after it is set.</p>
              ) : null}
            </FormField>
            <FormField label="Mobile number">
              <input
                type="tel"
                value={form.phone}
                onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))}
                className={inputClass}
              />
            </FormField>
          </div>
        )
      ) : !editing ? (
        <div className={fieldGrid}>
          <FieldRow label="First name" value={data.firstName} className="border-b border-gray-100" />
          <FieldRow label="Last name" value={data.lastName} className="border-b border-gray-100" />
          <FieldRow
            label="Email"
            value={data.email}
            href={data.email ? `mailto:${data.email}` : undefined}
            className="border-b border-gray-100"
          />
          <FieldRow label="Position" value={data.position} className="border-b border-gray-100" />
          <FieldRow label="Department" value={data.department} className="border-b border-gray-100" />
          <FieldRow
            label="Date of birth"
            value={
              <>
                {formatDisplayDate(data.dateOfBirth)}
                {isImplausibleBirthYear(data.dateOfBirth) ? (
                  <span className="block text-xs text-amber-600 mt-1">
                    This date looks incomplete (year {calendarYmdFromUnknown(data.dateOfBirth)?.year}).
                    Edit and choose day, month, then a real birth year.
                  </span>
                ) : null}
              </>
            }
            className="border-b border-gray-100"
          />
          <FieldRow
            label="Date of joining"
            value={formatDisplayDate(data.dateOfJoining)}
            className="border-b border-gray-100"
          />
          <FieldRow
            label="Employment type"
            value={data.employmentType === "intern" ? "Intern" : "Full-time"}
            className="border-b border-gray-100"
          />
          {canEditNoticePeriod ? (
            <FieldRow
              label="Notice period"
              value={data.onNoticePeriod ? "On notice period" : "Not on notice"}
              className="border-b border-gray-100"
            />
          ) : null}
          <FieldRow label="Sex" value={sexLabel(data.sex)} className="border-b border-gray-100" />
          <FieldRow
            label="Mobile phone"
            value={data.phone}
            href={data.phone ? `tel:${data.phone}` : undefined}
            trailing={data.phone ? <Phone size={14} className="text-gray-400" /> : null}
            className="border-b border-gray-100"
          />
          <FieldRow label="City" value={data.city} className="border-b border-gray-100" />
          <FieldRow label="Address" value={data.address} className="border-b border-gray-100" />
          <FieldRow
            label="Family contact number"
            value={data.familyContactNumber}
            href={data.familyContactNumber ? `tel:${data.familyContactNumber}` : undefined}
            trailing={
              data.familyContactNumber ? <Phone size={14} className="text-gray-400" /> : null
            }
            className="border-b border-gray-100"
          />
          <FieldRow
            label="Personal email"
            value={data.personalEmail}
            href={data.personalEmail ? `mailto:${data.personalEmail}` : undefined}
            className="border-b border-gray-100"
          />
          <FieldRow
            label="Blood group"
            value={data.bloodGroup}
            className="border-b border-gray-100"
          />
          <FieldRow
            label="Aadhaar card"
            value={data.aadhaarCard}
            className="border-b border-gray-100"
          />
          <FieldRow
            label="PAN card"
            value={data.panCard}
            className={
              canManageHeadOfDepartment || isSelf ? "border-b border-gray-100" : undefined
            }
          />
          {canManageHeadOfDepartment ? (
            <FieldRow
              label="Head of department"
              value={headNames}
              className={`${spanAll}${isSelf ? " border-b border-gray-100" : ""}`}
            />
          ) : null}
          {isSelf ? (
            <FieldRow
              label="Notes"
              value={
                data.privateNotes ? (
                  <span className="whitespace-pre-wrap break-words">{data.privateNotes}</span>
                ) : (
                  "—"
                )
              }
              className={spanAll}
            />
          ) : null}
        </div>
      ) : (
        <div className={formGrid}>
          <FormField label="First name">
            <input
              type="text"
              value={form.firstName}
              onChange={(e) => setForm((prev) => ({ ...prev, firstName: e.target.value }))}
              className={inputClass}
            />
          </FormField>
          <FormField label="Last name">
            <input
              type="text"
              value={form.lastName}
              onChange={(e) => setForm((prev) => ({ ...prev, lastName: e.target.value }))}
              className={inputClass}
            />
          </FormField>
          <FormField label="Email">
            <input
              type="email"
              value={form.email}
              disabled={!canChangeWorkEmail && Boolean(data.email?.trim())}
              readOnly={!canChangeWorkEmail && Boolean(data.email?.trim())}
              onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
              className={
                !canChangeWorkEmail && data.email?.trim()
                  ? `${inputClass} bg-gray-50 text-gray-600 cursor-not-allowed`
                  : inputClass
              }
              autoComplete="off"
            />
            {canChangeWorkEmail ? (
              <p className="text-xs leading-relaxed break-words text-gray-400 mt-1">
                Sign-in email for this employee.
              </p>
            ) : data.email?.trim() ? (
              <p className="text-xs leading-relaxed break-words text-gray-400 mt-1">Email cannot be changed after it is set.</p>
            ) : null}
          </FormField>
          <FormField label="Position">
            <input
              type="text"
              value={form.position}
              onChange={(e) => setForm((prev) => ({ ...prev, position: e.target.value }))}
              className={inputClass}
            />
          </FormField>
          <FormField label="Department">
            <select
              value={form.department}
              onChange={(e) => setForm((prev) => ({ ...prev, department: e.target.value }))}
              className={inputClass}
            >
              <option value="">Select department…</option>
              {departmentSelectOptions(
                form.department || data.department,
                departmentSelectScopeForRole(user?.role),
              ).map((department) => (
                <option key={department} value={department}>
                  {department}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Date of birth">
            <CalendarDateSelect
              value={form.dateOfBirth}
              onChange={(dateOfBirth) => setForm((prev) => ({ ...prev, dateOfBirth }))}
              minYear={1920}
            />
            <p className="text-xs leading-relaxed break-words text-gray-400 mt-1">
              Day, then month, then year — e.g. 10 September 1990.
            </p>
            {isImplausibleBirthYear(form.dateOfBirth) ? (
              <p className="text-xs text-amber-600 mt-1">
                Year {calendarYmdFromUnknown(form.dateOfBirth)?.year} is not a valid birth year.
                Set day, month, and a real year (1920 or later).
              </p>
            ) : null}
          </FormField>
          <FormField label="Date of joining">
            <CalendarDateSelect
              value={form.dateOfJoining}
              onChange={(dateOfJoining) => setForm((prev) => ({ ...prev, dateOfJoining }))}
              minYear={1980}
            />
          </FormField>
          <FormField label="Employment type">
            <select
              value={form.employmentType}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  employmentType: e.target.value === "intern" ? "intern" : "full_time",
                }))
              }
              className={inputClass}
              disabled={!canEditEmploymentType}
            >
              <option value="full_time">Full-time</option>
              <option value="intern">Intern</option>
            </select>
            {!canEditEmploymentType ? (
              <p className="text-xs leading-relaxed break-words text-gray-400 mt-1">
                Only admin/HR can change employment type (affects leave probation rules).
              </p>
            ) : (
              <p className="text-xs leading-relaxed break-words text-gray-400 mt-1">
                Interns have no paid leave for 6 months (3 internship + 3 probation). Joining on or
                after the 20th starts that window the next month.
              </p>
            )}
          </FormField>
          {canEditNoticePeriod ? (
            <div className={`${spanAll} rounded-lg border border-gray-200 bg-gray-50 px-3 py-3`}>
              <label className="flex items-start gap-3 cursor-pointer">
                <Checkbox
                  checked={form.onNoticePeriod}
                  onCheckedChange={(checked) =>
                    setForm((prev) => ({ ...prev, onNoticePeriod: checked === true }))
                  }
                  className="mt-0.5"
                />
                <span>
                  <span className="block text-sm font-medium text-[#1F2937]">
                    Employee is on notice period
                  </span>
                  <span className="block text-xs text-gray-500 mt-0.5">
                    While enabled, paid leave is not provided for the current month (and later months
                    until this is turned off). Visible to admin, HR, and project managers.
                  </span>
                </span>
              </label>
            </div>
          ) : null}
          <FormField label="Sex">
            <select
              value={form.sex}
              onChange={(e) => setForm((prev) => ({ ...prev, sex: e.target.value }))}
              className={inputClass}
            >
              <option value="">Select…</option>
              {SEX_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Mobile phone">
            <input
              type="tel"
              value={form.phone}
              onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))}
              className={inputClass}
            />
          </FormField>
          <FormField label="City">
            <input
              type="text"
              value={form.city}
              onChange={(e) => setForm((prev) => ({ ...prev, city: e.target.value }))}
              className={inputClass}
            />
          </FormField>
          <FormField label="Address">
            <input
              type="text"
              value={form.address}
              onChange={(e) => setForm((prev) => ({ ...prev, address: e.target.value }))}
              className={inputClass}
              placeholder="Street, area, city, PIN"
            />
          </FormField>
          <FormField label="Family contact number">
            <input
              type="tel"
              value={form.familyContactNumber}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, familyContactNumber: e.target.value }))
              }
              className={inputClass}
            />
          </FormField>
          <FormField label="Personal email">
            <input
              type="email"
              value={form.personalEmail}
              onChange={(e) => setForm((prev) => ({ ...prev, personalEmail: e.target.value }))}
              className={inputClass}
              placeholder="personal@example.com"
              autoComplete="email"
            />
            <p className="text-xs leading-relaxed break-words text-gray-400 mt-1">
              Used for emergency contact — separate from your work login email.
            </p>
          </FormField>
          <FormField label="Blood group">
            <select
              value={form.bloodGroup}
              onChange={(e) => setForm((prev) => ({ ...prev, bloodGroup: e.target.value }))}
              className={inputClass}
            >
              <option value="">Select…</option>
              {BLOOD_GROUP_OPTIONS.map((group) => (
                <option key={group} value={group}>
                  {group}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Aadhaar card">
            <input
              type="text"
              value={form.aadhaarCard}
              onChange={(e) => setForm((prev) => ({ ...prev, aadhaarCard: e.target.value }))}
              className={inputClass}
              placeholder="Enter Aadhaar number"
              maxLength={30}
              autoComplete="off"
            />
          </FormField>
          <FormField label="PAN card">
            <input
              type="text"
              value={form.panCard}
              onChange={(e) => setForm((prev) => ({ ...prev, panCard: e.target.value }))}
              className={inputClass}
              placeholder="Enter PAN number"
              maxLength={20}
              autoComplete="off"
            />
          </FormField>
          {canManageHeadOfDepartment ? (
            <div className={spanAll}>
              <FormField label="Head of department">
                <select
                  value=""
                  onChange={(e) => {
                    addHeadOfDepartment(Number(e.target.value));
                    e.target.value = "";
                  }}
                  className={inputClass}
                  disabled={!usersData}
                >
                  <option value="">
                    {usersData ? "Select employee…" : "Loading employees…"}
                  </option>
                  {employeeOptions.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name ?? u.email ?? `User #${u.id}`}
                      {u.department ? ` · ${u.department}` : ""}
                    </option>
                  ))}
                </select>
                {selectedHeads.length > 0 ? (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {selectedHeads.map((u) => (
                      <span
                        key={u.id}
                        className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700"
                      >
                        {u.name ?? u.email ?? `User #${u.id}`}
                        <button
                          type="button"
                          onClick={() => removeHeadOfDepartment(u.id)}
                          className="text-gray-400 hover:text-red-600 leading-none"
                          aria-label={`Remove ${u.name ?? "employee"}`}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs leading-relaxed break-words text-gray-400 mt-1">No head of department selected.</p>
                )}
              </FormField>
            </div>
          ) : null}
          {isSelf ? (
            <div className={spanAll}>
              <FormField label="Notes">
                <textarea
                  value={form.privateNotes}
                  onChange={(e) => setForm((prev) => ({ ...prev, privateNotes: e.target.value }))}
                  rows={5}
                  maxLength={10_000}
                  className={`${inputClass} h-auto min-h-[120px] py-2 resize-y`}
                  placeholder="Private notes only you can see — passwords, links, or anything else…"
                />
                <p className="text-xs leading-relaxed break-words text-gray-400 mt-1">
                  Only you can see this. Admins, HR, and other employees cannot access these notes.
                </p>
              </FormField>
            </div>
          ) : null}
        </div>
      )}
      {!compact ? (
        <PersonalDocumentsSection
          targetUserId={isSelf ? undefined : userId}
          canManage={isSelf || canEditEmploymentType}
          onError={onError}
        />
      ) : null}
      </div>

    </motion.div>
  );
}

function formatDocSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function PersonalDocumentsSection({
  targetUserId,
  canManage,
  onError,
}: {
  targetUserId?: number;
  canManage: boolean;
  onError?: (message: string) => void;
}) {
  const utils = trpc.useUtils();
  const [label, setLabel] = useState("");
  const [uploading, setUploading] = useState(false);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);

  const listInput = targetUserId != null ? { userId: targetUserId } : undefined;
  const { data, isLoading } = trpc.personalDocuments.list.useQuery(listInput);

  const uploadMutation = trpc.personalDocuments.upload.useMutation();

  const deleteMutation = trpc.personalDocuments.delete.useMutation({
    onSuccess: async () => {
      await utils.personalDocuments.list.invalidate(listInput);
    },
    onError: (error) => {
      onError?.(error.message || "Could not delete document.");
    },
  });

  async function handleFilesSelected(files: FileList | null) {
    if (!files?.length || !canManage) return;

    const selected = Array.from(files);
    const tooLarge = selected.find((file) => file.size > 20 * 1024 * 1024);
    if (tooLarge) {
      onError?.(
        `"${tooLarge.name}" is too large. Maximum size is 20 MB per file.`,
      );
      return;
    }

    setUploading(true);
    const sharedLabel = label.trim() || null;
    let uploadedCount = 0;
    try {
      for (const file of selected) {
        const dataBase64 = await readFileAsBase64(file);
        await uploadMutation.mutateAsync({
          userId: targetUserId,
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
          fileSize: file.size,
          label: sharedLabel,
          dataBase64,
        });
        uploadedCount += 1;
      }
      setLabel("");
      await utils.personalDocuments.list.invalidate(listInput);
    } catch (error) {
      onError?.(
        error instanceof Error
          ? error.message
          : uploadedCount > 0
            ? `Uploaded ${uploadedCount} file(s), then failed on the next one.`
            : "Could not upload files.",
      );
      if (uploadedCount > 0) {
        await utils.personalDocuments.list.invalidate(listInput);
      }
    } finally {
      setUploading(false);
    }
  }

  async function handleDownload(docId: number, fileName: string, mimeType: string) {
    setDownloadingId(docId);
    try {
      const full = await utils.personalDocuments.get.fetch({ id: docId });
      if (!full?.dataBase64) {
        onError?.("Could not download document.");
        return;
      }
      downloadFileFromBase64(fileName, mimeType, full.dataBase64);
    } catch (error) {
      onError?.(error instanceof Error ? error.message : "Could not download document.");
    } finally {
      setDownloadingId(null);
    }
  }

  const documents = data?.documents ?? [];

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-[#1F2937]">Documents</h3>
        <p className="text-xs text-gray-400 mt-0.5">
          Upload offer letters, increment letters, PAN/Aadhaar scans, PDFs, or other files.
          You can select multiple files at once.
        </p>
      </div>

      {canManage ? (
        <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
          <div className="flex-1 min-w-0">
            <label className="block text-xs text-gray-500 mb-1">Document label (optional)</label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Offer letter, PAN card"
              className={inputClass}
              maxLength={120}
            />
          </div>
          <label className="inline-flex items-center justify-center gap-2 h-10 px-4 rounded-lg bg-[#2563EB] text-white text-sm font-medium hover:bg-[#1D4ED8] cursor-pointer disabled:opacity-60">
            {uploading ? <Loader2 size={16} className="animate-spin" /> : <FileUp size={16} />}
            {uploading ? "Uploading…" : "Upload files"}
            <input
              type="file"
              multiple
              className="hidden"
              disabled={uploading}
              onChange={(e) => {
                void handleFilesSelected(e.target.files);
                e.target.value = "";
              }}
              accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,application/pdf"
            />
          </label>
        </div>
      ) : null}

      {isLoading ? (
        <div className="flex justify-center py-6">
          <Loader2 size={20} className="animate-spin text-gray-400" />
        </div>
      ) : documents.length === 0 ? (
        <p className="text-sm text-gray-400 py-2">No documents uploaded yet.</p>
      ) : (
        <ul className="divide-y divide-gray-100 border border-gray-100 rounded-lg">
          {documents.map((doc) => (
            <li
              key={doc.id}
              className="flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50/80"
            >
              <Paperclip size={16} className="text-gray-400 flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-sm text-[#1F2937] truncate font-medium">
                  {doc.label || doc.fileName}
                </div>
                <div className="text-xs text-gray-400 truncate">
                  {doc.label ? `${doc.fileName} · ` : ""}
                  {formatDocSize(doc.fileSize)}
                  {doc.createdAt
                    ? ` · ${formatWorkZoneDateTime(doc.createdAt, {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}`
                    : ""}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void handleDownload(doc.id, doc.fileName, doc.mimeType)}
                disabled={downloadingId === doc.id}
                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-200 text-gray-500"
                title="Download"
              >
                {downloadingId === doc.id ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Download size={14} />
                )}
              </button>
              {canManage ? (
                <button
                  type="button"
                  onClick={() => {
                    const confirmed = window.confirm(`Delete "${doc.label || doc.fileName}"?`);
                    if (!confirmed) return;
                    deleteMutation.mutate({ id: doc.id });
                  }}
                  disabled={deleteMutation.isPending}
                  className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-red-50 text-red-500"
                  title="Delete"
                >
                  <Trash2 size={14} />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
