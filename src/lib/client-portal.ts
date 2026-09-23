export type ClientPortalUser = {
  role?: string | null;
  clientWorkspace?: boolean | null;
};

export function isClientPortalUser(user: ClientPortalUser | null | undefined) {
  if (!user) return false;
  const role = String(user.role ?? "").toLowerCase();
  if (role === "finance" || role === "platform") return false;
  if (role === "client") return true;
  return user.clientWorkspace === true;
}
