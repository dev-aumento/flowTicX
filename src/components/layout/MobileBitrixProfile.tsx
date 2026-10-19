import { useState, type ElementType, type ReactNode } from "react";
import { useNavigate } from "react-router";
import {
  Bell,
  Building2,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock,
  CreditCard,
  FolderKanban,
  Landmark,
  Loader2,
  LogOut,
  Mail,
  MapPin,
  MessageSquare,
  Pause,
  Pencil,
  Phone,
  Play,
  Power,
  RefreshCw,
  Search,
  Settings,
  Tags,
  UserRound,
} from "lucide-react";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { AvatarPickerModal } from "@/components/settings/AvatarPickerModal";
import { AdminSearch } from "@/components/layout/Topbar";
import { PlanExpiryNotice } from "@/components/billing/PlanExpiryNotice";
import { CrossDayClockOutDialog } from "@/components/time-tracking/CrossDayClockOutDialog";
import { useAuth } from "@/hooks/useAuth";
import { useWorkdayClock } from "@/hooks/useWorkdayClock";
import { trpc } from "@/providers/trpc";
import { isClientPortalUser } from "@/lib/client-portal";
import { isFinanceRoleOnly } from "@/lib/leave-policy";
import { canAccessRoute, hasPermission } from "@/lib/permissions";
import { hasPlanFeature } from "@/lib/plan-features";
import { useWorkspaceNavItems } from "@/components/layout/Sidebar";
import { useClientMoreNavItems } from "@/components/layout/ClientSidebar";
import { SHOW_LOCATION_QR_MENU, isLocationQrMenuPath } from "@/lib/location-qr-menu";
import { roleConfig, cn } from "@/lib/utils";

type SectionKey =
  | "personal"
  | "workspace"
  | "notifications"
  | "organization"
  | "plans"
  | "task-status";

type MobileBitrixProfileProps = {
  section: string;
  onOpenSection: (key: SectionKey) => void;
  onBack: () => void;
  detail: ReactNode;
};

type ToolItem = {
  path: string;
  label: string;
  icon: ElementType;
  section: string;
};

function roleLabel(role: string | undefined) {
  if (role && role in roleConfig) return roleConfig[role as keyof typeof roleConfig].label;
  return "Employee";
}

function ActionButton({
  label,
  icon: Icon,
  onClick,
  disabled,
}: {
  label: string;
  icon: typeof Phone;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-[4.5rem] flex-col items-center gap-1.5 disabled:opacity-40"
    >
      <span className="grid h-12 w-12 place-items-center rounded-full border border-[#E3E7EA] bg-white text-[#525C69] dark:border-[#2A3341] dark:bg-[#111827] dark:text-slate-200">
        <Icon size={20} strokeWidth={1.75} />
      </span>
      <span className="text-[11px] text-[#828B95]">{label}</span>
    </button>
  );
}

function InfoRow({
  label,
  value,
  href,
}: {
  label: string;
  value: string;
  href?: string;
}) {
  const shown = value.trim() || "—";
  const body = (
    <span className="flex min-w-0 flex-1 items-center justify-between gap-3">
      <span className="text-[15px] text-[#333333] dark:text-slate-100">{label}</span>
      <span className="truncate text-[15px] text-[#828B95]">{shown}</span>
    </span>
  );
  const className = "flex items-center border-b border-[#F0F2F4] px-4 py-3.5 last:border-b-0 dark:border-[#1E293B]";
  if (!href || !value.trim()) return <div className={className}>{body}</div>;
  return (
    <a href={href} className={className}>
      {body}
    </a>
  );
}

function MenuRow({
  label,
  icon: Icon,
  onClick,
  danger,
}: {
  label: string;
  icon: ElementType;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 border-b border-[#F0F2F4] px-4 py-3.5 text-left last:border-b-0 dark:border-[#1E293B]"
    >
      <span
        className={cn(
          "grid h-9 w-9 place-items-center rounded-full",
          danger ? "bg-[#FDECEC] text-[#E25252]" : "bg-[#F2F6F8] text-[#2FC6F6] dark:bg-[#152033]",
        )}
      >
        <Icon size={18} strokeWidth={1.75} />
      </span>
      <span className={cn("flex-1 text-[16px]", danger ? "text-[#E25252]" : "text-[#333333] dark:text-slate-100")}>
        {label}
      </span>
      {danger ? null : <ChevronRight size={18} className="text-[#C4C9CE]" />}
    </button>
  );
}

function ToolRow({ item, onClick }: { item: ToolItem; onClick: () => void }) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 border-b border-white/8 px-4 py-3.5 text-left last:border-b-0"
    >
      <Icon size={20} strokeWidth={1.75} className="text-white/80" />
      <span className="flex-1 text-[16px] text-white">{item.label}</span>
      <ChevronRight size={18} className="text-white/35" />
    </button>
  );
}

export function MobileBitrixProfile({
  section,
  onOpenSection,
  onBack,
  detail,
}: MobileBitrixProfileProps) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const financeOnly = isFinanceRoleOnly(user);
  const clientPortal = isClientPortalUser(user);
  const showWorkday = !financeOnly && !clientPortal && hasPlanFeature(user, "time_tracking");
  const workday = useWorkdayClock();
  const personalQuery = trpc.auth.getPersonalInfo.useQuery(undefined, {
    enabled: !!user && !financeOnly,
  });
  const updateProfile = trpc.auth.updateProfile.useMutation({
    onSuccess: async (updatedUser) => {
      utils.auth.me.setData(undefined, updatedUser);
      await utils.auth.me.invalidate();
    },
  });

  const personal = personalQuery.data;
  const name = user?.name?.trim() || "Profile";
  const position = (personal?.position || user?.position || "").trim();
  const department = (personal?.department || user?.department || "").trim();
  const phone = (personal?.phone || user?.phone || "").trim();
  const email = (user?.email || personal?.email || "").trim();
  const headline = position || roleLabel(user?.role);
  const chatPath = clientPortal ? "/client/messages" : "/task-chats";
  const tasksPath = canAccessRoute(user, "/tasks")
    ? "/tasks"
    : canAccessRoute(user, "/admin/tasks")
      ? "/admin/tasks"
      : null;
  const workspaceNav = useWorkspaceNavItems();
  const clientMore = useClientMoreNavItems();

  const primaryTools = [
    canAccessRoute(user, chatPath)
      ? { path: chatPath, label: "Task Chats", icon: MessageSquare, section: "COLLABORATION" }
      : null,
    tasksPath
      ? { path: tasksPath, label: "Tasks & Projects", icon: ClipboardList, section: "COLLABORATION" }
      : null,
    canAccessRoute(user, "/projects")
      ? { path: "/projects", label: "Projects", icon: FolderKanban, section: "COLLABORATION" }
      : null,
    canAccessRoute(user, "/leaves")
      ? { path: "/leaves", label: "Leaves", icon: CalendarDays, section: "HR" }
      : null,
    canAccessRoute(user, "/time-tracking")
      ? { path: "/time-tracking", label: "Time Tracking", icon: Clock, section: "HR" }
      : null,
  ].filter((item): item is NonNullable<typeof item> => item !== null);

  const primaryPaths = new Set(primaryTools.map((item) => item.path));
  const extraTools: ToolItem[] = (clientPortal ? clientMore : workspaceNav)
    .filter((item) => {
      if (item.path === "/" || item.path === "/settings") return false;
      if (primaryPaths.has(item.path)) return false;
      if (!SHOW_LOCATION_QR_MENU && isLocationQrMenuPath(item.path)) return false;
      return true;
    })
    .map((item): ToolItem => {
      const section = "section" in item && typeof item.section === "string" ? item.section : "";
      return {
        path: item.path,
        label: item.label,
        icon: item.icon,
        section: section || "MORE",
      };
    });

  const toolGroups = groupTools([...primaryTools, ...extraTools]);

  const sections: Array<{ key: SectionKey; label: string; icon: typeof UserRound }> = [
    financeOnly ? null : { key: "personal" as const, label: "Personal information", icon: UserRound },
    financeOnly || clientPortal ? null : { key: "workspace" as const, label: "Workspace", icon: Building2 },
    financeOnly ? null : { key: "notifications" as const, label: "Notifications", icon: Bell },
    user?.role === "admin" ? { key: "organization" as const, label: "Organization", icon: Landmark } : null,
    user?.role === "admin" ? { key: "plans" as const, label: "Plans", icon: CreditCard } : null,
    hasPermission(user, "settings.task_status") && !clientPortal && !financeOnly
      ? { key: "task-status" as const, label: "Task statuses", icon: Tags }
      : null,
  ].filter((item): item is { key: SectionKey; label: string; icon: typeof UserRound } => item !== null);

  const refreshMenu = async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        utils.timeEntry.getCurrentSession.invalidate(),
        utils.timeEntry.getStats.invalidate(),
        utils.task.list.invalidate(),
        utils.dashboard.getStats.invalidate(),
        utils.notification.list.invalidate(),
        utils.auth.me.invalidate(),
      ]);
    } finally {
      setRefreshing(false);
    }
  };

  if (section !== "profile") {
    const title = sections.find((item) => item.key === section)?.label ?? "Profile";
    return (
      <div className="min-h-full bg-[#F4F7F8] px-4 pb-28 dark:bg-[#0d1117]">
        <div
          className="sticky top-0 z-10 -mx-4 mb-4 flex items-center gap-1 bg-[#F4F7F8]/95 px-2 pb-3 backdrop-blur dark:bg-[#0d1117]/95"
          style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
        >
          <button
            type="button"
            onClick={onBack}
            className="grid h-10 w-10 place-items-center rounded-full text-[#525C69] dark:text-slate-200"
            aria-label="Back to profile"
          >
            <ChevronLeft size={22} />
          </button>
          <h1 className="text-[17px] font-semibold text-[#333333] dark:text-white">{title}</h1>
        </div>
        <div className="rounded-2xl bg-white p-4 dark:bg-[#111827]">{detail}</div>
      </div>
    );
  }

  if (showAccount) {
    return (
      <div className="min-h-full bg-[#F4F7F8] pb-28 dark:bg-[#0d1117]">
        <div
          className="sticky top-0 z-10 flex items-center gap-1 bg-[#F4F7F8]/95 px-2 pb-3 backdrop-blur dark:bg-[#0d1117]/95"
          style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
        >
          <button
            type="button"
            onClick={() => setShowAccount(false)}
            className="grid h-10 w-10 place-items-center rounded-full text-[#525C69] dark:text-slate-200"
            aria-label="Back to menu"
          >
            <ChevronLeft size={22} />
          </button>
          <h1 className="text-[17px] font-semibold text-[#333333] dark:text-white">Profile</h1>
        </div>
        <section className="bg-white px-5 pb-6 dark:bg-[#111827]">
          <div className="mb-2 flex justify-end">
            {financeOnly ? (
              <span className="h-10 w-10" />
            ) : (
              <button
                type="button"
                onClick={() => onOpenSection("personal")}
                className="grid h-10 w-10 place-items-center rounded-full text-[#828B95]"
                aria-label="Edit profile"
              >
                <Pencil size={18} />
              </button>
            )}
          </div>
          <div className="flex flex-col items-center text-center">
            <button
              type="button"
              onClick={() => setAvatarOpen(true)}
              className="relative"
              aria-label="Change profile photo"
            >
              <UserAvatar name={name} avatar={user?.avatar} size={112} className="ring-4 ring-white dark:ring-[#111827]" />
              <span className="absolute bottom-1 right-1 h-4 w-4 rounded-full bg-[#9DCF00] ring-2 ring-white dark:ring-[#111827]" />
            </button>
            <h1 className="mt-3 text-[22px] font-semibold leading-tight text-[#333333] dark:text-white">{name}</h1>
            <p className="mt-1 text-[15px] text-[#828B95]">{headline}</p>
            {department ? <p className="mt-0.5 text-[14px] text-[#A8ADB4]">{department}</p> : null}
            <div className="mt-5 flex items-start justify-center gap-6">
              {canAccessRoute(user, chatPath) ? (
                <ActionButton label="Chat" icon={MessageSquare} onClick={() => navigate(chatPath)} />
              ) : null}
              <ActionButton
                label="Call"
                icon={Phone}
                disabled={!phone}
                onClick={() => {
                  window.location.href = `tel:${phone}`;
                }}
              />
              <ActionButton
                label="Email"
                icon={Mail}
                disabled={!email}
                onClick={() => {
                  window.location.href = `mailto:${email}`;
                }}
              />
            </div>
          </div>
        </section>

        <div className="space-y-5 px-4 pt-5">
          <section>
            <h2 className="mb-2 px-1 text-[12px] font-semibold uppercase tracking-wide text-[#A8ADB4]">Contact</h2>
            <div className="overflow-hidden rounded-2xl bg-white dark:bg-[#111827]">
              <InfoRow label="Mobile" value={phone} href={phone ? `tel:${phone}` : undefined} />
              <InfoRow label="Email" value={email} href={email ? `mailto:${email}` : undefined} />
            </div>
          </section>

          <section>
            <h2 className="mb-2 px-1 text-[12px] font-semibold uppercase tracking-wide text-[#A8ADB4]">Work</h2>
            <div className="overflow-hidden rounded-2xl bg-white dark:bg-[#111827]">
              <InfoRow label="Position" value={position} />
              <InfoRow label="Department" value={department} />
              <InfoRow label="Role" value={roleLabel(user?.role)} />
            </div>
          </section>

          <section>
            <h2 className="mb-2 px-1 text-[12px] font-semibold uppercase tracking-wide text-[#A8ADB4]">Account</h2>
            <div className="overflow-hidden rounded-2xl bg-white dark:bg-[#111827]">
              {sections.map((item) => (
                <MenuRow key={item.key} label={item.label} icon={item.icon} onClick={() => onOpenSection(item.key)} />
              ))}
              <MenuRow label="Log out" icon={LogOut} danger onClick={() => logout()} />
            </div>
          </section>
        </div>

        <AvatarPickerModal
          open={avatarOpen}
          name={name}
          currentAvatar={user?.avatar}
          onClose={() => setAvatarOpen(false)}
          onSelect={(avatarUrl) => {
            setAvatarOpen(false);
            updateProfile.mutate({ avatar: avatarUrl });
          }}
        />
      </div>
    );
  }

  return (
    <div className="min-h-full bg-[#07080C] pb-36 text-white">
      <div
        className="bg-gradient-to-b from-[#3B78F0] via-[#4E5FE6] to-[#6A45D6] px-5 pb-16"
        style={{ paddingTop: "max(0.85rem, env(safe-area-inset-top))" }}
      >
        <PlanExpiryNotice />
        <div className="flex items-center justify-between">
          <h1 className="text-[32px] font-bold tracking-tight">Menu</h1>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => void refreshMenu()}
              className="grid h-10 w-10 place-items-center text-white"
              aria-label="Refresh"
            >
              <RefreshCw size={20} className={refreshing ? "animate-spin" : ""} />
            </button>
            <button
              type="button"
              onClick={() => setSearchOpen((open) => !open)}
              className="grid h-10 w-10 place-items-center text-white"
              aria-label="Search"
            >
              <Search size={20} />
            </button>
          </div>
        </div>
        {searchOpen ? (
          <div className="mt-3">
            <AdminSearch placeholder="Search" />
          </div>
        ) : null}

        <div className="mt-6 flex flex-col items-center text-center">
          <button type="button" onClick={() => setShowAccount(true)} aria-label="Open profile">
            <UserAvatar name={name} avatar={user?.avatar} size={92} className="ring-4 ring-white/25" />
          </button>
          <button
            type="button"
            onClick={() => setShowAccount(true)}
            className="mt-3 inline-flex items-center gap-1 text-[20px] font-semibold"
          >
            {name}
            <ChevronRight size={18} />
          </button>
          <p className="mt-0.5 text-[14px] text-white/75">{roleLabel(user?.role)}</p>
        </div>
      </div>

      <div className="relative z-10 -mt-10 space-y-5 px-4">
        {showWorkday ? (
          <section className="overflow-hidden rounded-[22px] bg-[#1A2333] shadow-[0_12px_30px_rgba(0,0,0,0.28)]">
            <div className="flex items-center gap-3 px-4 py-4">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#143528] text-[#3DDC97]">
                <Clock size={20} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-mono text-[22px] font-semibold leading-none tracking-tight">{workday.timerLabel}</p>
                <p className="mt-1 text-[13px] text-white/50">{workday.subtitle}</p>
              </div>
              <button
                type="button"
                onClick={workday.togglePause}
                disabled={!workday.isClockedIn || workday.isBusy}
                aria-label={workday.isPaused ? "Resume work" : "Pause work"}
                className="grid h-11 w-11 place-items-center rounded-full border border-white/25 text-white disabled:opacity-35"
              >
                {workday.isPaused ? <Play size={18} /> : <Pause size={18} />}
              </button>
              <button
                type="button"
                onClick={workday.togglePower}
                disabled={workday.isBusy}
                aria-label={workday.isClockedIn ? "Clock out" : "Clock in"}
                className="grid h-11 w-11 place-items-center rounded-full bg-[#2F6FED] text-white disabled:opacity-60"
              >
                {workday.isBusy ? <Loader2 size={18} className="animate-spin" /> : <Power size={18} />}
              </button>
            </div>
            <div className="mx-4 border-t border-white/10" />
            <div className="flex items-center gap-3 px-4 py-3.5">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#1B3A5C] text-[#69A8FF]">
                <MapPin size={18} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-semibold">Check-in</p>
                <p className="text-[12px] text-white/45">Time & attendance</p>
              </div>
              <button
                type="button"
                onClick={() => navigate("/time-tracking")}
                className="rounded-full border border-white/20 px-4 py-1.5 text-[13px] font-medium"
              >
                Open
              </button>
            </div>
          </section>
        ) : null}

        {toolGroups.length > 0 ? (
          <section>
            <h2 className="mb-2 px-1 text-[18px] font-semibold">Tools</h2>
            <div className="overflow-hidden rounded-[22px] bg-[#141820]">
              {toolGroups.map((group) => (
                <div key={group.title}>
                  <p className="px-4 pb-1 pt-4 text-[11px] font-semibold tracking-[0.14em] text-white/40">
                    {group.title}
                  </p>
                  {group.items.map((item) => (
                    <ToolRow key={item.path} item={item} onClick={() => navigate(item.path)} />
                  ))}
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section>
          <h2 className="mb-2 px-1 text-[18px] font-semibold">Profile</h2>
          <div className="overflow-hidden rounded-[22px] bg-[#141820]">
            <ToolRow
              item={{ path: "settings", label: "Settings", icon: Settings, section: "PROFILE" }}
              onClick={() => setShowAccount(true)}
            />
            <button
              type="button"
              onClick={() => logout()}
              className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
            >
              <LogOut size={20} strokeWidth={1.75} className="text-[#F07167]" />
              <span className="flex-1 text-[16px] text-[#F07167]">Log out</span>
            </button>
          </div>
        </section>
      </div>

      {showWorkday && workday.currentSession?.active ? (
        <CrossDayClockOutDialog
          open={workday.clockOutAction.dialogOpen}
          onOpenChange={workday.clockOutAction.setDialogOpen}
          sessionStartTime={workday.currentSession.startTime}
          isPending={workday.clockOutAction.isPending}
          onConfirmNow={workday.clockOutAction.confirmClockOutNow}
          onUpdateTime={workday.clockOutAction.updateClockOutTime}
        />
      ) : null}
    </div>
  );
}

function groupTools(items: ToolItem[]) {
  const groups: { title: string; items: ToolItem[] }[] = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (last && last.title === item.section) last.items.push(item);
    else groups.push({ title: item.section, items: [item] });
  }
  return groups;
}
