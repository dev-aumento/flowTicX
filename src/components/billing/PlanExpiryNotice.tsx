import { Link } from "react-router";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { isPlatformUser } from "@/lib/platform-admin";

export function PlanExpiryNotice() {
  const { user } = useAuth();
  const enabled = Boolean(user) && !isPlatformUser(user);
  const { data } = trpc.subscription.current.useQuery(undefined, {
    enabled,
    staleTime: 60_000,
  });

  if (!data?.expiryWarning) return null;

  const isAdmin = String(user?.role ?? "").toLowerCase() === "admin";

  return (
    <div className="mb-4 flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 sm:flex-row sm:items-center sm:justify-between">
      <p className="font-medium">{data.expiryWarning}</p>
      {isAdmin ? (
        <Link
          to="/admin/pricing"
          className="inline-flex h-9 shrink-0 items-center justify-center rounded-lg bg-[#2563EB] px-4 text-sm font-semibold text-white hover:bg-[#1D4ED8]"
        >
          Upgrade plan
        </Link>
      ) : (
        <a
          href="https://aaso.tech/pricing/"
          className="inline-flex h-9 shrink-0 items-center justify-center rounded-lg bg-[#2563EB] px-4 text-sm font-semibold text-white hover:bg-[#1D4ED8]"
        >
          Upgrade plan
        </a>
      )}
    </div>
  );
}
