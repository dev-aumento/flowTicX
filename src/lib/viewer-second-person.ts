/** Second-person copy when the logged-in user is the subject of an alert. */

export type ViewerIdentity = {
  id?: number | null;
  name?: string | null;
  email?: string | null;
};

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function viewerLabels(viewer: ViewerIdentity | null | undefined): string[] {
  if (!viewer) return [];
  const labels: string[] = [];
  const name = viewer.name?.trim();
  const email = viewer.email?.trim();
  if (name) labels.push(name);
  if (email) labels.push(email);
  if (viewer.id != null && Number.isFinite(Number(viewer.id))) {
    labels.push(`User #${viewer.id}`);
  }
  return [...new Set(labels)].sort((a, b) => b.length - a.length);
}

export function isViewerDisplayName(
  label: string | null | undefined,
  viewer: ViewerIdentity | null | undefined,
): boolean {
  const value = label?.trim();
  if (!value) return false;
  if (value.toLowerCase() === "unassigned") return false;
  const lower = value.toLowerCase();
  return viewerLabels(viewer).some((item) => item.toLowerCase() === lower);
}

export function youOrDisplayName(
  label: string,
  viewer: ViewerIdentity | null | undefined,
): string {
  return isViewerDisplayName(label, viewer) ? "you" : label;
}

export function personalizeSecondPersonText(
  text: string,
  viewer: ViewerIdentity | null | undefined,
): string {
  if (!text) return text;
  let next = text;
  for (const label of viewerLabels(viewer)) {
    const escaped = escapeRegExp(label);
    next = next.replace(new RegExp(`\\bmentioned ${escaped}\\b`, "gi"), "mentioned you");
    next = next.replace(new RegExp(`\\bassigned ${escaped}\\b`, "gi"), "assigned you");
    next = next.replace(new RegExp(`\\badded ${escaped}\\b`, "gi"), "added you");
    next = next.replace(new RegExp(`\\bremoved ${escaped}\\b`, "gi"), "removed you");
    next = next.replace(new RegExp(`\\bto ${escaped}\\b`, "gi"), "to you");
  }
  return next;
}

export function personalizeNotificationCopy<
  T extends { type?: string | null; title?: string | null; message?: string | null },
>(notification: T, viewer: ViewerIdentity | null | undefined): T {
  const message = personalizeSecondPersonText(notification.message ?? "", viewer);
  const type = String(notification.type ?? "");
  let title = notification.title ?? "";
  if (
    type === "task_assigned" &&
    (/\bto you\b/i.test(message) || /\bassigned you\b/i.test(message))
  ) {
    title = "Assigned to you";
  } else if (type === "mention" && /\bmentioned you\b/i.test(message)) {
    title = "You were mentioned in a comment";
  } else {
    title = personalizeSecondPersonText(title, viewer);
  }
  return { ...notification, title, message };
}
