import { AsyncLocalStorage } from "node:async_hooks";

const requestOrigin = new AsyncLocalStorage<string>();
let lastPublicOrigin = "";

function originFromRequest(req: Request) {
  const forwardedHost = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || req.headers.get("host")?.trim() || "";
  if (host) {
    const forwardedProto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
    const proto =
      forwardedProto ||
      (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
    return `${proto}://${host}`.replace(/\/$/, "");
  }
  try {
    return new URL(req.url).origin;
  } catch {
    return "";
  }
}

/** Remember the site address for emails sent during this request, including later overdue alerts. */
export function runWithRequestOrigin<T>(req: Request, fn: () => T) {
  const origin = originFromRequest(req);
  if (!origin) return fn();
  lastPublicOrigin = origin;
  return requestOrigin.run(origin, fn);
}

export function publicAppOrigin() {
  const configured = process.env.APP_PUBLIC_URL?.trim().replace(/\/$/, "") ?? "";
  return configured || requestOrigin.getStore() || lastPublicOrigin;
}
