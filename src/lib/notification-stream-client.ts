import { apiUrl } from "@/lib/api-base";

export type StreamNotification = {
  id: number;
  title: string;
  message: string;
  read: boolean | null;
  createdAt: Date | string;
  type?: string;
  taskId?: number | null;
  projectId?: number | null;
  activityId?: number | null;
  leaveRequestId?: number | null;
  relatedOrganizationId?: number | null;
  invoiceId?: number | null;
  link?: string | null;
};

type StreamPayload =
  | { type: "connected"; lastId: number }
  | { type: "ping" }
  | { type: "notifications"; notifications: StreamNotification[] };

type InvalidateFn = (notifications: StreamNotification[]) => void;

let eventSource: EventSource | null = null;
let subscriberCount = 0;
const listeners = new Set<(notifications: StreamNotification[]) => void>();
const invalidators = new Set<InvalidateFn>();

function runInvalidators(notifications: StreamNotification[]) {
  for (const fn of invalidators) {
    fn(notifications);
  }
}

function handleMessage(event: MessageEvent<string>) {
  try {
    const payload = JSON.parse(event.data) as StreamPayload;
    if (payload.type !== "notifications" || payload.notifications.length === 0) {
      return;
    }

    runInvalidators(payload.notifications);
    for (const listener of listeners) {
      listener(payload.notifications);
    }
  } catch {
    // Ignore malformed SSE payloads.
  }
}

function ensureEventSource() {
  if (eventSource) return;
  const base = apiUrl("/api/notifications/stream");
  eventSource = new EventSource(base, {
    withCredentials: true,
  } as EventSourceInit);
  eventSource.onmessage = handleMessage;
  eventSource.onerror = () => {
    // EventSource reconnects automatically.
  };
}

function closeEventSourceIfIdle() {
  if (subscriberCount === 0 && invalidators.size === 0 && eventSource) {
    eventSource.close();
    eventSource = null;
  }
}

export function registerNotificationStreamInvalidator(fn: InvalidateFn) {
  invalidators.add(fn);
  ensureEventSource();

  return () => {
    invalidators.delete(fn);
    closeEventSourceIfIdle();
  };
}

export function subscribeNotificationStream(
  listener: (notifications: StreamNotification[]) => void,
) {
  subscriberCount += 1;
  listeners.add(listener);
  ensureEventSource();

  return () => {
    listeners.delete(listener);
    subscriberCount -= 1;
    closeEventSourceIfIdle();
  };
}
