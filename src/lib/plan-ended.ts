export const PLAN_ENDED_TAG = "[PLAN_ENDED]";
export const PLAN_CANCELLED_TAG = "[PLAN_CANCELLED]";
const PLAN_ENDED_NOTICE_KEY = "tracker.planEnded";

export function isPlanEndedMessage(message?: string | null) {
  const value = String(message ?? "");
  return value.includes(PLAN_ENDED_TAG) || value.includes(PLAN_CANCELLED_TAG);
}

export function displayPlanEndedMessage(message?: string | null) {
  return String(message ?? "")
    .replace(`${PLAN_ENDED_TAG} `, "")
    .replace(`${PLAN_CANCELLED_TAG} `, "")
    .trim();
}

export function writePlanEndedNotice(message?: string | null) {
  try {
    sessionStorage.setItem(
      PLAN_ENDED_NOTICE_KEY,
      displayPlanEndedMessage(message) ||
        "Your Aaso plan or trial has ended. Purchase a plan to sign in again.",
    );
  } catch {
    // ignore
  }
}

export function readPlanEndedNotice() {
  try {
    return sessionStorage.getItem(PLAN_ENDED_NOTICE_KEY);
  } catch {
    return null;
  }
}

export function clearPlanEndedNotice() {
  try {
    sessionStorage.removeItem(PLAN_ENDED_NOTICE_KEY);
  } catch {
    // ignore
  }
}
