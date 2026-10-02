const DAY_MS = 24 * 60 * 60 * 1000;

export function isFreeTierPlan(plan: string | null | undefined) {
  const slug = (plan ?? "trial").trim().toLowerCase();
  return slug === "trial" || slug === "free" || slug.startsWith("free-");
}

export function endOfPlanDay(value: Date) {
  const date = new Date(value);
  date.setHours(23, 59, 59, 999);
  return date;
}

/** Whole days left until the end of the expiry date. 0 means it has already ended. */
export function planDaysRemaining(expiresAt: Date, now = new Date()) {
  const ms = endOfPlanDay(expiresAt).getTime() - now.getTime();
  if (ms < 0) return 0;
  return Math.ceil(ms / DAY_MS);
}

export function planExpiryWarning(days: number | null | undefined) {
  if (days == null || days < 1 || days > 7) return null;
  const time = days === 1 ? "1 day" : `${days} days`;
  return `Your plan will be expired in ${time}. Upgrade your plan to continue use aaso`;
}
