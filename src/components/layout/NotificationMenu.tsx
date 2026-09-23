import { useCallback, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import {
  notificationListQueryOptions,
  useNotificationStreamInvalidation,
} from "@/hooks/useNotificationStream";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatTimeAgo } from "@/lib/utils";
import {
  filterNotificationsByPrefs,
  useNotificationPrefs,
} from "@/lib/notification-prefs";
import { notificationTarget } from "@/lib/notification-targets";
import { isPlatformUser } from "@/lib/platform-admin";
import {
  markNotificationReadInCache,
  NOTIFICATION_LIST_ALL,
  NOTIFICATION_LIST_UNREAD,
} from "@/lib/notification-list-cache";
import { useStableIdOrder } from "@/lib/stable-list-order";
import { Bell, CheckCheck, Loader2 } from "lucide-react";

type NotificationItem = {
  id: number;
  title: string;
  message: string;
  read: boolean | null;
  createdAt: Date | string;
  type?: string;
  taskId?: number | null;
  projectId?: number | null;
  activityId?: number | null;
  relatedOrganizationId?: number | null;
  link?: string | null;
};

export function NotificationMenu({
  variant = "default",
}: {
  variant?: "default" | "admin" | "client";
}) {
  const { user } = useAuth();
  const admin = variant === "admin";
  const client = variant === "client";
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const utils = trpc.useUtils();
  const notificationPrefs = useNotificationPrefs(user?.id);

  useNotificationStreamInvalidation();

  const { data, isLoading } = trpc.notification.list.useQuery(
    NOTIFICATION_LIST_ALL,
    { enabled: !!user, ...notificationListQueryOptions },
  );

  const { data: badgeData } = trpc.notification.list.useQuery(
    NOTIFICATION_LIST_UNREAD,
    { enabled: !!user, ...notificationListQueryOptions },
  );

  const markReadMutation = trpc.notification.markRead.useMutation({
    onMutate: ({ id }) => {
      markNotificationReadInCache(utils, id);
    },
    onSettled: () => {
      void utils.notification.list.invalidate();
    },
  });

  const markAllReadMutation = trpc.notification.markAllRead.useMutation({
    onSuccess: () => utils.notification.list.invalidate(),
  });

  const filteredNotifications = useMemo(
    () => filterNotificationsByPrefs(data?.notifications ?? [], notificationPrefs),
    [data?.notifications, notificationPrefs],
  );

  const sortNewNotifications = useCallback(
    (a: NotificationItem, b: NotificationItem) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    [],
  );

  const notifications = useStableIdOrder(filteredNotifications, sortNewNotifications);

  const unreadCount = useMemo(() => {
    const unread = filterNotificationsByPrefs(
      badgeData?.notifications ?? data?.notifications?.filter((n) => !n.read) ?? [],
      notificationPrefs,
    );
    return unread.length;
  }, [badgeData?.notifications, data?.notifications, notificationPrefs]);

  const handleOpen = (next: boolean) => {
    setOpen(next);
    if (next) utils.notification.list.invalidate();
  };

  const handleNotificationClick = (notif: NotificationItem) => {
    if (!notif.read) {
      markReadMutation.mutate({ id: notif.id });
    }
    const target = notificationTarget(notif, user);
    if (target) {
      setOpen(false);
      navigate(target);
    }
  };

  const handleMarkAsRead = (
    e: React.MouseEvent,
    notif: NotificationItem,
  ) => {
    e.stopPropagation();
    if (!notif.read) {
      markReadMutation.mutate({ id: notif.id });
    }
  };

  return (
    <Popover open={open} onOpenChange={handleOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={
            client
              ? "relative w-9 h-9 flex items-center justify-center rounded-lg hover:bg-[#EDEAE6] dark:hover:bg-white/8 transition-colors"
              : admin
                ? "relative w-10 h-10 flex items-center justify-center rounded-xl hover:bg-gray-100 dark:hover:bg-white/5 transition-colors"
                : "relative w-10 h-10 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          }
          aria-label="Notifications"
        >
          <Bell
            size={client ? 18 : 20}
            className={
              client
                ? "text-[#6D6E6F] dark:text-[#D0CFCD]"
                : admin
                  ? "text-gray-500 dark:text-slate-400"
                  : "text-gray-500 dark:text-gray-400"
            }
          />
          {unreadCount > 0 && (
            <span
              className={
                client || admin
                  ? "absolute -top-0.5 -right-0.5 bg-[#EF4444] text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1"
                  : "absolute top-1.5 right-1.5 bg-[#2563EB] text-white text-[9px] font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-1"
              }
            >
              {client || admin
                ? unreadCount > 99
                  ? "99+"
                  : unreadCount
                : unreadCount > 9
                  ? "9+"
                  : unreadCount}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[380px] p-0 rounded-xl border-gray-200 shadow-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Notifications</h3>
            <p className="text-xs text-gray-400 mt-0.5">
              {unreadCount > 0
                ? `${unreadCount} unread`
                : "You're all caught up"}
            </p>
          </div>
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={() => markAllReadMutation.mutate()}
              disabled={markAllReadMutation.isPending}
              className="text-xs font-medium text-[#2563EB] hover:text-[#1D4ED8] flex items-center gap-1 disabled:opacity-50"
            >
              {markAllReadMutation.isPending ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <CheckCheck size={12} />
              )}
              Mark all read
            </button>
          )}
        </div>

        <div className="max-h-[420px] overflow-y-auto scrollbar-thin">
          {isLoading && (
            <div className="flex items-center justify-center py-10">
              <Loader2 size={20} className="animate-spin text-gray-400" />
            </div>
          )}

          {!isLoading && notifications.length === 0 && (
            <div className="py-12 text-center px-4">
              <Bell size={28} className="mx-auto text-gray-200 mb-2" />
              <p className="text-sm text-gray-500">No notifications yet</p>
            </div>
          )}

          {!isLoading &&
            notifications.map((notif) => {
              const isUnread = !notif.read;
              const target = notificationTarget(notif as NotificationItem, user);
              return (
                <div
                  key={notif.id}
                  className={`group relative w-full text-left flex items-start gap-3 px-4 py-3 border-b border-gray-50 hover:bg-gray-50 transition-colors ${
                    isUnread ? "bg-blue-50/40" : ""
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => handleNotificationClick(notif as NotificationItem)}
                    className="flex items-start gap-3 flex-1 min-w-0 text-left pr-12"
                  >
                    <div
                      className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${
                        isUnread ? "bg-[#2563EB]" : "bg-transparent"
                      }`}
                    />
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm ${isUnread ? "font-semibold text-gray-900" : "font-medium text-gray-700"}`}>
                        {notif.title}
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{notif.message}</p>
                      <p className="text-[10px] text-gray-400 mt-1">{formatTimeAgo(notif.createdAt)}</p>
                    </div>
                  </button>
                  {target ? (
                    <span className="pointer-events-none absolute right-4 top-3 text-sm font-semibold text-[#2563EB] leading-5">
                      View
                    </span>
                  ) : null}
                  {isUnread ? (
                    <button
                      type="button"
                      onClick={(e) => handleMarkAsRead(e, notif as NotificationItem)}
                      className="opacity-100 md:opacity-0 md:group-hover:opacity-100 absolute right-4 bottom-3 text-[11px] font-medium text-[#2563EB] bg-white border border-blue-100 rounded-lg px-2 py-1 shadow-sm hover:bg-blue-50 transition-opacity shrink-0"
                    >
                      Mark read
                    </button>
                  ) : null}
                </div>
              );
            })}
        </div>
        {isPlatformUser(user) ? (
          <Link
            to="/platform/notifications"
            className="block border-t border-gray-100 px-4 py-2.5 text-center text-xs font-medium text-[#2563EB] hover:bg-gray-50"
            onClick={() => setOpen(false)}
          >
            View all notifications
          </Link>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
