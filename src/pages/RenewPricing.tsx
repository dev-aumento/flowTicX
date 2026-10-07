import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { ArrowLeft, Loader2 } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { PlanPricingCard } from "@/components/billing/PlanPricingCard";
import { PlanIntervalTabs } from "@/components/billing/PlanIntervalTabs";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";
import { BrandLogo } from "@/components/brand/BrandLogo";
import {
  detectPlanCurrency,
  planBillingInterval,
  sortPlansByPrice,
  type PlanBillingInterval,
} from "@/lib/platform-admin";
import { isPopularPlan } from "@/lib/plan-entitlements";
import { clearPlanEndedNotice } from "@/lib/plan-ended";
import { writeAuthCache } from "@/lib/auth-cache";
import { getDefaultHomePath } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

function isComplimentaryTrial(plan: { slug: string; name: string; badge?: string | null; amount: number }) {
  const slug = plan.slug.trim().toLowerCase();
  if (slug === "trial" || slug === "free") return true;
  const name = plan.name.trim().toLowerCase();
  if (name === "free" || name === "free trial") return true;
  return plan.amount === 0 && /free/i.test(plan.badge ?? "");
}

export default function RenewPricing() {
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo =
    (location.state as { returnTo?: string } | null)?.returnTo ?? "/settings";
  const { user, isLoading: authLoading } = useAuth();
  const loggedInAdmin = !authLoading && String(user?.role ?? "").toLowerCase() === "admin";
  const utils = trpc.useUtils();
  const { data: plans, isLoading } = trpc.subscription.catalog.useQuery();
  const { data: current } = trpc.subscription.current.useQuery(undefined, {
    enabled: loggedInAdmin,
  });
  const contextQuery = trpc.subscription.renewContext.useQuery(undefined, {
    enabled: !authLoading && !loggedInAdmin,
  });
  const renew = trpc.subscription.renew.useMutation({
    onSuccess: async (result) => {
      writeAuthCache(result.user);
      utils.auth.me.setData(undefined, result.user);
      clearPlanEndedNotice();
      await utils.invalidate();
      toast.success(`${result.planName ?? "Plan"} is now active`);
      navigate(getDefaultHomePath(result.user), { replace: true });
    },
    onError: (error) => toast.error(error.message),
  });
  const select = trpc.subscription.selectPlan.useMutation({
    onSuccess: async (result) => {
      await Promise.all([
        utils.auth.me.invalidate(),
        utils.subscription.current.invalidate(),
        utils.subscription.catalog.invalidate(),
      ]);
      toast.success(`${result.planName ?? "Plan"} is now active`);
      navigate(returnTo, {
        replace: true,
        state: returnTo === "/settings" ? { tab: "plans" } : undefined,
      });
    },
    onError: (error) => toast.error(error.message),
  });

  const currency = detectPlanCurrency();
  const [interval, setInterval] = useState<PlanBillingInterval>("month");
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [syncedInterval, setSyncedInterval] = useState(false);
  const context = contextQuery.data;
  const canRenew = loggedInAdmin || context?.canRenew === true;
  const currentSlug = current?.plan ?? "";

  useEffect(() => {
    if (!currentSlug || selectedSlug || !plans) return;
    const active = plans.find((plan) => plan.slug === currentSlug);
    if (!active || isComplimentaryTrial(active)) return;
    setSelectedSlug(currentSlug);
  }, [currentSlug, selectedSlug, plans]);

  useEffect(() => {
    if (syncedInterval || !currentSlug || !plans) return;
    const active = plans.find((plan) => plan.slug === currentSlug);
    if (!active) return;
    setInterval(planBillingInterval(active));
    setSyncedInterval(true);
  }, [currentSlug, plans, syncedInterval]);

  const visiblePlans = useMemo(
    () =>
      sortPlansByPrice(
        (plans ?? []).filter(
          (plan) => planBillingInterval(plan) === interval && !isComplimentaryTrial(plan),
        ),
      ),
    [plans, interval],
  );

  function continueWith(slug: string) {
    if (!canRenew || renew.isPending || select.isPending) return;
    setSelectedSlug(slug);
    if (loggedInAdmin) {
      if (slug === currentSlug) {
        navigate(returnTo, {
          replace: true,
          state: returnTo === "/settings" ? { tab: "plans" } : undefined,
        });
        return;
      }
      select.mutate({ slug });
      return;
    }
    renew.mutate({ slug });
  }

  function renderPlanCard(plan: (typeof visiblePlans)[number]) {
    const selected = plan.slug === selectedSlug;
    const featured = isPopularPlan(plan);
    const pending =
      (renew.isPending && renew.variables?.slug === plan.slug) ||
      (select.isPending && select.variables?.slug === plan.slug);
    return (
      <PlanPricingCard
        plan={plan}
        selected={selected}
        currency={currency}
        action={
          <button
            type="button"
            disabled={!canRenew || renew.isPending || select.isPending}
            onClick={() => continueWith(plan.slug)}
            className={cn(
              "inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold disabled:opacity-60",
              selected || featured
                ? "bg-[#2563EB] text-white hover:bg-[#1D4ED8]"
                : "border border-[#2563EB] bg-white text-[#2563EB] hover:bg-[#EEF4FF]",
            )}
          >
            {pending ? <Loader2 size={16} className="animate-spin" /> : null}
            Continue with this plan
          </button>
        }
      />
    );
  }

  return (
    <div className="min-h-screen bg-[#F4F6F8]">
      <header className="border-b border-[#E6E8EC] bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <BrandLogo variant="light" imgClassName="h-8" />
          <Link
            to={loggedInAdmin ? returnTo : "/plan-ended"}
            state={loggedInAdmin && returnTo === "/settings" ? { tab: "plans" } : undefined}
            className="inline-flex items-center gap-1 text-sm font-medium text-[#2563EB] hover:underline"
          >
            <ArrowLeft size={14} />
            {loggedInAdmin ? "Back to settings" : "Back"}
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight text-[#111827] sm:text-[28px]">
            {loggedInAdmin ? "Choose a plan" : "Renew your plan"}
          </h1>
          <p className="max-w-2xl text-sm text-[#6B7280]">
            {context?.organizationName
              ? `Choose a monthly or yearly plan for ${context.organizationName}. `
              : "Choose a monthly or yearly plan. "}
            The tools you can use follow the features included in the plan you select.
          </p>
          {!authLoading && !loggedInAdmin && contextQuery.isSuccess && !canRenew ? (
            <p className="text-sm text-amber-800">
              {context?.signedIn
                ? "Only the workspace super admin can confirm a plan. Sign in with that account, then choose a plan here."
                : "Sign in with the workspace super admin account first. After the plan-ended screen, open Renew your plan to choose one."}
            </p>
          ) : null}
        </div>

        <PlanIntervalTabs value={interval} onChange={setInterval} />

        {isLoading ? (
          <div className="flex min-h-[30vh] items-center justify-center text-[#6B7280]">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            Loading pricing plans...
          </div>
        ) : visiblePlans.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-[#E6E8EC] bg-white px-5 py-10 text-center text-sm text-[#6B7280]">
            No {interval === "year" ? "yearly" : "monthly"} plans are available yet.
          </p>
        ) : (
          <>
            <div className="hidden items-stretch gap-4 xl:grid xl:grid-cols-4">
              {visiblePlans.map((plan) => (
                <div key={plan.slug} className="h-full min-w-0">
                  {renderPlanCard(plan)}
                </div>
              ))}
            </div>

            <div className="xl:hidden">
              <Carousel
                key={interval}
                opts={{ align: "start", containScroll: "trimSnaps" }}
                className="w-full"
              >
                <CarouselContent className="ml-0 md:-ml-4">
                  {visiblePlans.map((plan) => (
                    <CarouselItem key={plan.slug} className="basis-full pt-5 pl-0 md:basis-1/2 md:pl-4">
                      {renderPlanCard(plan)}
                    </CarouselItem>
                  ))}
                </CarouselContent>
                <div className="mt-4 flex items-center justify-center gap-3">
                  <CarouselPrevious className="static top-auto left-auto translate-x-0 translate-y-0" />
                  <CarouselNext className="static top-auto right-auto translate-x-0 translate-y-0" />
                </div>
              </Carousel>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
