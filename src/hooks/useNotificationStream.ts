import { useEffect } from "react";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import {
  registerNotificationStreamInvalidator,
  subscribeNotificationStream,
  type StreamNotification,
} from "@/lib/notification-stream-client";
import { invalidateQueriesForNotifications } from "@/lib/invalidate-on-notifications";

export type { StreamNotification };

export const notificationListQueryOptions = {
  staleTime: 60_000,
  // SSE invalidates the list; keep a slow fallback poll if the stream drops.
  refetchInterval: 60_000,
  refetchIntervalInBackground: false,
  refetchOnWindowFocus: false,
} as const;

function useNotificationInvalidation() {
  const { user } = useAuth();
  const utils = trpc.useUtils();

  useEffect(() => {
    if (!user) return;

    return registerNotificationStreamInvalidator((notifications) => {
      invalidateQueriesForNotifications(utils, notifications);
    });
  }, [user, utils]);
}

export function useNotificationStream(
  onNewNotifications?: (notifications: StreamNotification[]) => void,
) {
  useNotificationInvalidation();

  useEffect(() => {
    if (!onNewNotifications) return;
    return subscribeNotificationStream(onNewNotifications);
  }, [onNewNotifications]);
}

export function useNotificationStreamInvalidation() {
  useNotificationInvalidation();
}
