import { useMemo } from "react";
import { useLocation } from "react-router";
import { useAuth } from "@/hooks/useAuth";
import { useTaskChatBadgeCount } from "@/hooks/useTaskChats";
import { requestDashboardRefresh } from "@/lib/dashboard-refresh";
import { canAccessRoute, hasPermission } from "@/lib/permissions";
import { clientCanViewDueDate } from "@/lib/client-visibility";
import { trpc } from "@/providers/trpc";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  FileText,
  Files,
  Flag,
  FolderKanban,
  Home,
  Inbox,
  ListTodo,
  LogOut,
  Plus,
  Settings,
  Users,
  BarChart3,
} from "lucide-react";
import { cn } from "@/lib/utils";

const PROJECT_DOTS = ["#F06A6A", "#F1BD6C", "#5DA283", "#4573D2", "#9A89C9", "#E362E3"];

function navItemClass(active: boolean, collapsed: boolean) {
  return cn(
    "w-full flex items-center gap-2.5 rounded-lg text-[13px] font-medium transition-colors",
    collapsed ? "justify-center px-0 py-2" : "px-2.5 py-1.5",
    active
      ? "bg-[#E8E5E1] text-[#1E1F21] dark:bg-[#3A3B3E] dark:text-[#F5F4F3] dark:hover:bg-[#3A3B3E] dark:hover:text-[#F5F4F3]"
      : "text-[#3E3F42] hover:bg-[#EDEAE6] hover:text-[#1E1F21] dark:text-[#D0CFCD] dark:hover:bg-[#2E2F32] dark:hover:text-[#F5F4F3]",
  );
}

type NavItem = {
  path: string;
  icon: React.ElementType;
  label: string;
  badge?: number;
};

export function ClientSidebarPanel({
  collapsed,
  showCollapseToggle,
  onToggle,
  onNavigate,
}: {
  collapsed: boolean;
  showCollapseToggle: boolean;
  onToggle: () => void;
  onNavigate: (path: string) => void;
}) {
  const location = useLocation();
  const { user, logout } = useAuth();
  const taskChatsCount = useTaskChatBadgeCount();
  const { data: org } = trpc.auth.organizationName.useQuery(undefined, { staleTime: 60_000 });
  const { data: projects } = trpc.project.listForPicker.useQuery(undefined, { staleTime: 30_000 });

  const workspaceName = org?.name?.trim() || "Workspace";
  const myTasksPath = hasPermission(user, "tasks.view_all") ? "/admin/tasks" : "/tasks";

  const primaryNav: NavItem[] = useMemo(
    () =>
      [
        { path: "/", icon: Home, label: "Home" },
        { path: myTasksPath, icon: ListTodo, label: "My tasks" },
        {
          path: "/client/messages",
          icon: Inbox,
          label: "Inbox",
          badge: taskChatsCount > 0 ? taskChatsCount : undefined,
        },
      ].filter((item) => canAccessRoute(user, item.path)),
    [taskChatsCount, myTasksPath, user],
  );

  const moreNav: NavItem[] = useMemo(
    () =>
      [
        { path: "/client/approvals", icon: ClipboardCheck, label: "Approvals" },
        { path: "/client/reports", icon: BarChart3, label: "Reports" },
        ...(clientCanViewDueDate(user)
          ? [{ path: "/client/milestones", icon: Flag, label: "Milestones" }]
          : []),
        { path: "/client/invoices", icon: FileText, label: "Invoices" },
        { path: "/client/files", icon: Files, label: "Files" },
        { path: "/client/meetings", icon: CalendarDays, label: "Meetings" },
        { path: "/admin/employees", icon: Users, label: "Team" },
      ].filter((item) => canAccessRoute(user, item.path)),
    [user],
  );

  const isActive = (path: string) => {
    if (path === "/") return location.pathname === "/";
    if (path === "/admin/tasks" || path === "/tasks") {
      return (
        location.pathname === "/admin/tasks" ||
        location.pathname.startsWith("/admin/tasks/") ||
        location.pathname === "/tasks" ||
        location.pathname.startsWith("/tasks/")
      );
    }
    if (path === "/projects") {
      if (/\/projects\/[^/]+\/tasks\//i.test(location.pathname)) return false;
      return location.pathname.startsWith("/projects");
    }
    return location.pathname.startsWith(path);
  };

  const handleNav = (path: string) => {
    if (path === "/" && location.pathname === "/") {
      requestDashboardRefresh();
      return;
    }
    onNavigate(path);
  };

  const renderItem = (item: NavItem) => {
    const active = isActive(item.path);
    return (
      <button
        key={item.path}
        type="button"
        onClick={() => handleNav(item.path)}
        className={navItemClass(active, collapsed)}
      >
        <item.icon size={18} strokeWidth={1.75} className="shrink-0" />
        {!collapsed ? (
          <>
            <span className="flex-1 text-left truncate">{item.label}</span>
            {item.badge ? (
              <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-[#F06A6A] text-white text-[10px] font-bold flex items-center justify-center">
                {item.badge}
              </span>
            ) : null}
          </>
        ) : null}
      </button>
    );
  };

  return (
    <div className="relative flex h-full flex-col bg-[#F6F4F2] text-[#1E1F21] border-r border-[#E8E5E1] dark:bg-[#1E1F21] dark:text-[#F5F4F3] dark:border-[#2E2F32]">
      <div
        className={cn(
          "relative h-14 flex items-center",
          collapsed ? "justify-center px-2" : "px-3 gap-2",
        )}
      >
        {collapsed ? (
          <button
            type="button"
            onClick={() => handleNav("/")}
            className="h-8 w-8 cursor-pointer rounded-lg bg-[#F06A6A] text-white text-xs font-bold flex items-center justify-center"
            aria-label="Go to dashboard"
          >
            {workspaceName.slice(0, 1).toUpperCase()}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => handleNav("/")}
            className="flex min-w-0 cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1.5 text-[#1E1F21] hover:bg-[#EDEAE6] dark:text-[#F5F4F3] dark:hover:bg-[#2E2F32] dark:hover:text-[#F5F4F3]"
          >
            <span className="h-7 w-7 rounded-lg bg-[#F06A6A] text-white text-xs font-bold flex items-center justify-center shrink-0">
              {workspaceName.slice(0, 1).toUpperCase()}
            </span>
            <span className="truncate text-[14px] font-semibold tracking-tight">{workspaceName}</span>
          </button>
        )}
        {showCollapseToggle ? (
          <button
            type="button"
            onClick={onToggle}
            className={
              collapsed
                ? "absolute top-1/2 -translate-y-1/2 -right-3 z-[130] flex h-6 w-6 items-center justify-center rounded-full bg-white text-[#6D6E6F] shadow border border-[#E8E5E1] hover:bg-[#F6F4F2] dark:bg-[#2A2B2D] dark:text-gray-200 dark:border-[#3D3E40]"
                : "ml-auto flex h-7 w-7 items-center justify-center rounded-md text-[#6D6E6F] hover:bg-[#EDEAE6] hover:text-[#1E1F21] dark:text-[#A2A0A0] dark:hover:bg-[#2E2F32] dark:hover:text-[#F5F4F3]"
            }
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
          </button>
        ) : null}
      </div>

      <nav className="flex-1 overflow-y-auto overflow-x-hidden px-2 pb-3 space-y-4">
        <div className="space-y-0.5">{primaryNav.map(renderItem)}</div>

        <div>
          {!collapsed ? (
            <div className="flex items-center justify-between px-2.5 mb-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6D6E6F] dark:text-[#A2A0A0]">
                Projects
              </p>
              <button
                type="button"
                onClick={() => onNavigate("/projects?create=1")}
                className="h-5 w-5 flex items-center justify-center rounded text-[#6D6E6F] hover:bg-[#EDEAE6] hover:text-[#1E1F21] dark:text-[#A2A0A0] dark:hover:bg-[#2E2F32] dark:hover:text-[#F5F4F3]"
                aria-label="New project"
              >
                <Plus size={14} />
              </button>
            </div>
          ) : (
            <div className="mx-2 mb-1 border-t border-[#E8E5E1] dark:border-[#2E2F32]" />
          )}
          <div className="space-y-0.5">
            <button
              type="button"
              onClick={() => handleNav("/projects")}
              className={navItemClass(isActive("/projects"), collapsed)}
            >
              {collapsed ? <FolderKanban size={18} /> : <span className="truncate">All projects</span>}
            </button>
            {!collapsed
              ? (projects ?? []).slice(0, 8).map((project, index) => (
                  <button
                    key={project.id}
                    type="button"
                    onClick={() => onNavigate(`/projects/${project.id}`)}
                    className={navItemClass(location.pathname === `/projects/${project.id}`, false)}
                  >
                    <span
                      className="h-2.5 w-2.5 rounded-[3px] shrink-0"
                      style={{ background: project.color || PROJECT_DOTS[index % PROJECT_DOTS.length] }}
                    />
                    <span className="truncate">{project.name}</span>
                  </button>
                ))
              : null}
          </div>
        </div>

        <div>
          {!collapsed ? (
            <p className="px-2.5 mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6D6E6F] dark:text-[#A2A0A0]">
              More
            </p>
          ) : null}
          <div className="space-y-0.5">{moreNav.map(renderItem)}</div>
        </div>
      </nav>

      <div className="px-2 py-2 border-t border-[#E8E5E1] dark:border-[#2E2F32] space-y-0.5">
        {!collapsed && user?.name ? (
          <p className="px-2.5 py-1 text-[11px] text-[#6D6E6F] truncate dark:text-[#A2A0A0]">{user.name}</p>
        ) : null}
        <button
          type="button"
          onClick={() => handleNav("/settings")}
          className={navItemClass(isActive("/settings"), collapsed)}
        >
          <Settings size={18} strokeWidth={1.75} />
          {!collapsed ? <span>Settings</span> : null}
        </button>
        <button
          type="button"
          onClick={logout}
          className={navItemClass(false, collapsed)}
        >
          <LogOut size={18} strokeWidth={1.75} />
          {!collapsed ? <span>Log out</span> : null}
        </button>
      </div>
    </div>
  );
}
