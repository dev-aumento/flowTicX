export const Session = {
  cookieName: "app_sid",
  maxAgeMs: 30 * 24 * 60 * 60 * 1000,
} as const;

export const ErrorMessages = {
  unauthenticated: "Authentication required",
  insufficientRole: "Insufficient permissions",
} as const;

export const Paths = {
  login: "/login",
  invite: "/invite",
} as const;

export const Workspace = {
  name: "Aaso",
  tagline: "Your work. Your pace.",
} as const;

export const Invite = {
  expiryDays: 7,
  tokenLength: 21,
} as const;
