import { useMemo, useState } from "react";
import { Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { PlanPricingCard } from "@/components/billing/PlanPricingCard";
import { PLAN_HIGHLIGHTS } from "@/lib/plan-entitlements";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type PlanForm = {
  id?: number;
  name: string;
  amount: string;
  description: string;
  durationDays: string;
  badge: string;
  ctaLabel: string;
  storageLabel: string;
  projects: string;
  projectsUnlimited: boolean;
  members: string;
  membersUnlimited: boolean;
  storage: string;
  storageUnlimited: boolean;
  highlightKeys: string[];
};

const EMPTY_FORM: PlanForm = {
  name: "",
  amount: "0",
  description: "",
  durationDays: "30",
  badge: "",
  ctaLabel: "Select plan",
  storageLabel: "",
  projects: "3",
  projectsUnlimited: false,
  members: "5",
  membersUnlimited: false,
  storage: "1",
  storageUnlimited: false,
  highlightKeys: [],
};

function parseQuota(unlimited: boolean, raw: string, label: string) {
  if (unlimited) return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Enter a whole number for ${label}, or mark it unlimited`);
  }
  return value;
}

export default function PlatformPlans() {
  const utils = trpc.useUtils();
  const { data: plans, isLoading } = trpc.platform.plans.useQuery();
  const { data: overview } = trpc.platform.overview.useQuery();
  const [form, setForm] = useState<PlanForm | null>(null);

  const upsert = trpc.platform.upsertPlan.useMutation({
    onSuccess: async (result) => {
      await Promise.all([
        utils.platform.plans.invalidate(),
        utils.platform.overview.invalidate(),
        utils.platform.listClients.invalidate(),
        utils.platform.getClient.invalidate(),
        utils.subscription.plans.invalidate(),
        utils.auth.me.invalidate(),
      ]);
      const updated = result.subscribersUpdated ?? 0;
      toast.success(
        updated > 0
          ? `Plan saved. ${updated} subscribed client${updated === 1 ? "" : "s"} updated to ${result.durationDays} days.`
          : "Plan saved",
      );
      setForm(null);
    },
    onError: (error) => toast.error(error.message),
  });

  const remove = trpc.platform.deletePlan.useMutation({
    onSuccess: async () => {
      await Promise.all([utils.platform.plans.invalidate(), utils.platform.overview.invalidate()]);
      toast.success("Plan deleted");
      setForm(null);
    },
    onError: (error) => toast.error(error.message),
  });

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of overview?.planDistribution ?? []) map.set(item.id, item.count);
    return map;
  }, [overview]);

  function save() {
    if (!form) return;
    const name = form.name.trim();
    const amount = Number(form.amount);
    const durationDays = Number(form.durationDays);
    if (!name) {
      toast.error("Enter a plan name");
      return;
    }
    if (!Number.isFinite(amount) || amount < 0) {
      toast.error("Enter a valid price");
      return;
    }
    if (!Number.isInteger(durationDays) || durationDays < 1) {
      toast.error("Enter duration in days");
      return;
    }
    const ctaLabel = form.ctaLabel.trim();
    if (!ctaLabel) {
      toast.error("Enter a button label");
      return;
    }
    let limits;
    try {
      limits = {
        projects: parseQuota(form.projectsUnlimited, form.projects, "projects"),
        teamMembers: parseQuota(form.membersUnlimited, form.members, "team members"),
        storageGb: parseQuota(form.storageUnlimited, form.storage, "storage"),
      };
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Enter valid limits");
      return;
    }
    upsert.mutate({
      id: form.id,
      name,
      amount,
      description: form.description.trim(),
      durationDays,
      limits,
      highlightKeys: form.highlightKeys,
      badge: form.badge.trim() || null,
      ctaLabel,
      storageLabel: form.storageLabel.trim() || null,
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#111827] sm:text-[28px] dark:text-white">
            Subscription Plans
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-[#6B7280]">
            Set the price, project limit, team size, storage, and the checklist for each plan. Saved items
            apply to admins, project managers, employees, and the client portal.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setForm({ ...EMPTY_FORM, highlightKeys: [] })}
          className="inline-flex h-11 items-center gap-2 rounded-xl bg-[#2563EB] px-4 text-sm font-semibold text-white hover:bg-[#1D4ED8]"
        >
          <Plus size={16} />
          Add plan
        </button>
      </div>

      {form ? (
        <section className="rounded-2xl border border-[#E6E8EC] bg-white p-6 shadow-sm dark:border-[#1E293B] dark:bg-[#0F172A]">
          <div className="mb-5 flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold">{form.id ? "Edit plan" : "New plan"}</h2>
            <button
              type="button"
              onClick={() => setForm(null)}
              className="rounded-lg p-1.5 text-[#6B7280] hover:bg-[#F3F4F6] dark:hover:bg-white/5"
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="plan-name">Plan name</Label>
              <Input
                id="plan-name"
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                className="h-11 rounded-xl"
                placeholder="Growth"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="plan-price">Price (INR)</Label>
              <Input
                id="plan-price"
                type="number"
                min={0}
                value={form.amount}
                onChange={(event) => setForm({ ...form, amount: event.target.value })}
                className="h-11 rounded-xl"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="plan-duration">Duration (days)</Label>
              <Input
                id="plan-duration"
                type="number"
                min={1}
                value={form.durationDays}
                onChange={(event) => setForm({ ...form, durationDays: event.target.value })}
                className="h-11 rounded-xl"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="plan-cta">Button label</Label>
              <Input
                id="plan-cta"
                value={form.ctaLabel}
                onChange={(event) => setForm({ ...form, ctaLabel: event.target.value })}
                className="h-11 rounded-xl"
                placeholder="Get Started Now"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="plan-badge">Badge</Label>
              <Input
                id="plan-badge"
                value={form.badge}
                onChange={(event) => setForm({ ...form, badge: event.target.value })}
                className="h-11 rounded-xl"
                placeholder="Most popular"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="plan-description">Audience</Label>
              <Input
                id="plan-description"
                value={form.description}
                onChange={(event) => setForm({ ...form, description: event.target.value })}
                className="h-11 rounded-xl"
                placeholder="Who this plan is for"
              />
            </div>
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-3">
            <QuotaField
              id="plan-projects"
              label="Active projects"
              value={form.projects}
              unlimited={form.projectsUnlimited}
              onValue={(projects) => setForm({ ...form, projects })}
              onUnlimited={(projectsUnlimited) => setForm({ ...form, projectsUnlimited })}
            />
            <QuotaField
              id="plan-members"
              label="Team members"
              value={form.members}
              unlimited={form.membersUnlimited}
              onValue={(members) => setForm({ ...form, members })}
              onUnlimited={(membersUnlimited) => setForm({ ...form, membersUnlimited })}
            />
            <QuotaField
              id="plan-storage"
              label="Cloud storage (GB)"
              value={form.storage}
              unlimited={form.storageUnlimited}
              onValue={(storage) => setForm({ ...form, storage })}
              onUnlimited={(storageUnlimited) => setForm({ ...form, storageUnlimited })}
            />
          </div>
          <div className="mt-4 space-y-1.5">
            <Label htmlFor="plan-storage-label">Storage line on the card</Label>
            <Input
              id="plan-storage-label"
              value={form.storageLabel}
              onChange={(event) => setForm({ ...form, storageLabel: event.target.value })}
              className="h-11 rounded-xl"
              placeholder="25 GB fast cloud storage"
              disabled={form.storageUnlimited}
            />
          </div>

          <div className="mt-5">
            <p className="text-sm font-semibold text-[#111827] dark:text-white">Included on this plan</p>
            <p className="mt-1 text-sm text-[#6B7280]">
              Checked lines appear on the pricing card. Lines that map to a module also show up in the
              workspace menus.
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {PLAN_HIGHLIGHTS.map((item) => {
                const checked = form.highlightKeys.includes(item.key);
                return (
                  <label
                    key={item.key}
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-3",
                      checked
                        ? "border-[#2563EB]/40 bg-[#EEF4FF] dark:border-blue-500/40 dark:bg-blue-500/10"
                        : "border-[#E6E8EC] dark:border-[#334155]",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setForm({
                          ...form,
                          highlightKeys: checked
                            ? form.highlightKeys.filter((key) => key !== item.key)
                            : [...form.highlightKeys, item.key],
                        })
                      }
                      className="mt-1 h-4 w-4 accent-[#2563EB]"
                    />
                    <span className="text-sm font-medium">{item.label}</span>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              disabled={upsert.isPending}
              onClick={save}
              className="inline-flex h-11 items-center rounded-xl bg-[#2563EB] px-5 text-sm font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-60"
            >
              {upsert.isPending ? "Saving..." : "Save plan"}
            </button>
            {form.id ? (
              <button
                type="button"
                disabled={remove.isPending}
                onClick={() => {
                  if (!window.confirm(`Delete ${form.name || "this plan"}?`)) return;
                  remove.mutate({ id: form.id! });
                }}
                className="inline-flex h-11 items-center gap-2 rounded-xl border border-red-200 px-4 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-60 dark:border-red-500/30"
              >
                <Trash2 size={15} />
                Delete
              </button>
            ) : null}
          </div>
        </section>
      ) : null}

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-[#6B7280]">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Loading plans...
        </div>
      ) : (
        <div className="grid items-stretch gap-5 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
          {(plans ?? []).map((plan) => {
            const count = counts.get(plan.slug) ?? 0;
            return (
              <PlanPricingCard
                key={plan.slug}
                plan={plan}
                plain
                footer={
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm text-[#2563EB]">
                      {count} {count === 1 ? "workspace" : "workspaces"}
                    </p>
                    <button
                      type="button"
                      onClick={() =>
                        setForm({
                          id: plan.id,
                          name: plan.name,
                          amount: String(plan.amount),
                          description: plan.description,
                          durationDays: String(plan.durationDays),
                          badge: plan.badge ?? "",
                          ctaLabel: plan.ctaLabel,
                          storageLabel: plan.storageLabel ?? "",
                          projects: plan.limits.projects == null ? "" : String(plan.limits.projects),
                          projectsUnlimited: plan.limits.projects == null,
                          members: plan.limits.teamMembers == null ? "" : String(plan.limits.teamMembers),
                          membersUnlimited: plan.limits.teamMembers == null,
                          storage: plan.limits.storageGb == null ? "" : String(plan.limits.storageGb),
                          storageUnlimited: plan.limits.storageGb == null,
                          highlightKeys: plan.highlightKeys,
                        })
                      }
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#E6E8EC] bg-white px-2.5 text-xs font-semibold text-[#111827] hover:bg-[#F8FAFC] dark:border-[#334155] dark:bg-[#0F172A] dark:text-white"
                    >
                      <Pencil size={13} />
                      Edit
                    </button>
                  </div>
                }
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function QuotaField({
  id,
  label,
  value,
  unlimited,
  onValue,
  onUnlimited,
}: {
  id: string;
  label: string;
  value: string;
  unlimited: boolean;
  onValue: (value: string) => void;
  onUnlimited: (unlimited: boolean) => void;
}) {
  return (
    <div className="space-y-1.5 rounded-xl border border-[#E6E8EC] p-3 dark:border-[#334155]">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        min={0}
        value={unlimited ? "" : value}
        disabled={unlimited}
        placeholder={unlimited ? "Unlimited" : "0"}
        onChange={(event) => onValue(event.target.value)}
        className="h-11 rounded-xl"
      />
      <label className="flex items-center gap-2 text-sm text-[#111827] dark:text-slate-200">
        <input
          type="checkbox"
          checked={unlimited}
          onChange={(event) => onUnlimited(event.target.checked)}
          className="h-4 w-4 accent-[#2563EB]"
        />
        Unlimited
      </label>
    </div>
  );
}
