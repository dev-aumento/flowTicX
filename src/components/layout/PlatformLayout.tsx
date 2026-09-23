import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Navigate, NavLink, Outlet, useLocation, useNavigate, useSearchParams } from "react-router";
import {
  Bell,
  CreditCard,
  LayoutDashboard,
  LogOut,
  Menu,
  Search,
  Settings,
  Users,
  Wallet,
} from "lucide-react";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { NotificationMenu } from "@/components/layout/NotificationMenu";
import { TaskNotificationToasts } from "@/components/notifications/TaskNotificationToasts";
import { AppToaster } from "@/components/ui/app-toaster";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useAuth } from "@/hooks/useAuth";
import { useLayoutMode } from "@/hooks/use-layout-mode";
import { isPlatformUser } from "@/lib/platform-admin";
import { getDefaultHomePath } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { trpc } from "@/providers/trpc";
import { BrandLogo } from "@/components/brand/BrandLogo";

const SIDEBAR_WIDTH = 240;

const NAV = [
  { to: "/platform", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/platform/clients", label: "Subscribed Clients", icon: Users },
  { to: "/platform/finance", label: "Finance", icon: Wallet },
  { to: "/platform/plans", label: "Subscription Plans", icon: CreditCard },
  { to: "/platform/notifications", label: "Notifications", icon: Bell },
];

function initials(name: string | null | undefined) {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "MA";
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("");
}

function navClass(isActive: boolean) {
  return cn(
    "flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13.5px] font-medium transition-colors",
    isActive
      ? "bg-white/20 text-white dark:bg-[#2563EB]/25 dark:text-[#93C5FD]"
      : "text-white/90 hover:bg-white/10 dark:text-slate-300 dark:hover:text-white dark:hover:bg-white/[0.06]",
  );
}

function PlatformBrand({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <NavLink
      to="/platform"
      onClick={onNavigate}
      className="flex min-w-0 flex-col items-start gap-1.5"
    >
      <BrandLogo variant="dark" />
      <span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-white/50">
        Powered by <span className="text-white/90">Aumento Infoway</span>
      </span>
    </NavLink>
  );
}

function PlatformSidebar({
  unreadCount,
  onLogout,
  onNavigate,
}: {
  unreadCount: number;
  onLogout: () => void;
  onNavigate?: () => void;
}) {
  return (
    <div className="relative flex h-full min-h-0 flex-col bg-gradient-to-b from-[#1e3a5f] via-[#2563EB] to-[#1e40af] dark:bg-none dark:bg-[#0a0e14] sidebar-chrome">
      <div
        className="pointer-events-none absolute inset-0 opacity-25 bg-[radial-gradient(circle_at_top,_white,_transparent_55%)] dark:opacity-30 dark:bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.12),_transparent_50%)]"
        aria-hidden
      />
      <div className="relative px-5 pt-5 pb-4">
        <PlatformBrand onNavigate={onNavigate} />
      </div>

      <div className="relative min-h-0 flex-1 overflow-y-auto px-4 pt-2">
        <p className="px-2 text-[10px] font-bold tracking-[0.16em] text-white/45">MAIN MENU</p>
        <nav className="mt-2 space-y-1">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={onNavigate}
              className={({ isActive }) => navClass(isActive)}
            >
              <item.icon size={17} className="shrink-0" />
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {item.to === "/platform/notifications" && unreadCount > 0 ? (
                <span className="min-w-[18px] rounded-full bg-[#EF4444] px-1.5 py-0.5 text-center text-[10px] font-bold text-white">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              ) : null}
            </NavLink>
          ))}
        </nav>
      </div>

      <div className="relative mt-auto border-t border-white/15 px-4 py-4 dark:border-[#1e293b]">
        <NavLink
          to="/platform/settings"
          onClick={onNavigate}
          className={({ isActive }) => navClass(isActive)}
        >
          <Settings size={17} className="shrink-0" />
          Platform Settings
        </NavLink>
        <button
          type="button"
          onClick={onLogout}
          className="mt-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[13.5px] font-medium text-white/90 hover:bg-white/10 dark:text-slate-300 dark:hover:text-white dark:hover:bg-white/[0.06]"
        >
          <LogOut size={17} className="shrink-0" />
          Logout
        </button>
      </div>
    </div>
  );
}

export function PlatformLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const layoutMode = useLayoutMode();
  const isDrawer = layoutMode === "drawer";
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [searchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const { data: unreadData } = trpc.notification.list.useQuery(
    { unreadOnly: true, limit: 50 },
    { enabled: isPlatformUser(user), staleTime: 30_000, refetchInterval: 30_000 },
  );
  const unreadCount = unreadData?.unreadCount ?? 0;

  useEffect(() => {
    setQuery(searchParams.get("q") ?? "");
  }, [searchParams]);

  useEffect(() => {
    if (!isDrawer) setDrawerOpen(false);
  }, [isDrawer]);

  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  if (!isPlatformUser(user)) {
    return <Navigate to={getDefaultHomePath(user)} replace />;
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    const next = query.trim();
    const params = new URLSearchParams();
    if (next) params.set("q", next);
    if (searchParams.get("tab") === "invited") params.set("tab", "invited");
    const qs = params.toString();
    navigate(qs ? `/platform/clients?${qs}` : "/platform/clients");
  }

  const sidebar: ReactNode = (
    <PlatformSidebar
      unreadCount={unreadCount}
      onLogout={logout}
      onNavigate={isDrawer ? () => setDrawerOpen(false) : undefined}
    />
  );

  return (
    <div className="min-h-screen overflow-x-hidden bg-[#F4F6F8] text-[#111827] dark:bg-[#0B1220] dark:text-[#F3F4F6]">
      {isDrawer ? (
        <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
          <SheetContent
            side="left"
            className="w-[min(280px,88vw)] max-w-[88vw] border-0 p-0 shadow-2xl [&>button]:hidden"
          >
            {sidebar}
          </SheetContent>
        </Sheet>
      ) : (
        <aside
          className="fixed inset-y-0 left-0 z-30 flex flex-col border-r border-white/10 dark:border-[#1E293B]"
          style={{ width: SIDEBAR_WIDTH }}
        >
          {sidebar}
        </aside>
      )}

      <div
        className="flex min-h-screen min-w-0 flex-col"
        style={{ paddingLeft: isDrawer ? 0 : SIDEBAR_WIDTH }}
      >
        <header className="sticky top-0 z-20 flex h-14 min-w-0 items-center gap-2 border-b border-[#E6E8EC] bg-white px-3 sm:h-16 sm:gap-3 sm:px-5 dark:border-[#1E293B] dark:bg-[#0F172A]">
          {isDrawer ? (
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[#4B5563] hover:bg-[#F3F4F6] dark:text-slate-300 dark:hover:bg-white/5"
              aria-label="Open navigation menu"
            >
              <Menu size={18} />
            </button>
          ) : null}

          <form onSubmit={submitSearch} className="relative min-w-0 flex-1 max-w-[560px]">
            <Search
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#9CA3AF] sm:left-4"
            />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search clients..."
              className="h-9 w-full rounded-full border border-[#E5E7EB] bg-[#F8FAFC] pl-9 pr-3 text-sm text-[#111827] outline-none placeholder:text-[#9CA3AF] focus:border-[#2563EB]/40 focus:bg-white sm:h-10 sm:pl-11 sm:pr-4 dark:border-[#334155] dark:bg-[#1E293B] dark:text-white"
            />
          </form>

          <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
            <ThemeToggle />
            <NotificationMenu variant="admin" />
            <div className="hidden items-center gap-2 rounded-full border border-[#E5E7EB] bg-white px-3 py-1.5 text-[11px] font-bold tracking-[0.08em] text-[#111827] lg:flex dark:border-[#334155] dark:bg-[#1E293B] dark:text-white">
              <span className="h-1.5 w-1.5 rounded-full bg-[#2563EB]" />
              MASTER ADMIN
            </div>
            <NavLink
              to="/platform/settings"
              aria-label="Open platform settings"
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2 rounded-full border py-1 pl-1 transition-colors",
                  "pr-1 sm:pr-3",
                  isActive
                    ? "border-[#2563EB]/40 bg-[#EEF4FF] dark:border-blue-500/40 dark:bg-blue-500/10"
                    : "border-[#E5E7EB] bg-white hover:border-[#2563EB]/30 hover:bg-[#F8FAFC] dark:border-[#334155] dark:bg-[#1E293B] dark:hover:bg-white/5",
                )
              }
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#2563EB] text-[11px] font-bold text-white">
                {initials(user?.name)}
              </div>
              <span className="hidden max-w-[120px] truncate text-sm font-semibold sm:inline lg:max-w-[140px]">
                {user?.name || "Aaso"}
              </span>
            </NavLink>
          </div>
        </header>
        <main
          className={cn(
            "min-w-0 max-w-full flex-1 overflow-x-hidden px-3 sm:px-6 lg:px-7",
            location.pathname === "/platform/settings"
              ? "py-3 sm:py-5"
              : "py-4 sm:py-6",
          )}
        >
          <Outlet />
        </main>
      </div>
      <TaskNotificationToasts />
      <AppToaster />
    </div>
  );
}
