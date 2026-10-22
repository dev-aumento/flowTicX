import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { Loader2 } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { PricingPlanCard } from "@/components/billing/PricingPlanCard";
import { PricingIntervalToggle } from "@/components/billing/PricingIntervalToggle";
import { PricingHero } from "@/components/billing/PricingHero";
import { PricingBenefits } from "@/components/billing/PricingBenefits";
import { PricingComparison } from "@/components/billing/PricingComparison";
import { PricingPaymentMethods } from "@/components/billing/PricingPaymentMethods";
import { PricingFaq } from "@/components/billing/PricingFaq";
import { PricingCtaBanner } from "@/components/billing/PricingCtaBanner";
import { AASO_APP_URL } from "@/components/brand/BrandLogo";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";
import { PricingHeader } from "@/components/billing/PricingHeader";
import {
  isFreeCatalogPlan,
  planBillingInterval,
  sortPlansByPrice,
  type PlanBillingInterval,
} from "@/lib/platform-admin";
import { completePlanCheckout, RazorpayCheckoutClosed } from "@/lib/razorpay-checkout";
import { clearPlanEndedNotice } from "@/lib/plan-ended";
import { writeAuthCache } from "@/lib/auth-cache";
import { getDefaultHomePath } from "@/lib/permissions";
import { toast } from "sonner";

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
  const beginCheckout = trpc.subscription.beginCheckout.useMutation();
  const confirmPayment = trpc.subscription.confirmPayment.useMutation();
  const [pendingSlug, setPendingSlug] = useState<string | null>(null);

  const currency = "INR" as const;
  const [interval, setInterval] = useState<PlanBillingInterval>("month");
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const context = contextQuery.data;
  const isGuest = !authLoading && !user;
  const canChoose = loggedInAdmin || context?.canRenew === true || isGuest;
  const currentSlug = current?.plan ?? "";

  useEffect(() => {
    if (!currentSlug || selectedSlug || !plans) return;
    const active = plans.find((plan) => plan.slug === currentSlug);
    if (!active) return;
    setSelectedSlug(currentSlug);
  }, [currentSlug, selectedSlug, plans]);

  const visiblePlans = useMemo(
    () =>
      sortPlansByPrice(
        (plans ?? []).filter((plan) => planBillingInterval(plan) === interval),
      ),
    [plans, interval],
  );

  // Yearly plans show how much they save over twelve months of the monthly plan with the same name.
  const yearlySavings = useMemo(() => {
    const savings = new Map<string, number>();
    if (interval !== "year") return savings;
    const perMonth = (plan: { amount: number; durationDays: number }) =>
      plan.amount / Math.max(1, Math.round(plan.durationDays / (365 / 12)));
    for (const plan of visiblePlans) {
      if (isFreeCatalogPlan(plan)) continue;
      const monthly = (plans ?? []).find(
        (item) =>
          planBillingInterval(item) === "month" &&
          item.name.trim().toLowerCase() === plan.name.trim().toLowerCase(),
      );
      if (!monthly || monthly.amount <= 0) continue;
      const percent = Math.round((1 - perMonth(plan) / perMonth(monthly)) * 100);
      if (percent > 0) savings.set(plan.slug, percent);
    }
    return savings;
  }, [interval, visiblePlans, plans]);

  // The catalog seeds either "free" or "trial" as the free tier, so read the slug instead of guessing it.
  // Registering with it activates the free plan; without a slug the new admin is sent back here to choose.
  const freePlanSlug = useMemo(() => {
    const free = (plans ?? []).filter((plan) => isFreeCatalogPlan(plan));
    return (free.find((plan) => planBillingInterval(plan) === "month") ?? free[0])?.slug ?? null;
  }, [plans]);
  // Signed-in users already have a workspace, so the banner takes them to the plans instead of the register form.
  const trialHref =
    authLoading || user
      ? "#plans"
      : freePlanSlug
        ? `${AASO_APP_URL}/login?signup=register&plan=${encodeURIComponent(freePlanSlug)}`
        : `${AASO_APP_URL}/login?signup=register`;

  function continueWith(slug: string) {
    if (!canChoose || pendingSlug) return;
    setSelectedSlug(slug);
    const plan = (plans ?? []).find((item) => item.slug === slug);
    if (plan && isFreeCatalogPlan(plan)) {
      if (!user) {
        navigate(`/login?plan=${encodeURIComponent(slug)}`);
        return;
      }
      setPendingSlug(slug);
      void beginCheckout
        .mutateAsync({ slug })
        .then(async (result) => {
          if (result.needsAccount || result.requiresPayment || !user) {
            navigate(`/login?plan=${encodeURIComponent(slug)}`);
            return;
          }
          toast.success(`${result.planName ?? plan.name} is now active`);
          if (result.renewedSession && result.user) {
            writeAuthCache(result.user);
            utils.auth.me.setData(undefined, result.user);
            clearPlanEndedNotice();
            await utils.invalidate();
            navigate(getDefaultHomePath(result.user), { replace: true });
            return;
          }
          clearPlanEndedNotice();
          await utils.auth.me.invalidate();
          navigate(getDefaultHomePath(user), { replace: true });
        })
        .catch((error: unknown) => {
          toast.error(error instanceof Error ? error.message : "The free plan could not be started");
        })
        .finally(() => setPendingSlug(null));
      return;
    }
    if (isGuest) {
      navigate(`/login?signup=register&plan=${encodeURIComponent(slug)}`);
      return;
    }
    if (loggedInAdmin && slug === currentSlug) {
      navigate(returnTo, {
        replace: true,
        state: returnTo === "/settings" ? { tab: "plans" } : undefined,
      });
      return;
    }
    setPendingSlug(slug);
    void completePlanCheckout(
      slug,
      (input) => beginCheckout.mutateAsync(input),
      (proof) => confirmPayment.mutateAsync(proof),
    )
      .then(async (result) => {
        if (result.accountNext === "register" && result.accountEmail) {
          toast.success("Payment received. Create your account to sign in.");
          navigate(`/login?email=${encodeURIComponent(result.accountEmail)}&signup=register`, { replace: true });
          return;
        }
        if (result.accountNext === "login" && result.accountEmail) {
          toast.success("Payment received. Sign in with your password.");
          navigate(`/login?email=${encodeURIComponent(result.accountEmail)}&signup=login`, { replace: true });
          return;
        }
        toast.success(
          result.planStatus === "trial"
            ? `Your 1 month free trial of ${result.planName ?? "this plan"} has started`
            : `${result.planName ?? "Plan"} is now active`,
        );
        if (result.renewedSession && result.user) {
          writeAuthCache(result.user);
          utils.auth.me.setData(undefined, result.user);
          clearPlanEndedNotice();
          await utils.invalidate();
          navigate(getDefaultHomePath(result.user), { replace: true });
          return;
        }
        await Promise.all([
          utils.auth.me.invalidate(),
          utils.subscription.current.invalidate(),
          utils.subscription.catalog.invalidate(),
        ]);
        navigate(returnTo, {
          replace: true,
          state: returnTo === "/settings" ? { tab: "plans" } : undefined,
        });
      })
      .catch((error: unknown) => {
        if (error instanceof RazorpayCheckoutClosed) return;
        toast.error(error instanceof Error ? error.message : "Payment could not be completed");
      })
      .finally(() => setPendingSlug(null));
  }

  function renderPlanCard(plan: (typeof visiblePlans)[number]) {
    const isCurrent = Boolean(currentSlug) && plan.slug === currentSlug;
    const selected = plan.slug === selectedSlug;
    const ctaLabel = isCurrent
      ? "Current plan"
      : isFreeCatalogPlan(plan)
        ? "Get Started Free"
        : `Choose ${plan.name}`;
    return (
      <PricingPlanCard
        plan={plan}
        selected={selected}
        currency={currency}
        ctaLabel={ctaLabel}
        savingsPercent={yearlySavings.get(plan.slug)}
        pending={pendingSlug === plan.slug}
        disabled={!canChoose || pendingSlug != null || isCurrent}
        onSelect={() => continueWith(plan.slug)}
      />
    );
  }

  // overflow-x-clip, not hidden: hidden turns this wrapper into a scroll container and breaks the sticky header.
  return (
    <div className="force-light min-h-screen overflow-x-clip bg-[#F7F8FC] text-[#111827]">
      <PricingHeader plansAnchor="plans" />

      <PricingHero />

      <main id="plans" className="mx-auto flex max-w-[1700px] scroll-mt-20 flex-col gap-10 px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex flex-col items-center gap-4">
          <PricingIntervalToggle value={interval} onChange={setInterval} />
          {!authLoading && !loggedInAdmin && contextQuery.isSuccess && !canChoose ? (
            <p className="max-w-xl text-center text-sm text-amber-800">
              Only the workspace super admin can confirm a plan. Sign in with that account, then choose a plan here.
            </p>
          ) : null}
        </div>

        {isLoading ? (
          <div className="flex min-h-[30vh] items-center justify-center text-[#374151] dark:text-[#E5E7EB]">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            Loading pricing plans...
          </div>
        ) : visiblePlans.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-[#E6E8EC] bg-white px-5 py-10 text-center text-sm text-[#374151] dark:border-[#3B4A63] dark:bg-[#151C2C] dark:text-[#E5E7EB]">
            No {interval === "year" ? "yearly" : "monthly"} plans are available yet.
          </p>
        ) : (
          <>
            {/* Five-up card width, centered so a shorter row (e.g. yearly, no free tier) sits in the middle. */}
            <div className="hidden items-stretch justify-center gap-4 xl:flex">
              {visiblePlans.map((plan) => (
                <div key={plan.slug} className="min-w-0 xl:w-[calc((100%-4rem)/5)]">
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
                {/* safe center: centered when the cards fit, start-aligned once they scroll. */}
                <CarouselContent className="-ml-3 [justify-content:safe_center] md:-ml-4">
                  {visiblePlans.map((plan) => (
                    <CarouselItem key={plan.slug} className="basis-[88%] pl-3 pt-5 sm:basis-[70%] md:basis-1/2 md:pl-4 lg:basis-1/3">
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

      <PricingBenefits />

      <PricingComparison />

      <PricingPaymentMethods />

      <PricingFaq />

      <PricingCtaBanner trialHref={trialHref} />
    </div>
  );
}
