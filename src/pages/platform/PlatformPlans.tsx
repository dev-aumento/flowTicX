import { useMemo, useState } from "react";
import { Check, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { formatInr, PLAN_FEATURE_CATALOG } from "@/lib/platform-admin";
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
  featureKeys: string[];
};

const EMPTY_FORM: PlanForm = {
  name: "",
  amount: "0",
  description: "",
  durationDays: "365",
  featureKeys: [],
};

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
    upsert.mutate({
      id: form.id,
      name,
      amount,
      description: form.description.trim(),
      durationDays,
      featureKeys: form.featureKeys,
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#111827] sm:text-[28px] dark:text-white">
            Subscription Plans
          </h1>
          <p className="mt-1 text-sm text-[#6B7280]">
            Edit names, pricing, and the modules included in each plan.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setForm({ ...EMPTY_FORM })}
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
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="plan-description">Description</Label>
              <Input
                id="plan-description"
                value={form.description}
                onChange={(event) => setForm({ ...form, description: event.target.value })}
                className="h-11 rounded-xl"
                placeholder="What this plan is for"
              />
            </div>
          </div>

          <div className="mt-5">
            <p className="text-sm font-semibold text-[#111827] dark:text-white">Included functionality</p>
            <p className="mt-1 text-sm text-[#6B7280]">
              Customers on this plan get these modules in Aaso.
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {PLAN_FEATURE_CATALOG.map((feature) => {
                const checked = form.featureKeys.includes(feature.key);
                return (
                  <label
                    key={feature.key}
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
                          featureKeys: checked
                            ? form.featureKeys.filter((key) => key !== feature.key)
                            : [...form.featureKeys, feature.key],
                        })
                      }
                      className="mt-1 h-4 w-4 accent-[#2563EB]"
                    />
                    <span>
                      <span className="block text-sm font-medium">{feature.label}</span>
                      <span className="block text-xs text-[#6B7280]">{feature.description}</span>
                    </span>
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
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {(plans ?? []).map((plan) => {
            const count = counts.get(plan.slug) ?? 0;
            return (
              <div
                key={plan.slug}
                className="flex flex-col rounded-2xl border border-[#E6E8EC] bg-white p-5 shadow-sm dark:border-[#1E293B] dark:bg-[#0F172A]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#6B7280]">
                      {plan.name}
                    </p>
                    <p className="mt-3 text-3xl font-bold">
                      {plan.amount === 0 ? "Free" : formatInr(plan.amount)}
                    </p>
                    <p className="mt-1 text-xs text-[#6B7280]">{plan.durationDays} days</p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setForm({
                        id: plan.id,
                        name: plan.name,
                        amount: String(plan.amount),
                        description: plan.description,
                        durationDays: String(plan.durationDays),
                        featureKeys: plan.featureKeys,
                      })
                    }
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#E6E8EC] px-2.5 text-xs font-semibold text-[#111827] hover:bg-[#F8FAFC] dark:border-[#334155] dark:text-white"
                  >
                    <Pencil size={13} />
                    Edit
                  </button>
                </div>
                <p className="mt-3 text-sm text-[#6B7280]">{plan.description}</p>
                <ul className="mt-4 space-y-1.5">
                  {plan.featureKeys.map((key) => {
                    const feature = PLAN_FEATURE_CATALOG.find((item) => item.key === key);
                    return (
                      <li key={key} className="flex items-start gap-2 text-sm text-[#111827] dark:text-slate-200">
                        <Check size={14} className="mt-0.5 shrink-0 text-[#2563EB]" />
                        {feature?.label ?? key}
                      </li>
                    );
                  })}
                </ul>
                <p className="mt-auto pt-5 text-sm text-[#2563EB]">
                  {count} {count === 1 ? "workspace" : "workspaces"}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
