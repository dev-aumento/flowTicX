import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import {
  FolderKanban,
  ListTodo,
  Menu,
  Plus,
  Search,
  UserPlus,
  FileText,
} from "lucide-react";
import { ProfileMenu } from "@/components/layout/ProfileMenu";
import { NotificationMenu } from "@/components/layout/NotificationMenu";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { useAuth } from "@/hooks/useAuth";
import { isFinanceRoleOnly } from "@/lib/leave-policy";
import { isClientPortalUser } from "@/lib/client-portal";
import { isAdminChromeUser } from "@/lib/admin-chrome";
import { trpc } from "@/providers/trpc";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { buildSearchSuggestions } from "@/lib/unified-search";

interface TopbarProps {
  sidebarWidth: number;
  showMenuButton?: boolean;
  onMenuClick?: () => void;
}

function AdminSearch({
  placeholder = "Search anything...",
  asana = false,
}: {
  placeholder?: string;
  asana?: boolean;
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const q = query.trim();

  const { data: usersData } = trpc.user.listForPicker.useQuery(
    { limit: 200 },
    { enabled: open || q.length > 0, staleTime: 60_000 },
  );
  const { data: projectsData } = trpc.project.listForPicker.useQuery(undefined, {
    enabled: open || q.length > 0,
    staleTime: 60_000,
  });

  const suggestions = useMemo(
    () =>
      buildSearchSuggestions(
        q,
        {
          users: (usersData?.users ?? []).map((u) => ({
            id: u.id,
            name: u.name,
            avatar: u.avatar,
          })),
          projects: (projectsData ?? []).map((p) => ({ id: p.id, name: p.name })),
        },
        [],
        8,
      ),
    [q, usersData, projectsData],
  );

  const go = (kind: string, id: number) => {
    setOpen(false);
    setQuery("");
    if (kind === "user") navigate("/admin/employees");
    else if (kind === "project") navigate(`/projects/${id}`);
    else navigate("/admin/tasks");
  };

  return (
    <div className="relative w-full max-w-[420px]">
      <Search
        size={16}
        className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 dark:text-slate-500"
      />
      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          window.setTimeout(() => setOpen(false), 150);
        }}
        placeholder={placeholder}
        className={
          asana
            ? "h-8 w-full rounded-lg border-0 bg-white pl-10 pr-4 text-sm text-[#1E1F21] placeholder:text-[#9B9C9E] outline-none ring-1 ring-[#E8E5E1] focus:ring-2 focus:ring-[#4573D2]/30 dark:bg-[#2A2B2D] dark:text-white dark:ring-[#3D3E40]"
            : "h-10 w-full rounded-xl border border-gray-200 bg-gray-50 pl-10 pr-4 text-sm text-[#1F2937] placeholder:text-gray-400 outline-none focus:border-[#3B82F6]/60 focus:ring-2 focus:ring-[#3B82F6]/20 dark:border-[#1C2330] dark:bg-[#12161E] dark:text-white dark:placeholder:text-slate-500"
        }
      />
      {open && q && suggestions.length > 0 ? (
        <div className="absolute z-50 mt-1.5 w-full overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl dark:border-[#1C2330] dark:bg-[#12161E]">
          {suggestions.map((item) => (
            <button
              key={`${item.kind}-${item.id}`}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => go(item.kind, item.id)}
              className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-white/5"
            >
              <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 w-14 shrink-0">
                {item.kind}
              </span>
              <span className="truncate">{item.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function AdminQuickCreate({ client = false }: { client?: boolean }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const actions = client
    ? [
        { label: "Task", icon: ListTodo, path: "/admin/tasks" },
        { label: "Project", icon: FolderKanban, path: "/projects" },
        { label: "Invite", icon: UserPlus, path: "/admin/employees" },
      ]
    : [
        { label: "New task", icon: ListTodo, path: "/admin/tasks" },
        { label: "New project", icon: FolderKanban, path: "/projects" },
        { label: "New invoice", icon: FileText, path: "/admin/invoices" },
        { label: "Add employee", icon: UserPlus, path: "/admin/employees" },
      ];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverContent
        align="end"
        className="w-48 p-1.5 rounded-xl border-gray-200 bg-white text-[#1F2937] dark:border-[#1C2330] dark:bg-[#12161E] dark:text-white"
      >
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            onClick={() => {
              setOpen(false);
              navigate(action.path);
            }}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-white/5"
          >
            <action.icon size={15} className="text-slate-400" />
            {action.label}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

export function Topbar({ sidebarWidth, showMenuButton, onMenuClick }: TopbarProps) {
  const { user } = useAuth();
  const hideNotifications = isFinanceRoleOnly(user);
  const adminChrome = isAdminChromeUser(user);
  const clientChrome = isClientPortalUser(user);

  if (clientChrome) {
    return (
      <header
        className="app-topbar fixed top-0 right-0 h-12 bg-[#F6F4F2]/90 backdrop-blur-sm border-b border-[#E8E5E1] z-30 flex items-center gap-3 px-4 sm:px-6 transition-[left] duration-300 dark:bg-[#25262A]/90 dark:border-[#2E2F32]"
        style={{ left: sidebarWidth }}
      >
        {showMenuButton ? (
          <button
            type="button"
            onClick={onMenuClick}
            className="h-8 w-8 flex items-center justify-center rounded-md text-[#6D6E6F] hover:bg-[#EDEAE6] hover:text-[#1E1F21] shrink-0 dark:text-[#D0CFCD] dark:hover:bg-[#2E2F32] dark:hover:text-[#F5F4F3]"
            aria-label="Open navigation menu"
          >
            <Menu size={18} />
          </button>
        ) : null}

        <div className="flex-1 min-w-0 max-w-md">
          <AdminSearch placeholder="Search" asana />
        </div>

        <div className="flex items-center gap-1.5 shrink-0 ml-auto">
          <ThemeToggle
            className="hover:bg-[#EDEAE6] dark:hover:bg-white/8"
            iconClassName="text-[#6D6E6F]"
          />
          {!hideNotifications ? <NotificationMenu variant="client" /> : null}
          <AdminQuickCreate client />
          <ProfileMenu variant="client" />
        </div>
      </header>
    );
  }

  if (adminChrome) {
    return (
      <header
        className="app-topbar fixed top-0 right-0 h-16 bg-white border-b border-gray-200 z-30 flex items-center gap-4 px-4 sm:px-6 transition-[left] duration-300 dark:bg-[#0d1117] dark:border-[#1e293b]"
        style={{ left: sidebarWidth }}
      >
        <div className="flex items-center gap-3 min-w-0">
          {showMenuButton ? (
            <button
              type="button"
              onClick={onMenuClick}
              className="h-9 w-9 flex items-center justify-center rounded-lg border border-gray-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-colors shrink-0 dark:border-[#1C2330] dark:text-slate-300 dark:hover:bg-white/5 dark:hover:text-white"
              aria-label="Open navigation menu"
            >
              <Menu size={20} />
            </button>
          ) : null}
        </div>

        <div className="flex-1 flex justify-center min-w-0">
          <AdminSearch />
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <ThemeToggle
            className="hover:bg-gray-100 dark:hover:bg-white/5"
            iconClassName="text-gray-500 dark:text-slate-400"
          />
          {!hideNotifications ? <NotificationMenu variant="admin" /> : null}
          <AdminQuickCreate />
          <ProfileMenu variant="admin" />
        </div>
      </header>
    );
  }

  return (
    <header
      className="app-topbar fixed top-0 right-0 h-14 sm:h-16 bg-white dark:bg-[#0d1117] border-b border-gray-200 dark:border-[#1e293b] z-30 flex items-center justify-between gap-3 px-4 sm:px-6 transition-[left] duration-300"
      style={{ left: sidebarWidth }}
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        {showMenuButton ? (
          <button
            type="button"
            onClick={onMenuClick}
            className="h-9 w-9 flex items-center justify-center rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-[#2563EB] transition-colors shrink-0"
            aria-label="Open navigation menu"
          >
            <Menu size={20} />
          </button>
        ) : null}
      </div>

      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
        <ThemeToggle />
        {!hideNotifications ? <NotificationMenu /> : null}
        <ProfileMenu />
      </div>
    </header>
  );
}
