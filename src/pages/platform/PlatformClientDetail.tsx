import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ArrowLeft, CalendarDays, Check, ChevronDown, CreditCard, Loader2, ShieldAlert, Trash2, Users } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/providers/trpc";
import {
  addPlanDuration,
  formatInr,
  formatPlanDate,
  formatPlanDuration,
  formatUsd,
  planChoiceLabel,
  planLabel,
} from "@/lib/platform-admin";
import { planChecklist, teamMemberLabel } from "@/lib/plan-entitlements";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const STATUS_OPTIONS = [
  { value: "trial", label: "Trial" },
  { value: "paid", label: "Paid" },
  { value: "unpaid", label: "Unpaid" },
  { value: "cancelled", label: "Cancelled" },
] as const;

const selectTriggerClass = cn(
  "h-11 w-full rounded-xl border border-[#E6E8EC] bg-[#F8FAFC] px-3 text-sm font-medium text-[#111827]",
  "shadow-none hover:bg-white hover:border-[#D1D5DB]",
  "focus-visible:border-[#2563EB] focus-visible:ring-2 focus-visible:ring-[#2563EB]/20",
  "dark:border-[#334155] dark:bg-[#1E293B] dark:text-white dark:hover:bg-[#1E293B]",
);

function FieldSelect({
  value,
  options,
  onChange,
  placeholder = "Select",
}: {
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const items = options.some((option) => option.value === value)
    ? options
    : value
      ? [{ value, label: value }, ...options]
      : options;
  const selectedLabel = items.find((option) => option.value === value)?.label ?? "";

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(selectTriggerClass, "inline-flex items-center justify-between gap-2")}
        >
          <span className="min-w-0 flex-1 truncate text-left">{selectedLabel || placeholder}</span>
          <ChevronDown size={16} className="shrink-0 opacity-50" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        collisionPadding={16}
        className="min-w-[var(--radix-dropdown-menu-trigger-width)] rounded-xl border border-[#E6E8EC] bg-white p-1 text-[#111827] shadow-lg dark:border-[#334155] dark:bg-[#0F172A] dark:text-slate-100"
      >
        {items.map((option) => {
          const isSelected = option.value === value;
          return (
            <DropdownMenuItem
              key={option.value}
              onClick={() => onChange(option.value)}
              className={cn(
                "flex cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm",
                isSelected
                  ? "bg-[#EEF4FF] font-medium text-[#2563EB] focus:bg-[#EEF4FF] focus:text-[#2563EB]"
                  : "text-[#111827] dark:text-slate-100",
              )}
            >
              <span className="truncate">{option.label}</span>
              {isSelected ? <Check size={14} className="shrink-0 text-[#2563EB]" /> : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
        status === "paid" && "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
        status === "unpaid" && "bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-300",
        status === "cancelled" && "bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-300",
        status !== "paid" && status !== "unpaid" && status !== "cancelled" && "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
      )}
    >
      {status}
    </span>
  );
}

export default function PlatformClientDetail() {
  const { organizationId, userId } = useParams();
  const navigate = useNavigate();
  const invitedId = Number(userId);
  const isInvited = Number.isInteger(invitedId) && invitedId > 0;
  const clientsListHref = isInvited ? "/platform/clients?tab=invited" : "/platform/clients";
  const utils = trpc.useUtils();
  const invitedQuery = trpc.platform.getInvitedClient.useQuery(
    { userId: invitedId },
    { enabled: isInvited },
  );
  const orgId = isInvited ? (invitedQuery.data?.organizationId ?? 0) : Number(organizationId);
  const { data, isLoading, error } = trpc.platform.getClient.useQuery(
    { organizationId: orgId },
    { enabled: Number.isInteger(orgId) && orgId > 0 },
  );
  const { data: catalog } = trpc.platform.plans.useQuery();

  const [plan, setPlan] = useState<string | null>(null);
  const [planStatus, setPlanStatus] = useState<string | null>(null);
  const [amount, setAmount] = useState("0");
  const [notes, setNotes] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!data) return;
    setPlan(data.plan);
    const status = String(data.planStatus ?? "").toLowerCase();
    setPlanStatus(
      STATUS_OPTIONS.some((option) => option.value === status) ? status : "trial",
    );
    setAmount(String(data.subscriptionAmount ?? 0));
    setNotes(data.planNotes ?? "");
    setCancelReason(data.planCancelReason ?? "");
  }, [data]);

  const update = trpc.platform.updateSubscription.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.platform.getClient.invalidate({ organizationId: orgId }),
        utils.platform.listClients.invalidate(),
        utils.platform.overview.invalidate(),
      ]);
      toast.success("Plan details saved");
    },
    onError: (err) => toast.error(err.message),
  });

  const cancel = trpc.platform.cancelPlan.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.platform.getClient.invalidate({ organizationId: orgId }),
        utils.platform.listClients.invalidate(),
        utils.platform.overview.invalidate(),
      ]);
      toast.success("Plan cancelled");
    },
    onError: (err) => toast.error(err.message),
  });

  const remove = trpc.platform.deleteClient.useMutation({
    onSuccess: async (result) => {
      setConfirmDelete(false);
      await Promise.all([
        utils.platform.listClients.invalidate(),
        utils.platform.overview.invalidate(),
      ]);
      toast.success(`${result.name} was deleted`);
      navigate("/platform/clients", { replace: true });
    },
    onError: (err) => toast.error(err.message),
  });

  const selectedPlanSlug = plan ?? data?.plan ?? "";
  const selectedPlanStatus = planStatus ?? data?.planStatus ?? "trial";
  const selectedPlan =
    (catalog ?? []).find((item) => item.slug === selectedPlanSlug) ?? data?.assignedPlan ?? null;

  const planOptions = useMemo(() => {
    const items = (catalog ?? []).map((item) => ({ value: item.slug, label: planChoiceLabel(item) }));
    const current = data?.plan;
    if (current && !items.some((item) => item.value === current)) {
      items.unshift({
        value: current,
        label: data.assignedPlan?.name || data.planName || planLabel(current, catalog),
      });
    }
    return items;
  }, [catalog, data]);

  const planStartDate = useMemo(() => {
    const raw = data?.planStartsAt ?? data?.purchasedAt ?? data?.createdAt;
    if (!raw) return new Date();
    return raw instanceof Date ? raw : new Date(raw);
  }, [data]);

  const computedExpiry = useMemo(
    () => addPlanDuration(planStartDate, selectedPlanSlug, selectedPlan?.durationDays),
    [planStartDate, selectedPlanSlug, selectedPlan?.durationDays],
  );

  const durationLabel = formatPlanDuration(selectedPlan?.durationDays ?? 0);

  function savePlan(event: FormEvent) {
    event.preventDefault();
    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount < 0) {
      toast.error("Enter a valid amount");
      return;
    }
    update.mutate({
      organizationId: orgId,
      plan: selectedPlanSlug,
      planStatus: selectedPlanStatus as "trial" | "paid" | "unpaid" | "cancelled",
      subscriptionAmount: parsedAmount,
      planNotes: notes.trim() || null,
    });
  }

  function applyPlanChange(nextPlan: string) {
    setPlan(nextPlan);
    const next = (catalog ?? []).find((item) => item.slug === nextPlan);
    if (next) setAmount(String(next.amount));
  }

  const backLabel = isInvited ? "Invited clients" : "Subscribed Clients";

  if (isInvited && invitedQuery.isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-[#6B7280]">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Loading client...
      </div>
    );
  }

  if (isInvited && (invitedQuery.error || !invitedQuery.data)) {
    return (
      <div className="space-y-4">
        <Link to={clientsListHref} className="inline-flex items-center gap-1 text-sm text-[#2563EB] hover:underline">
          <ArrowLeft size={14} />
          Back to invited clients
        </Link>
        <p className="text-sm text-red-600">{invitedQuery.error?.message || "Invited client not found."}</p>
      </div>
    );
  }

  if (!Number.isInteger(orgId) || orgId <= 0) {
    return <p className="text-sm text-[#6B7280]">Customer not found.</p>;
  }

  if (isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-[#6B7280]">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Loading client...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-4">
        <Link to={clientsListHref} className="inline-flex items-center gap-1 text-sm text-[#2563EB] hover:underline">
          <ArrowLeft size={14} />
          Back to clients
        </Link>
        <p className="text-sm text-red-600">{error?.message || "Customer not found."}</p>
      </div>
    );
  }

  const cancelled = data.planStatus === "cancelled";
  const busy = update.isPending || cancel.isPending || remove.isPending;
  const invitedPerson = isInvited ? invitedQuery.data : null;
  const displayName = invitedPerson?.name || data.ownerName;
  const displayEmail = invitedPerson?.email || data.ownerEmail;

  return (
    <div className="space-y-5">
      <Link
        to={clientsListHref}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-[#6B7280] hover:text-[#2563EB]"
      >
        <ArrowLeft size={15} />
        {backLabel}
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#EEF4FF] text-lg font-bold text-[#2563EB]">
            {(displayName[0] ?? "C").toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-[#111827] sm:text-[28px] dark:text-white">
                {displayName}
              </h1>
              <StatusBadge status={data.planStatus} />
            </div>
            <p className="mt-1 text-sm text-[#6B7280]">
              {displayEmail || "No email"} · {data.name} ·{" "}
              {isInvited
                ? `Invited into ${invitedPerson?.organizationName || data.name}`
                : data.workspaceType === "client"
                  ? "Client portal"
                  : "Staff CRM"}
            </p>
          </div>
        </div>
      </div>

      {cancelled ? (
        <div className="flex items-start gap-3 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-200">
          <ShieldAlert size={18} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold">This plan is cancelled</p>
            <p className="mt-0.5 text-red-600/80 dark:text-red-200/80">
              {data.planCancelReason || "No reason recorded."}{" "}
              {data.planCancelledAt ? `· ${formatPlanDate(data.planCancelledAt)}` : null}
            </p>
          </div>
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.8fr)]">
        <form
          onSubmit={savePlan}
          className="space-y-5 rounded-2xl border border-[#E6E8EC] bg-white p-6 shadow-sm dark:border-[#1E293B] dark:bg-[#0F172A]"
        >
          <div>
            <h2 className="text-base font-semibold text-[#111827] dark:text-white">Plan details</h2>
            <p className="mt-1 text-sm text-[#6B7280]">
              Update the subscription and payment status. Start and expiry dates follow the plan duration.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Plan</Label>
              <FieldSelect
                value={selectedPlanSlug}
                options={planOptions}
                placeholder="Select plan"
                onChange={applyPlanChange}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Payment status</Label>
              <FieldSelect
                value={selectedPlanStatus}
                options={STATUS_OPTIONS}
                placeholder="Select status"
                onChange={setPlanStatus}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="plan-amount">Amount (INR)</Label>
              <Input
                id="plan-amount"
                type="number"
                min={0}
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                className="h-11 rounded-xl"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Catalog price</Label>
              <p className="flex h-11 items-center rounded-xl border border-dashed border-[#E6E8EC] px-3 text-sm text-[#6B7280] dark:border-[#334155]">
                {formatInr(selectedPlan?.amount ?? 0)}
                {selectedPlan ? ` · ${formatUsd(selectedPlan.amountUsd ?? 0)}` : ""}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Plan start date</Label>
              <p className="flex h-11 items-center rounded-xl border border-dashed border-[#E6E8EC] px-3 text-sm font-medium text-[#111827] dark:border-[#334155] dark:text-white">
                {formatPlanDate(planStartDate)}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Plan expiry date</Label>
              <p className="flex h-11 items-center rounded-xl border border-dashed border-[#E6E8EC] px-3 text-sm font-medium text-[#111827] dark:border-[#334155] dark:text-white">
                {formatPlanDate(computedExpiry)}
              </p>
              <p className="text-xs text-[#6B7280]">
                {durationLabel !== "—"
                  ? `Fixed at ${durationLabel} from the start date.`
                  : "Fixed from the selected plan duration."}
              </p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="plan-notes">Internal notes</Label>
            <textarea
              id="plan-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={4}
              className="w-full rounded-xl border border-[#E6E8EC] bg-[#F8FAFC] px-3 py-2 text-sm outline-none focus:border-[#2563EB] focus:ring-[3px] focus:ring-[#2563EB]/20 dark:border-[#334155] dark:bg-[#1E293B] dark:text-white"
            />
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              disabled={busy}
              className="inline-flex h-11 items-center rounded-xl bg-[#2563EB] px-5 text-sm font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-60"
            >
              {update.isPending ? "Saving..." : "Update plan"}
            </button>
            {cancelled ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  const nextStatus = selectedPlanSlug === "trial" ? "trial" : "paid";
                  setPlanStatus(nextStatus);
                  update.mutate({
                    organizationId: orgId,
                    plan: selectedPlanSlug,
                    planStatus: nextStatus,
                    subscriptionAmount: Number(amount) || 0,
                    planNotes: notes.trim() || null,
                  });
                }}
                className="inline-flex h-11 items-center rounded-xl border border-[#E6E8EC] px-5 text-sm font-semibold text-[#111827] hover:bg-[#F8FAFC] disabled:opacity-60 dark:border-[#334155] dark:text-white"
              >
                Reactivate plan
              </button>
            ) : null}
          </div>
        </form>

        <div className="space-y-5">
          <section className="rounded-2xl border border-[#E6E8EC] bg-white p-5 shadow-sm dark:border-[#1E293B] dark:bg-[#0F172A]">
            <div className="mb-4 flex items-center gap-2 text-[#2563EB]">
              <CreditCard size={16} />
              <h2 className="text-sm font-semibold uppercase tracking-wide text-[#6B7280]">Summary</h2>
            </div>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-[#6B7280]">Current plan</dt>
                <dd className="font-semibold">{data.planName || planLabel(data.plan, catalog)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[#6B7280]">Amount</dt>
                <dd className="font-semibold">
                  {data.introEnterprise ? "Complimentary" : formatInr(data.subscriptionAmount)}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[#6B7280]">Starts</dt>
                <dd className="font-semibold">{formatPlanDate(planStartDate)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[#6B7280]">Expires</dt>
                <dd className="font-semibold">{formatPlanDate(computedExpiry)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[#6B7280]">Purchased</dt>
                <dd className="font-semibold">{formatPlanDate(data.purchasedAt)}</dd>
              </div>
              {selectedPlan ? (
                <div className="border-t border-[#F1F3F5] pt-3 dark:border-[#1E293B]">
                  <dt className="mb-2 text-[#6B7280]">Included in this plan</dt>
                  <dd>
                    <p className="mb-2 font-medium">{teamMemberLabel(selectedPlan.limits.teamMembers)}</p>
                    <ul className="space-y-1.5">
                      {planChecklist(selectedPlan).map((line) => (
                        <li key={line} className="flex items-start gap-2 font-medium">
                          <Check size={14} className="mt-0.5 shrink-0 text-[#2563EB]" />
                          {line}
                        </li>
                      ))}
                    </ul>
                  </dd>
                </div>
              ) : null}
              <div className="flex items-center justify-between gap-3">
                <dt className="inline-flex items-center gap-1.5 text-[#6B7280]">
                  <Users size={14} /> Members
                </dt>
                <dd className="font-semibold">{data.memberCount}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="inline-flex items-center gap-1.5 text-[#6B7280]">
                  <CalendarDays size={14} /> Workspace created
                </dt>
                <dd className="font-semibold">{formatPlanDate(data.createdAt)}</dd>
              </div>
            </dl>
          </section>

          <section className="rounded-2xl border border-[#E6E8EC] bg-white p-5 shadow-sm dark:border-[#1E293B] dark:bg-[#0F172A]">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-[#6B7280]">Cancel plan</h2>
            <p className="mt-1 text-sm text-[#6B7280]">
              Ends the current subscription. The workspace stays in the customer list as cancelled.
            </p>
            <textarea
              value={cancelReason}
              onChange={(event) => setCancelReason(event.target.value)}
              placeholder="Reason (optional)"
              rows={3}
              disabled={cancelled}
              className="mt-3 w-full rounded-xl border border-[#E6E8EC] bg-[#F8FAFC] px-3 py-2 text-sm outline-none focus:border-[#2563EB] focus:ring-[3px] focus:ring-[#2563EB]/20 disabled:opacity-60 dark:border-[#334155] dark:bg-[#1E293B] dark:text-white"
            />
            <button
              type="button"
              disabled={busy || cancelled}
              onClick={() => {
                if (!window.confirm(`Cancel ${planLabel(data.plan)} for ${data.name}?`)) return;
                cancel.mutate({ organizationId: orgId, reason: cancelReason.trim() || undefined });
              }}
              className="mt-3 inline-flex h-10 items-center rounded-xl bg-red-600 px-4 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
            >
              {cancel.isPending ? "Cancelling..." : "Cancel plan"}
            </button>
          </section>

          {!isInvited ? (
          <section className="rounded-2xl border border-red-100 bg-white p-5 shadow-sm dark:border-red-500/20 dark:bg-[#0F172A]">
            <h2 className="inline-flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-red-600 dark:text-red-300">
              <Trash2 size={14} />
              Delete client
            </h2>
            <p className="mt-1 text-sm text-[#6B7280]">
              Permanently remove this workspace and all of its members. They will not be able to sign
              in afterwards.
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirmDelete(true)}
              className="mt-3 inline-flex h-10 items-center rounded-xl border border-red-200 px-4 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-500/30 dark:text-red-300 dark:hover:bg-red-500/10"
            >
              Delete {data.name}
            </button>
          </section>
          ) : null}
        </div>
      </div>

      {data.members.length > 0 ? (
        <section className="rounded-2xl border border-[#E6E8EC] bg-white p-5 shadow-sm dark:border-[#1E293B] dark:bg-[#0F172A]">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[#6B7280]">Members</h2>
          <div className="divide-y divide-[#F1F3F5] dark:divide-[#1E293B]">
            {data.members.map((member) => {
              const isFocused = invitedPerson?.id === member.id;
              return (
              <div key={member.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate font-medium">{member.name || member.email || "Member"}</p>
                  <p className="truncate text-xs text-[#6B7280]">{member.email}</p>
                </div>
                <span className="text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">
                  {isFocused ? "Invited client" : member.role}
                </span>
              </div>
              );
            })}
          </div>
        </section>
      ) : null}

      <AlertDialog
        open={confirmDelete}
        onOpenChange={(open) => {
          if (!remove.isPending) setConfirmDelete(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {data.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the customer workspace, its members, and their data. They will
              no longer be able to sign in. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>Keep client</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
              disabled={remove.isPending}
              onClick={(event) => {
                event.preventDefault();
                remove.mutate({ organizationId: orgId });
              }}
            >
              {remove.isPending ? "Deleting…" : "Delete client"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
