import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Bell, CheckCheck, Loader2 } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { formatTimeAgo, cn } from "@/lib/utils";
import { notificationTarget } from "@/lib/notification-targets";
import {
  notificationListQueryOptions,
  useNotificationStreamInvalidation,
} from "@/hooks/useNotificationStream";
import { markNotificationReadInCache } from "@/lib/notification-list-cache";

const PAGE_LIST = { unreadOnly: false, limit: 200 } as const;
const PAGE_UNREAD = { unreadOnly: true, limit: 200 } as const;

export default function PlatformNotifications() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const [unreadOnly, setUnreadOnly] = useState(false);

  useNotificationStreamInvalidation();

  const { data, isLoading } = trpc.notification.list.useQuery(PAGE_LIST, {
    enabled: !!user,
    ...notificationListQueryOptions,
  });
  const { data: unreadData } = trpc.notification.list.useQuery(PAGE_UNREAD, {
    enabled: !!user,
    ...notificationListQueryOptions,
  });

  const markRead = trpc.notification.markRead.useMutation({
    onMutate: ({ id }) => {
      markNotificationReadInCache(utils, id);
    },
    onSettled: () => {
      void utils.notification.list.invalidate();
    },
  });
  const markAllRead = trpc.notification.markAllRead.useMutation({
    onSuccess: () => utils.notification.list.invalidate(),
  });

  const notifications = useMemo(() => {
    const rows = data?.notifications ?? [];
    return unreadOnly ? rows.filter((row) => !row.read) : rows;
  }, [data?.notifications, unreadOnly]);

  const unreadCount = unreadData?.unreadCount ?? data?.unreadCount ?? 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#111827] sm:text-[28px] dark:text-white">
            Notifications
          </h1>
          <p className="mt-1 text-sm text-[#6B7280]">
            Plan joins, updates, and cancellations across every Aaso customer.
          </p>
        </div>
        {unreadCount > 0 ? (
          <button
            type="button"
            disabled={markAllRead.isPending}
            onClick={() => markAllRead.mutate()}
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-[#E6E8EC] bg-white px-4 text-sm font-semibold text-[#2563EB] hover:bg-[#F8FAFC] disabled:opacity-60 dark:border-[#334155] dark:bg-[#0F172A] dark:hover:bg-white/5"
          >
            {markAllRead.isPending ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <CheckCheck size={15} />
            )}
            Mark all read
          </button>
        ) : null}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setUnreadOnly(false)}
          className={cn(
            "rounded-full px-3 py-1.5 text-sm font-medium",
            !unreadOnly
              ? "bg-[#2563EB] text-white"
              : "bg-[#F3F4F6] text-[#4B5563] hover:bg-[#E5E7EB] dark:bg-[#1E293B] dark:text-slate-300",
          )}
        >
          All
        </button>
        <button
          type="button"
          onClick={() => setUnreadOnly(true)}
          className={cn(
            "rounded-full px-3 py-1.5 text-sm font-medium",
            unreadOnly
              ? "bg-[#2563EB] text-white"
              : "bg-[#F3F4F6] text-[#4B5563] hover:bg-[#E5E7EB] dark:bg-[#1E293B] dark:text-slate-300",
          )}
        >
          Unread{unreadCount > 0 ? ` (${unreadCount})` : ""}
        </button>
      </div>

      <section className="overflow-hidden rounded-2xl border border-[#E6E8EC] bg-white shadow-sm dark:border-[#1E293B] dark:bg-[#0F172A]">
        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-[#6B7280]">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            Loading notifications...
          </div>
        ) : notifications.length === 0 ? (
          <div className="py-16 text-center">
            <Bell size={28} className="mx-auto mb-2 text-[#D1D5DB]" />
            <p className="text-sm text-[#6B7280]">
              {unreadOnly ? "No unread notifications." : "No notifications yet."}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-[#F1F3F5] dark:divide-[#1E293B]">
            {notifications.map((notif) => {
              const unread = !notif.read;
              const target = notificationTarget(notif, user);
              return (
                <div
                  key={notif.id}
                  className={cn(
                    "flex items-start gap-3 px-5 py-4",
                    unread && "bg-[#F8FBFF] dark:bg-blue-500/5",
                  )}
                >
                  <span
                    className={cn(
                      "mt-2 h-2 w-2 shrink-0 rounded-full",
                      unread ? "bg-[#2563EB]" : "bg-transparent",
                    )}
                  />
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => {
                      if (unread) markRead.mutate({ id: notif.id });
                      if (target) navigate(target);
                    }}
                  >
                    <p
                      className={cn(
                        "text-sm text-[#111827] dark:text-white",
                        unread ? "font-semibold" : "font-medium",
                      )}
                    >
                      {notif.title}
                    </p>
                    <p className="mt-0.5 text-sm text-[#6B7280]">{notif.message}</p>
                    <p className="mt-1 text-[11px] text-[#9CA3AF]">{formatTimeAgo(notif.createdAt)}</p>
                  </button>
                  {unread ? (
                    <button
                      type="button"
                      onClick={() => markRead.mutate({ id: notif.id })}
                      className="shrink-0 rounded-lg px-2 py-1 text-[11px] font-medium text-[#2563EB] hover:bg-[#EEF4FF] dark:hover:bg-blue-500/10"
                    >
                      Mark read
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
