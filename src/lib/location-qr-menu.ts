/**
 * When false, Location and QR Code stay in the codebase but are hidden from
 * HR/admin menus (`display: none`). Set to true to show them again.
 */
export const SHOW_LOCATION_QR_MENU = false;

export function isLocationQrMenuPath(path: string) {
  return path === "/locations" || path === "/qr-code" || path.startsWith("/locations/") || path.startsWith("/qr-code/");
}
