import { Link } from "react-router";
import { ShieldAlert } from "lucide-react";
import { OrgAuthShell } from "@/components/auth/OrgAuthShell";
import { clearPlanEndedNotice, readPlanEndedNotice } from "@/lib/plan-ended";

export default function PlanEnded() {
  const message =
    readPlanEndedNotice() ||
    "Your Aaso plan or trial has ended. Purchase a plan to sign in again.";

  return (
    <OrgAuthShell organizationLabel="Aaso">
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-50 text-amber-600">
          <ShieldAlert size={22} />
        </div>
        <h1 className="text-xl font-bold text-gray-900">Plan ended</h1>
        <p className="mt-2 text-sm text-gray-500 leading-relaxed">{message}</p>
        <p className="mt-3 text-sm text-gray-500">
          Ask your Aaso administrator to renew or purchase a plan, then sign in again.
        </p>
        <Link
          to="/login"
          onClick={() => clearPlanEndedNotice()}
          className="mt-6 inline-flex h-11 w-full items-center justify-center rounded-lg bg-[#2563EB] text-sm font-semibold text-white hover:bg-[#1D4ED8]"
        >
          Back to sign in
        </Link>
      </div>
    </OrgAuthShell>
  );
}
