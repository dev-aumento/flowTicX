import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { Check, ChevronDown, ChevronRight, Loader2, Trash2 } from "lucide-react";
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
import { trpc } from "@/providers/trpc";
import { formatInr, planLabel } from "@/lib/platform-admin";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const CLIENT_TABS = [
  { id: "clients", label: "Clients" },
  { id: "invited", label: "Invited clients" },
] as const;

type ClientsTab = (typeof CLIENT_TABS)[number]["id"];

function parseClientsTab(raw: string | null): ClientsTab {
  return raw === "invited" ? "invited" : "clients";
}

const STATUS_OPTIONS = [
  { value: "trial", label: "Trial" },
  { value: "paid", label: "Paid" },
  { value: "unpaid", label: "Unpaid" },
  { value: "cancelled", label: "Cancelled" },
] as const;

function FieldSelect({
  value,
  disabled,
  options,
  onChange,
  ariaLabel,
}: {
  value: string;
  disabled?: boolean;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
  ariaLabel: string;
}) {
  const selectedLabel = options.find((option) => option.value === value)?.label ?? value;

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          type="button"
          aria-label={ariaLabel}
          disabled={disabled}
          className={cn(
            "inline-flex h-10 w-full min-w-0 max-w-full items-center justify-between gap-2 rounded-xl border border-[#E6E8EC] bg-[#F8FAFC] px-3 text-sm font-medium text-[#111827]",
            "shadow-none hover:bg-white hover:border-[#D1D5DB]",
            "focus-visible:border-[#2563EB] focus-visible:ring-2 focus-visible:ring-[#2563EB]/20",
            "disabled:cursor-not-allowed disabled:opacity-50",
            "dark:border-[#334155] dark:bg-[#1E293B] dark:text-white dark:hover:bg-[#1E293B]",
          )}
        >
          <span className="min-w-0 flex-1 truncate text-left">{selectedLabel}</span>
          <ChevronDown size={14} className="shrink-0 opacity-50" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        collisionPadding={16}
        className="max-w-[calc(100vw-2rem)] min-w-[min(100%,var(--radix-dropdown-menu-trigger-width))] rounded-xl border border-[#E6E8EC] bg-white p-1 text-[#111827] shadow-lg dark:border-[#334155] dark:bg-[#0F172A] dark:text-slate-100"
      >
        {options.map((option) => {
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

function formatPurchaseDate(value: Date | string | null | undefined) {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function StatusBadge({ status }: { status: string }) {
  const paid = status === "paid";
  const unpaid = status === "unpaid";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
        paid && "bg-emerald-50 text-emerald-700",
        unpaid && "bg-red-50 text-red-600",
        status === "cancelled" && "bg-gray-100 text-gray-600",
        !paid && !unpaid && status !== "cancelled" && "bg-amber-50 text-amber-700",
      )}
    >
      {status}
    </span>
  );
}

export default function PlatformClients() {
  const [searchParams, setSearchParams] = useSearchParams();
  const search = searchParams.get("q") ?? "";
  const activeTab = parseClientsTab(searchParams.get("tab"));
  const utils = trpc.useUtils();
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; name: string } | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const { data: catalog } = trpc.platform.plans.useQuery();
  const { data, isLoading } = trpc.platform.listClients.useQuery({ search });
  const { data: invitedClients, isLoading: invitedLoading } =
    trpc.platform.listInvitedClients.useQuery({ search });

  const clientRows = data ?? [];
  const invitedRows = invitedClients ?? [];
  const tabCounts = {
    clients: clientRows.length,
    invited: invitedRows.length,
  };

  function setActiveTab(next: ClientsTab) {
    setExpandedId(null);
    const params = new URLSearchParams(searchParams);
    if (next === "clients") params.delete("tab");
    else params.set("tab", "invited");
    setSearchParams(params, { replace: true });
  }
  const update = trpc.platform.updateSubscription.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.platform.listClients.invalidate(),
        utils.platform.listInvitedClients.invalidate(),
        utils.platform.overview.invalidate(),
      ]);
      toast.success("Subscription updated");
    },
    onError: (error) => toast.error(error.message),
  });
  const remove = trpc.platform.deleteClient.useMutation({
    onSuccess: async (result) => {
      setDeleteTarget(null);
      await Promise.all([
        utils.platform.listClients.invalidate(),
        utils.platform.listInvitedClients.invalidate(),
        utils.platform.overview.invalidate(),
      ]);
      toast.success(`${result.name} was deleted`);
    },
    onError: (error) => toast.error(error.message),
  });

  const planOptions = (catalog ?? []).map((plan) => ({
    value: plan.slug,
    label: plan.name,
  }));

  return (
    <div className="min-w-0 max-w-full space-y-5 overflow-x-hidden">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight text-[#111827] sm:text-[28px] dark:text-white">
          Subscribed Clients
        </h1>
        <p className="mt-1 text-sm text-[#6B7280]">
          Every customer workspace that purchased or signed up for Aaso.
        </p>
        <div
          className="mt-4 flex min-w-0 flex-wrap items-center gap-1 border-b border-[#E6E8EC] dark:border-[#1E293B]"
          role="tablist"
          aria-label="Client lists"
        >
          {CLIENT_TABS.map((tab) => {
            const selected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "-mb-px inline-flex min-w-0 items-center gap-2 border-b-2 px-2.5 pb-2.5 text-[13px] font-semibold transition-colors sm:px-3 sm:text-sm",
                  selected
                    ? "border-[#2563EB] text-[#2563EB]"
                    : "border-transparent text-[#6B7280] hover:text-[#111827] dark:hover:text-white",
                )}
              >
                {tab.label}
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0.5 text-[11px] font-semibold",
                    selected ? "bg-[#EEF4FF] text-[#2563EB]" : "bg-[#F3F4F6] text-[#9CA3AF] dark:bg-white/10",
                  )}
                >
                  {tabCounts[tab.id]}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <section className="min-w-0 overflow-hidden rounded-2xl border border-[#E6E8EC] bg-white shadow-sm dark:border-[#1E293B] dark:bg-[#0F172A]">
        {activeTab === "clients" ? (
          isLoading ? (
            <div className="flex items-center justify-center py-16 text-[#6B7280]">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Loading customers...
            </div>
          ) : clientRows.length === 0 ? (
            <p className="px-4 py-16 text-center text-sm text-[#6B7280]">
              {search ? "No clients match that search." : "No client workspaces yet."}
            </p>
          ) : (
            <div className="min-w-0">
              <div className="hidden items-center gap-3 border-b border-[#EEF0F3] px-5 py-3 lg:grid lg:grid-cols-[minmax(0,1.4fr)_minmax(0,168px)_minmax(0,168px)_minmax(0,140px)_44px] dark:border-[#1E293B]">
                <p className="text-[11px] font-semibold tracking-[0.08em] text-[#9CA3AF] uppercase">
                  Client
                </p>
                <p className="text-[11px] font-semibold tracking-[0.08em] text-[#9CA3AF] uppercase">
                  Plan
                </p>
                <p className="text-[11px] font-semibold tracking-[0.08em] text-[#9CA3AF] uppercase">
                  Payment status
                </p>
                <p className="text-right text-[11px] font-semibold tracking-[0.08em] text-[#9CA3AF] uppercase">
                  Amount
                </p>
                <span className="sr-only">Actions</span>
              </div>
              <div className="divide-y divide-[#F1F3F5] dark:divide-[#1E293B]">
                {clientRows.map((row) => {
                  const open = expandedId === row.id;
                  const rowPlanLabel =
                    planOptions.find((option) => option.value === row.plan)?.label ??
                    row.planName ??
                    planLabel(row.plan);
                  const rowPlanOptions = planOptions.some((option) => option.value === row.plan)
                    ? planOptions
                    : [...planOptions, { value: row.plan, label: rowPlanLabel }];
                  return (
                    <div
                      key={row.id}
                      className="grid min-w-0 grid-cols-1 gap-3 px-4 py-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,168px)_minmax(0,168px)_minmax(0,140px)_44px] lg:items-center lg:gap-3 lg:px-5 lg:py-4"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <button
                          type="button"
                          aria-expanded={open}
                          aria-label={`${open ? "Collapse" : "Expand"} ${row.ownerName}`}
                          onClick={() => setExpandedId(open ? null : row.id)}
                          className="flex min-w-0 flex-1 items-center gap-3 rounded-xl text-left lg:hidden"
                        >
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#EEF4FF] text-sm font-bold text-[#2563EB]">
                            {(row.ownerName[0] ?? "C").toUpperCase()}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-semibold text-[#111827] dark:text-white">
                              {row.ownerName}
                            </p>
                            <p className="truncate text-xs text-[#6B7280]">
                              {rowPlanLabel} · {formatInr(row.subscriptionAmount)}
                            </p>
                          </div>
                          <StatusBadge status={row.planStatus} />
                          <ChevronDown
                            size={16}
                            className={cn(
                              "shrink-0 text-[#9CA3AF] transition-transform",
                              open && "rotate-180",
                            )}
                          />
                        </button>
                        <Link
                          to={`/platform/clients/${row.id}`}
                          className="hidden min-w-0 flex-1 items-center gap-3 rounded-xl pr-2 hover:bg-[#F8FAFC] lg:flex dark:hover:bg-white/5"
                        >
                          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#EEF4FF] text-sm font-bold text-[#2563EB]">
                            {(row.ownerName[0] ?? "C").toUpperCase()}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-semibold text-[#111827] dark:text-white">
                              {row.ownerName}
                            </p>
                            <p className="truncate text-xs text-[#6B7280]">
                              {row.ownerEmail || "No email"} · {row.name} ·{" "}
                              {row.workspaceType === "client" ? "Client portal" : "Staff CRM"} ·{" "}
                              {row.memberCount} {row.memberCount === 1 ? "member" : "members"}
                            </p>
                          </div>
                          <ChevronRight size={16} className="ml-auto shrink-0 text-[#D1D5DB]" />
                        </Link>
                      </div>
                      <div className={cn("min-w-0 space-y-3 lg:space-y-0", !open && "hidden lg:block")}>
                        <p className="break-words text-xs text-[#6B7280] lg:hidden">
                          {row.ownerEmail || "No email"} · {row.name} ·{" "}
                          {row.workspaceType === "client" ? "Client portal" : "Staff CRM"} ·{" "}
                          {row.memberCount} {row.memberCount === 1 ? "member" : "members"}
                        </p>
                        <div className="min-w-0">
                          <p className="mb-1.5 text-[11px] font-semibold tracking-[0.08em] text-[#9CA3AF] uppercase lg:hidden">
                            Plan
                          </p>
                          <FieldSelect
                            ariaLabel="Plan"
                            value={row.plan}
                            disabled={update.isPending}
                            options={rowPlanOptions}
                            onChange={(plan) =>
                              update.mutate({
                                organizationId: row.id,
                                plan: plan as typeof row.plan,
                                planStatus: row.planStatus,
                              })
                            }
                          />
                        </div>
                      </div>
                      <div className={cn("min-w-0", !open && "hidden lg:block")}>
                        <p className="mb-1.5 text-[11px] font-semibold tracking-[0.08em] text-[#9CA3AF] uppercase lg:hidden">
                          Payment status
                        </p>
                        <FieldSelect
                          ariaLabel="Payment status"
                          value={row.planStatus}
                          disabled={update.isPending}
                          options={STATUS_OPTIONS}
                          onChange={(planStatus) =>
                            update.mutate({
                              organizationId: row.id,
                              plan: row.plan,
                              planStatus: planStatus as typeof row.planStatus,
                            })
                          }
                        />
                      </div>
                      <div className={cn("min-w-0", !open && "hidden lg:block")}>
                        <p className="mb-1 text-[11px] font-semibold tracking-[0.08em] text-[#9CA3AF] uppercase lg:hidden">
                          Amount
                        </p>
                        <p className="text-sm font-semibold lg:text-right">
                          {formatInr(row.subscriptionAmount)}
                        </p>
                        <div className="mt-1 flex items-center justify-between gap-2 lg:justify-end">
                          <p className="text-[11px] text-[#6B7280]">{formatPurchaseDate(row.purchasedAt)}</p>
                          <span className="hidden lg:inline">
                            <StatusBadge status={row.planStatus} />
                          </span>
                        </div>
                      </div>
                      <div
                        className={cn(
                          "flex items-center justify-between gap-2 lg:contents",
                          !open && "hidden lg:contents",
                        )}
                      >
                        <Link
                          to={`/platform/clients/${row.id}`}
                          className="text-sm font-semibold text-[#2563EB] lg:hidden"
                        >
                          View details
                        </Link>
                        <button
                          type="button"
                          aria-label={`Delete ${row.name}`}
                          disabled={remove.isPending}
                          onClick={() => setDeleteTarget({ id: row.id, name: row.name })}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-[#9CA3AF] hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-500/10 dark:hover:text-red-300"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )
        ) : invitedLoading ? (
          <div className="flex items-center justify-center py-16 text-[#6B7280]">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            Loading invited clients...
          </div>
        ) : invitedRows.length === 0 ? (
          <p className="px-4 py-16 text-center text-sm text-[#6B7280]">
            {search ? "No invited clients match that search." : "No invited clients yet."}
          </p>
        ) : (
          <div className="min-w-0">
            <div className="hidden items-center gap-3 border-b border-[#EEF0F3] px-5 py-3 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_120px] dark:border-[#1E293B]">
              <p className="text-[11px] font-semibold tracking-[0.08em] text-[#9CA3AF] uppercase">
                Client
              </p>
              <p className="text-[11px] font-semibold tracking-[0.08em] text-[#9CA3AF] uppercase">
                Workspace
              </p>
              <p className="text-right text-[11px] font-semibold tracking-[0.08em] text-[#9CA3AF] uppercase">
                Status
              </p>
            </div>
            <div className="divide-y divide-[#F1F3F5] dark:divide-[#1E293B]">
                {invitedRows.map((row) => (
                  <Link
                    key={row.id}
                    to={`/platform/clients/invited/${row.id}`}
                    className="grid min-w-0 grid-cols-1 gap-2 px-4 py-4 hover:bg-[#F8FAFC] lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_120px] lg:items-center lg:gap-3 lg:px-5 dark:hover:bg-white/5"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#EEF4FF] text-sm font-bold text-[#2563EB]">
                        {(row.name[0] ?? "C").toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold text-[#111827] dark:text-white">{row.name}</p>
                        <p className="truncate text-xs text-[#6B7280]">{row.email || "No email"}</p>
                      </div>
                    </div>
                    <div className="min-w-0 pl-14 lg:pl-0">
                      <p className="mb-1 text-[11px] font-semibold tracking-[0.08em] text-[#9CA3AF] uppercase lg:hidden">
                        Workspace
                      </p>
                      <p className="break-words text-sm text-[#4B5563] lg:truncate dark:text-slate-300">
                        {row.organizationName}
                      </p>
                    </div>
                    <div className="flex items-center justify-between gap-2 pl-14 lg:justify-end lg:pl-0">
                      <span
                        className={cn(
                          "inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                          row.status === "active"
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-gray-100 text-gray-600",
                        )}
                      >
                        {row.status}
                      </span>
                      <ChevronRight size={16} className="shrink-0 text-[#D1D5DB]" />
                    </div>
                  </Link>
                ))}
            </div>
          </div>
        )}
      </section>

      <AlertDialog
        open={deleteTarget != null}
        onOpenChange={(open) => {
          if (!open && !remove.isPending) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the customer workspace, its members, and their data. They will
              no longer be able to sign in. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>Keep client</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
              disabled={remove.isPending || !deleteTarget}
              onClick={(event) => {
                event.preventDefault();
                if (!deleteTarget) return;
                remove.mutate({ organizationId: deleteTarget.id });
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
