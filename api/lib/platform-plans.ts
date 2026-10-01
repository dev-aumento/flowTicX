import { Collections } from "@db/mongo/collections";
import type { SubscriptionPlanDoc } from "@db/mongo/types";
import {
  DEFAULT_PLATFORM_PLANS,
  durationDaysForInterval,
  planBillingInterval,
  slugifyPlanName,
  type PlatformPlan,
} from "@/lib/platform-admin";
import {
  deriveFeatureKeys,
  resolvePlanEntitlement,
  sanitizeHighlightKeys,
  type PlanLimits,
} from "@/lib/plan-entitlements";
import { getCollection, hasMongoConfigured, insertDoc, updateById } from "../queries/connection";
import { TRPCError } from "@trpc/server";

const PLAN_SORT = ["trial", "free", "starter", "growth", "business", "enterprise"];

function toPlan(doc: SubscriptionPlanDoc): PlatformPlan & { id: number } {
  const entitlement = resolvePlanEntitlement({
    slug: doc.slug,
    limits: doc.limits ?? null,
    highlightKeys: doc.highlightKeys ?? null,
    badge: doc.badge,
    ctaLabel: doc.ctaLabel,
    storageLabel: doc.storageLabel,
    entitlementsConfigured: doc.entitlementsConfigured,
  });
  const preset = DEFAULT_PLATFORM_PLANS.find((plan) => plan.slug === doc.slug);
  const showPresetCopy = doc.entitlementsConfigured !== true && preset != null;
  return {
    id: doc.id,
    slug: doc.slug,
    name: showPresetCopy && doc.slug === "trial" ? preset.name : doc.name,
    amount: doc.amount,
    amountUsd: typeof doc.amountUsd === "number" ? doc.amountUsd : 0,
    billingInterval: planBillingInterval(doc),
    description: showPresetCopy && doc.slug === "trial" ? preset.description : doc.description,
    durationDays: doc.durationDays,
    featureKeys: deriveFeatureKeys(entitlement.highlightKeys, entitlement.limits),
    sortOrder: doc.sortOrder,
    ...entitlement,
  };
}

function sortPlans<T extends { slug: string; sortOrder: number }>(plans: T[]) {
  return [...plans].sort((a, b) => {
    const ai = PLAN_SORT.indexOf(a.slug);
    const bi = PLAN_SORT.indexOf(b.slug);
    if (ai === -1 && bi === -1) return a.sortOrder - b.sortOrder;
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}

export async function listPlatformPlans(): Promise<Array<PlatformPlan & { id: number }>> {
  if (!hasMongoConfigured()) {
    return DEFAULT_PLATFORM_PLANS.map((plan, index) => ({ ...plan, id: index + 1 }));
  }

  const col = await getCollection<SubscriptionPlanDoc>(Collections.subscriptionPlans);
  let existing = await col.find({}).sort({ sortOrder: 1, id: 1 }).toArray();
  if (existing.length > 0) {
    const slugs = new Set(existing.map((plan) => plan.slug));
    const now = new Date();
    for (const plan of DEFAULT_PLATFORM_PLANS) {
      if (slugs.has(plan.slug)) continue;
      if (plan.slug === "trial" && slugs.has("free")) continue;
      if (plan.slug === "free" && slugs.has("trial")) continue;
      try {
        await insertDoc<SubscriptionPlanDoc>(Collections.subscriptionPlans, {
          slug: plan.slug,
          name: plan.name,
          amount: plan.amount,
          amountUsd: plan.amountUsd,
          billingInterval: plan.billingInterval,
          description: plan.description,
          durationDays: plan.durationDays,
          featureKeys: plan.featureKeys,
          sortOrder: plan.sortOrder,
          limits: plan.limits,
          highlightKeys: plan.highlightKeys,
          badge: plan.badge,
          ctaLabel: plan.ctaLabel,
          storageLabel: plan.storageLabel,
          entitlementsConfigured: true,
          createdAt: now,
          updatedAt: now,
        });
      } catch (error) {
        if ((error as { code?: number }).code !== 11000) throw error;
      }
    }
    existing = await col.find({}).sort({ sortOrder: 1, id: 1 }).toArray();
    return sortPlans(withDerivedFeatures(existing.map(toPlan)));
  }

  const seeded: Array<PlatformPlan & { id: number }> = [];
  const now = new Date();
  for (const plan of DEFAULT_PLATFORM_PLANS) {
    const created = await insertDoc<SubscriptionPlanDoc>(Collections.subscriptionPlans, {
      slug: plan.slug,
      name: plan.name,
      amount: plan.amount,
      amountUsd: plan.amountUsd,
      billingInterval: plan.billingInterval,
      description: plan.description,
      durationDays: plan.durationDays,
      featureKeys: plan.featureKeys,
      sortOrder: plan.sortOrder,
      limits: plan.limits,
      highlightKeys: plan.highlightKeys,
      badge: plan.badge,
      ctaLabel: plan.ctaLabel,
      storageLabel: plan.storageLabel,
      entitlementsConfigured: true,
      createdAt: now,
      updatedAt: now,
    });
    seeded.push(toPlan(created));
  }
  return withDerivedFeatures(seeded);
}

function withDerivedFeatures(plans: Array<PlatformPlan & { id: number }>) {
  return plans.map((plan) => ({
    ...plan,
    featureKeys: deriveFeatureKeys(plan.highlightKeys, plan.limits, plans),
  }));
}

export async function findPlatformPlan(slug: string) {
  const plans = await listPlatformPlans();
  return plans.find((plan) => plan.slug === slug) ?? null;
}

export async function upsertPlatformPlan(input: {
  id?: number;
  name: string;
  amount: number;
  amountUsd: number;
  billingInterval: "month" | "year";
  description: string;
  durationDays?: number;
  limits: PlanLimits;
  highlightKeys: string[];
  badge: string | null;
  ctaLabel: string;
  storageLabel: string | null;
}) {
  if (!hasMongoConfigured()) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Database is not configured",
    });
  }

  const col = await getCollection<SubscriptionPlanDoc>(Collections.subscriptionPlans);
  await listPlatformPlans();
  const now = new Date();
  const name = input.name.trim();
  const description = input.description.trim();
  const highlightKeys = sanitizeHighlightKeys(input.highlightKeys);
  const limits = input.limits;
  const badge = input.badge?.trim() || null;
  const ctaLabel = input.ctaLabel.trim() || "Select plan";
  const storageLabel = input.storageLabel?.trim() || null;
  const billingInterval = input.billingInterval === "year" ? "year" : "month";
  const durationDays = durationDaysForInterval(billingInterval);
  const amountUsd = input.amountUsd;
  const existing = await listPlatformPlans();
  const featureKeys = deriveFeatureKeys(highlightKeys, limits, existing);

  const entitlementFields = {
    limits,
    highlightKeys,
    badge,
    ctaLabel,
    storageLabel,
    featureKeys,
    entitlementsConfigured: true,
  };

  if (input.id) {
    const current = await col.findOne({ id: input.id });
    if (!current) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Plan not found" });
    }
    const updated = await updateById<SubscriptionPlanDoc>(Collections.subscriptionPlans, current.id, {
      name,
      amount: input.amount,
      amountUsd,
      billingInterval,
      description,
      durationDays,
      ...entitlementFields,
      updatedAt: now,
    });
    if (!updated) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Plan not found" });
    }
    return toPlan(updated);
  }

  let slug = slugifyPlanName(name);
  if (billingInterval === "year" && !slug.endsWith("-yearly")) {
    slug = `${slug}-yearly`;
  }
  const clash = await col.findOne({ slug });
  if (clash) slug = `${slug}-${Date.now().toString().slice(-4)}`;
  const last = await col.find({}).sort({ sortOrder: -1 }).limit(1).next();
  const created = await insertDoc<SubscriptionPlanDoc>(Collections.subscriptionPlans, {
    slug,
    name,
    amount: input.amount,
    amountUsd,
    billingInterval,
    description,
    durationDays,
    sortOrder: (last?.sortOrder ?? 0) + 1,
    ...entitlementFields,
    createdAt: now,
    updatedAt: now,
  });
  return toPlan(created);
}

export async function deletePlatformPlan(id: number) {
  if (!hasMongoConfigured()) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Database is not configured",
    });
  }

  const col = await getCollection<SubscriptionPlanDoc>(Collections.subscriptionPlans);
  const current = await col.findOne({ id });
  if (!current) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Plan not found" });
  }
  const remaining = await col.countDocuments({ id: { $ne: id } });
  if (remaining === 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "At least one subscription plan is required",
    });
  }
  await col.deleteOne({ id });
  return { success: true as const, slug: current.slug };
}
