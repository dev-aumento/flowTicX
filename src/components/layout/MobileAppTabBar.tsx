import { useMemo, type ElementType } from "react";
import { useLocation, useNavigate } from "react-router";
import {
  CircleCheck,
  FileText,
  FolderKanban,
  Home,
  MessageCircle,
  Receipt,
  Wallet,
} from "lucide-react";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { useAuth } from "@/hooks/useAuth";
import { useTaskChatBadgeCount } from "@/hooks/useTaskChats";
import { trpc } from "@/providers/trpc";
import { isClientPortalUser } from "@/lib/client-portal";
import { isFinanceRoleOnly } from "@/lib/leave-policy";
import { canAccessRoute } from "@/lib/permissions";
import { requestDashboardRefresh } from "@/lib/dashboard-refresh";
import { NOTIFICATION_LIST_UNREAD } from "@/lib/notification-list-cache";
import { notificationListQueryOptions } from "@/hooks/useNotificationStream";
import { cn } from "@/lib/utils";

type TabItem = {
  path: string;
  label: string;
  icon: ElementType;
  badge?: number;
  profile?: boolean;
};

function isTabActive(pathname: string, path: string) {
  if (path === "/") return pathname === "/";
  if (path === "/tasks") return pathname === "/tasks" || pathname.startsWith("/tasks/");
  if (path === "/admin/tasks") return pathname === "/admin/tasks" || pathname.startsWith("/admin/tasks/");
  if (path === "/projects") {
    if (/\/projects\/[^/]+\/tasks\//i.test(pathname)) return false;
    return pathname.startsWith("/projects");
  }
  if (path === "/settings") return pathname === "/settings" || pathname.startsWith("/settings/");
  return pathname === path || pathname.startsWith(`${path}/`);
}

function allowed(user: ReturnType<typeof useAuth>["user"], item: TabItem | null): item is TabItem {
  if (!item) return false;
  if (item.path === "/" || item.path === "/settings") return true;
  return canAccessRoute(user, item.path);
}

export function MobileAppTabBar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const chatCount = useTaskChatBadgeCount();
  const client = isClientPortalUser(user);
  const finance = isFinanceRoleOnly(user);
  const { data: unreadData } = trpc.notification.list.useQuery(NOTIFICATION_LIST_UNREAD, {
    enabled: !!user,
    ...notificationListQueryOptions,
  });
  const unreadCount = unreadData?.unreadCount ?? 0;

  const { left, right } = useMemo(() => {
    const chatPath = client ? "/client/messages" : "/task-chats";
    const tasksPath = canAccessRoute(user, "/tasks")
      ? "/tasks"
      : canAccessRoute(user, "/admin/tasks")
        ? "/admin/tasks"
        : null;
    const profile: TabItem = {
      path: "/settings",
      label: "Menu",
      icon: Home,
      profile: true,
      badge: unreadCount > 0 ? unreadCount : undefined,
    };
    const keep = (items: Array<TabItem | null>) => items.filter((item) => allowed(user, item));

    if (finance) {
      return {
        left: keep([
          { path: "/admin/invoices", label: "Invoices", icon: FileText },
          { path: "/finance/payments", label: "Payments", icon: Wallet },
        ]),
        right: keep([{ path: "/finance/expenses", label: "Expenses", icon: Receipt }, profile]),
      };
    }

    return {
      left: keep([
        tasksPath ? { path: tasksPath, label: "Tasks", icon: CircleCheck } : null,
        canAccessRoute(user, "/projects")
          ? { path: "/projects", label: "Projects", icon: client ? FolderKanban : FileText }
          : null,
      ]),
      right: keep([
        {
          path: chatPath,
          label: client ? "Inbox" : "Chat",
          icon: MessageCircle,
          badge: chatCount > 0 ? chatCount : undefined,
        },
        profile,
      ]),
    };
  }, [chatCount, client, finance, unreadCount, user]);

  const go = (path: string) => {
    if (path === "/" && location.pathname === "/") {
      requestDashboardRefresh();
      return;
    }
    navigate(path);
  };

  return (
    <nav
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40 px-3"
      style={{ paddingBottom: "max(0.65rem, env(safe-area-inset-bottom))" }}
      aria-label="App menu"
    >
      <div className="pointer-events-auto relative mx-auto max-w-lg">
        <div className="native-floating-tabbar flex h-[62px] items-center rounded-full px-1.5">
          <div className="flex flex-1 items-center justify-around">
            {left.map((tab) => (
              <TabButton
                key={tab.path}
                tab={tab}
                active={isTabActive(location.pathname, tab.path)}
                userName={user?.name}
                userAvatar={user?.avatar}
                onClick={() => go(tab.path)}
              />
            ))}
          </div>
          <div className="w-[68px] shrink-0" />
          <div className="flex flex-1 items-center justify-around">
            {right.map((tab) => (
              <TabButton
                key={tab.path}
                tab={tab}
                active={isTabActive(location.pathname, tab.path)}
                userName={user?.name}
                userAvatar={user?.avatar}
                onClick={() => go(tab.path)}
              />
            ))}
          </div>
        </div>
        <button
          type="button"
          onClick={() => go("/")}
          aria-label="Home"
          aria-current={location.pathname === "/" ? "page" : undefined}
          className="absolute left-1/2 top-0 z-10 grid h-16 w-16 -translate-x-1/2 -translate-y-[18px] place-items-center rounded-full bg-[#2F6FED] text-white shadow-[0_10px_22px_rgba(47,111,237,0.45)]"
        >
          <Home size={26} strokeWidth={2.25} />
        </button>
      </div>
    </nav>
  );
}

function TabButton({
  tab,
  active,
  userName,
  userAvatar,
  onClick,
}: {
  tab: TabItem;
  active: boolean;
  userName?: string | null;
  userAvatar?: string | null;
  onClick: () => void;
}) {
  const Icon = tab.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={tab.label}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative grid h-12 w-12 place-items-center",
        active ? "text-[#2F6FED]" : "text-[#9AA3AF]",
      )}
    >
      {tab.profile ? (
        <span className={cn("rounded-full", active && "ring-2 ring-[#2F6FED]")}>
          <UserAvatar name={userName} avatar={userAvatar} size={28} />
        </span>
      ) : (
        <Icon size={24} strokeWidth={active ? 2.25 : 1.75} />
      )}
      {tab.badge ? (
        <span className="absolute right-0.5 top-0.5 grid min-w-4 place-items-center rounded-full bg-[#EF4444] px-1 text-[9px] font-bold leading-4 text-white">
          {tab.badge > 9 ? "9+" : tab.badge}
        </span>
      ) : null}
    </button>
  );
}
