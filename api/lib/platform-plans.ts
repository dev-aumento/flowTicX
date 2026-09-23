import { Collections } from "@db/mongo/collections";
import type { SubscriptionPlanDoc } from "@db/mongo/types";
import { DEFAULT_PLATFORM_PLANS, slugifyPlanName, type PlatformPlan } from "@/lib/platform-admin";
import { getCollection, hasMongoConfigured, insertDoc, updateById } from "../queries/connection";
import { TRPCError } from "@trpc/server";

function toPlan(doc: SubscriptionPlanDoc): PlatformPlan & { id: number } {
  return {
    id: doc.id,
    slug: doc.slug,
    name: doc.name,
    amount: doc.amount,
    description: doc.description,
    durationDays: doc.durationDays,
    featureKeys: doc.featureKeys ?? [],
    sortOrder: doc.sortOrder,
  };
}

export async function listPlatformPlans(): Promise<Array<PlatformPlan & { id: number }>> {
  if (!hasMongoConfigured()) {
    return DEFAULT_PLATFORM_PLANS.map((plan, index) => ({ ...plan, id: index + 1 }));
  }

  const col = await getCollection<SubscriptionPlanDoc>(Collections.subscriptionPlans);
  const existing = await col.find({}).sort({ sortOrder: 1, id: 1 }).toArray();
  if (existing.length > 0) return existing.map(toPlan);

  const seeded: Array<PlatformPlan & { id: number }> = [];
  const now = new Date();
  for (const plan of DEFAULT_PLATFORM_PLANS) {
    const created = await insertDoc<SubscriptionPlanDoc>(Collections.subscriptionPlans, {
      slug: plan.slug,
      name: plan.name,
      amount: plan.amount,
      description: plan.description,
      durationDays: plan.durationDays,
      featureKeys: plan.featureKeys,
      sortOrder: plan.sortOrder,
      createdAt: now,
      updatedAt: now,
    });
    seeded.push(toPlan(created));
  }
  return seeded;
}

export async function findPlatformPlan(slug: string) {
  const plans = await listPlatformPlans();
  return plans.find((plan) => plan.slug === slug) ?? null;
}

export async function upsertPlatformPlan(input: {
  id?: number;
  name: string;
  amount: number;
  description: string;
  durationDays: number;
  featureKeys: string[];
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
  const featureKeys = [...new Set(input.featureKeys.map((key) => key.trim()).filter(Boolean))];

  if (input.id) {
    const current = await col.findOne({ id: input.id });
    if (!current) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Plan not found" });
    }
    const updated = await updateById<SubscriptionPlanDoc>(Collections.subscriptionPlans, current.id, {
      name,
      amount: input.amount,
      description,
      durationDays: input.durationDays,
      featureKeys,
      updatedAt: now,
    });
    if (!updated) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Plan not found" });
    }
    return toPlan(updated);
  }

  let slug = slugifyPlanName(name);
  const clash = await col.findOne({ slug });
  if (clash) slug = `${slug}-${Date.now().toString().slice(-4)}`;
  const last = await col.find({}).sort({ sortOrder: -1 }).limit(1).next();
  const created = await insertDoc<SubscriptionPlanDoc>(Collections.subscriptionPlans, {
    slug,
    name,
    amount: input.amount,
    description,
    durationDays: input.durationDays,
    featureKeys,
    sortOrder: (last?.sortOrder ?? 0) + 1,
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
