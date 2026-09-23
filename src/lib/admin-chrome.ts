import { isAdminOrManagement } from "@/lib/leave-policy";

/** Dark Aaso shell used for admin / manager screens. */
export function isAdminChromeUser(
  user: { role?: string | null; department?: string | null } | null | undefined,
) {
  return isAdminOrManagement(user);
}

export const ADMIN_PAGE_BG = "#0B0E14";
export const ADMIN_CARD_BG = "#12161E";
export const ADMIN_CARD_BORDER = "#1C2330";
