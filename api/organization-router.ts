import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, authedQuery } from "./middleware";
import { ensureSchema } from "./lib/migrate";
import { findById, hasMongoConfigured, updateById } from "./queries/connection";
import { isAuthDisabled } from "./lib/dev-mode";
import { Collections } from "@db/mongo/collections";
import type { OrganizationBillingProfile, OrganizationDoc } from "@db/mongo/types";
import { findOrganizationById, requireOrganizationId } from "./lib/tenant";
import { hasPermission } from "./lib/permissions";
import { Workspace } from "@contracts/constants";
import {
  GSTIN_ERROR,
  PAN_ERROR,
  isValidGstinOrUin,
  isValidPan,
} from "@contracts/indian-tax-ids";
import { normalizeCurrencyCode } from "@/lib/invoice-store";
import {
  mockGetOrgCurrency,
  mockGetPipelineStageLabels,
  mockGetTaskStatusLabels,
  mockSetOrgCurrency,
  mockSetPipelineStageLabels,
  mockSetTaskStatusLabels,
} from "./lib/mock-store";
import {
  mergeTaskStatusLabels,
  type TaskStatusLabels,
} from "@/lib/task-status-labels";
import {
  resolvePipelineStages,
  sparsePipelineLabelOverrides,
} from "@/lib/task-kanban";

const additionalFieldSchema = z.object({
  id: z.string().max(80),
  label: z.string().max(200),
  value: z.string().max(500),
});

const billingProfileSchema = z.object({
  logoDataUrl: z.string().max(2_000_000).nullable(),
  name: z.string().min(1).max(200),
  industry: z.string().max(120).default(""),
  businessType: z.string().max(120).default(""),
  location: z.string().min(1).max(120),
  addressLine1: z.string().max(200).default(""),
  addressLine2: z.string().max(200).default(""),
  city: z.string().max(100).default(""),
  zip: z.string().max(30).default(""),
  state: z.string().max(100).default(""),
  phone: z.string().max(40).default(""),
  fax: z.string().max(40).default(""),
  website: z.string().max(200).default(""),
  differentPaymentAddress: z.boolean().default(false),
  paymentAddressLine1: z.string().max(200).default(""),
  paymentAddressLine2: z.string().max(200).default(""),
  paymentCity: z.string().max(100).default(""),
  paymentZip: z.string().max(30).default(""),
  paymentState: z.string().max(100).default(""),
  paymentCountry: z.string().max(120).default("India"),
  paymentPhone: z.string().max(40).default(""),
  primaryContactName: z.string().min(1).max(200),
  primaryContactEmail: z.string().email().max(320),
  baseCurrency: z.string().max(10).default("INR"),
  fiscalYear: z.string().max(40).default("january_december"),
  language: z.string().max(20).default("en"),
  timeZone: z.string().max(80).default("Asia/Kolkata"),
  dateFormat: z.string().max(40).default("dd MMM yyyy"),
  companyIdType: z.string().max(40).default("CIN"),
  companyIdValue: z.string().max(80).default(""),
  taxIdType: z.string().max(40).default("GSTIN"),
  taxIdValue: z.string().max(80).default(""),
  bankName: z.string().max(120).default(""),
  bankAccountName: z.string().max(200).default(""),
  bankAccountNumber: z.string().max(80).default(""),
  bankIfsc: z.string().max(40).default(""),
  bankSwift: z.string().max(40).default(""),
  additionalFields: z.array(additionalFieldSchema).max(30).default([]),
}).superRefine((data, ctx) => {
  const type = data.taxIdType.trim().toUpperCase();
  const value = data.taxIdValue.trim();
  if (!value) return;
  if (type === "GSTIN" && !isValidGstinOrUin(value)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["taxIdValue"],
      message: GSTIN_ERROR,
    });
  }
  if (type === "PAN" && !isValidPan(value)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["taxIdValue"],
      message: PAN_ERROR,
    });
  }
});

const EMPTY_PROFILE: OrganizationBillingProfile = {
  logoDataUrl: null,
  name: "",
  industry: "",
  businessType: "",
  location: "India",
  addressLine1: "",
  addressLine2: "",
  city: "",
  zip: "",
  state: "",
  phone: "",
  fax: "",
  website: "",
  differentPaymentAddress: false,
  paymentAddressLine1: "",
  paymentAddressLine2: "",
  paymentCity: "",
  paymentZip: "",
  paymentState: "",
  paymentCountry: "India",
  paymentPhone: "",
  primaryContactName: "",
  primaryContactEmail: "",
  baseCurrency: "INR",
  fiscalYear: "january_december",
  language: "en",
  timeZone: "Asia/Kolkata",
  dateFormat: "dd MMM yyyy",
  companyIdType: "CIN",
  companyIdValue: "",
  taxIdType: "GSTIN",
  taxIdValue: "",
  bankName: "",
  bankAccountName: "",
  bankAccountNumber: "",
  bankIfsc: "",
  bankSwift: "",
  additionalFields: [],
};

/** In-memory profiles for AUTH_DISABLED / no-Mongo local runs. */
const mockBillingByOrgId = new Map<number, OrganizationBillingProfile>();

function useMock() {
  return isAuthDisabled() || !hasMongoConfigured();
}

function canReadBillingProfile(user: {
  role?: string | null;
  permissions?: string[] | null;
}) {
  if (hasPermission(user, "invoices.manage")) return true;
  if (hasPermission(user, "customers.manage")) return true;
  if (String(user.role ?? "").toLowerCase() === "admin") return true;
  if (String(user.role ?? "").toLowerCase() === "client") return true;
  return false;
}

function canWriteBillingProfile(user: { role?: string | null }) {
  return String(user.role ?? "").toLowerCase() === "admin";
}

const taskStatusLabelField = z.string().trim().min(1).max(40);

const taskStatusLabelsSchema = z.object({
  todo: taskStatusLabelField,
  in_progress: taskStatusLabelField,
  review: taskStatusLabelField,
  done: taskStatusLabelField,
  deferred: taskStatusLabelField,
});

function toTaskStatusLabelsResponse(labels: TaskStatusLabels, canEdit: boolean) {
  return { labels, canEdit };
}

const pipelineStageLabelsSchema = z.record(z.string().min(1).max(64), z.string().max(80));

function toPipelineStageLabelsResponse(
  overrides: Record<string, string> | null | undefined,
  canEdit: boolean,
) {
  const sparse = sparsePipelineLabelOverrides(overrides);
  const stages = resolvePipelineStages(null, sparse);
  return {
    overrides: sparse,
    labels: Object.fromEntries(stages.map((stage) => [stage.key, stage.label])),
    stages,
    canEdit,
  };
}

function normalizeProfile(
  profile: Partial<OrganizationBillingProfile> | null | undefined,
  fallbackName = "",
): OrganizationBillingProfile {
  return {
    ...EMPTY_PROFILE,
    ...(profile ?? {}),
    name: (profile?.name ?? fallbackName ?? "").trim(),
    bankName: (profile?.bankName ?? "").trim(),
    bankAccountName: (profile?.bankAccountName ?? "").trim(),
    bankAccountNumber: (profile?.bankAccountNumber ?? "").trim(),
    bankIfsc: (profile?.bankIfsc ?? "").trim(),
    bankSwift: (profile?.bankSwift ?? "").trim(),
    additionalFields: Array.isArray(profile?.additionalFields)
      ? profile!.additionalFields
      : [],
  };
}

function toClientProfile(
  orgId: number,
  profile: OrganizationBillingProfile,
  options?: { billingProfileSaved?: boolean },
) {
  return {
    organizationId: String(orgId),
    billingProfileSaved: options?.billingProfileSaved ?? false,
    ...profile,
  };
}

export const organizationRouter = createRouter({
  /** Shared company profile for invoices — admin writes, finance/admin read. */
  getBillingProfile: authedQuery.query(async ({ ctx }) => {
    if (!canReadBillingProfile(ctx.user)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "You do not have permission to view organization billing details",
      });
    }

    const orgId = requireOrganizationId(ctx.user);

    if (useMock()) {
      const stored = mockBillingByOrgId.get(orgId);
      return toClientProfile(
        orgId,
        normalizeProfile(
          { ...stored, baseCurrency: mockGetOrgCurrency() },
          Workspace.name,
        ),
        { billingProfileSaved: Boolean(stored) },
      );
    }

    await ensureSchema();
    const org = await findOrganizationById(orgId);
    if (!org) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found" });
    }

    return toClientProfile(
      orgId,
      normalizeProfile(org.billingProfile, org.name || Workspace.name),
      { billingProfileSaved: Boolean(org.billingProfile) },
    );
  }),

  updateBillingProfile: authedQuery
    .input(billingProfileSchema)
    .mutation(async ({ ctx, input }) => {
      if (!canWriteBillingProfile(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only admin can update organization billing details",
        });
      }

      const orgId = requireOrganizationId(ctx.user);
      const profile = normalizeProfile(input, input.name);

      if (useMock()) {
        mockSetOrgCurrency(profile.baseCurrency);
        mockBillingByOrgId.set(orgId, profile);
        return toClientProfile(orgId, profile, { billingProfileSaved: true });
      }

      await ensureSchema();
      const existing = await findById<OrganizationDoc>(Collections.organizations, orgId);
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found" });
      }

      const updated = await updateById<OrganizationDoc>(Collections.organizations, orgId, {
        name: profile.name.trim() || existing.name,
        billingProfile: profile,
        updatedAt: new Date(),
      });

      if (!updated) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found" });
      }

      return toClientProfile(
        orgId,
        normalizeProfile(updated.billingProfile, updated.name),
        { billingProfileSaved: true },
      );
    }),

  getWorkspaceCurrency: authedQuery.query(async ({ ctx }) => {
    const orgId = requireOrganizationId(ctx.user);
    if (useMock()) {
      return {
        currency: mockGetOrgCurrency(),
        canEdit: canWriteBillingProfile(ctx.user),
      };
    }

    await ensureSchema();
    const org = await findOrganizationById(orgId);
    if (!org) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found" });
    }

    return {
      currency: normalizeCurrencyCode(org.billingProfile?.baseCurrency),
      canEdit: canWriteBillingProfile(ctx.user),
    };
  }),

  updateWorkspaceCurrency: authedQuery
    .input(z.object({ currency: z.string().min(3).max(10) }))
    .mutation(async ({ ctx, input }) => {
      if (!canWriteBillingProfile(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only admin can update workspace currency",
        });
      }

      const orgId = requireOrganizationId(ctx.user);
      const currency = normalizeCurrencyCode(input.currency);

      if (useMock()) {
        mockSetOrgCurrency(currency);
        const stored = mockBillingByOrgId.get(orgId);
        const profile = normalizeProfile(
          { ...stored, baseCurrency: currency },
          stored?.name || Workspace.name,
        );
        mockBillingByOrgId.set(orgId, profile);
        return { currency, canEdit: true };
      }

      await ensureSchema();
      const existing = await findById<OrganizationDoc>(Collections.organizations, orgId);
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found" });
      }

      const profile = normalizeProfile(
        { ...existing.billingProfile, baseCurrency: currency },
        existing.name,
      );
      const updated = await updateById<OrganizationDoc>(Collections.organizations, orgId, {
        billingProfile: profile,
        updatedAt: new Date(),
      });
      if (!updated) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found" });
      }

      return {
        currency: normalizeCurrencyCode(updated.billingProfile?.baseCurrency),
        canEdit: true,
      };
    }),

  getTaskStatusLabels: authedQuery.query(async ({ ctx }) => {
    const orgId = requireOrganizationId(ctx.user);
    const canEdit = hasPermission(ctx.user, "settings.task_status");

    if (useMock()) {
      return toTaskStatusLabelsResponse(
        mergeTaskStatusLabels(mockGetTaskStatusLabels()),
        canEdit,
      );
    }

    await ensureSchema();
    const org = await findOrganizationById(orgId);
    if (!org) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found" });
    }

    return toTaskStatusLabelsResponse(
      mergeTaskStatusLabels(org.taskStatusLabels),
      canEdit,
    );
  }),

  updateTaskStatusLabels: authedQuery
    .input(taskStatusLabelsSchema)
    .mutation(async ({ ctx, input }) => {
      if (!hasPermission(ctx.user, "settings.task_status")) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have permission to edit task status names",
        });
      }

      const orgId = requireOrganizationId(ctx.user);
      const labels = mergeTaskStatusLabels(input);

      if (useMock()) {
        mockSetTaskStatusLabels(labels);
        return toTaskStatusLabelsResponse(labels, true);
      }

      await ensureSchema();
      const existing = await findById<OrganizationDoc>(Collections.organizations, orgId);
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found" });
      }

      const updated = await updateById<OrganizationDoc>(Collections.organizations, orgId, {
        taskStatusLabels: labels,
        updatedAt: new Date(),
      });
      if (!updated) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found" });
      }

      return toTaskStatusLabelsResponse(
        mergeTaskStatusLabels(updated.taskStatusLabels),
        true,
      );
    }),

  getPipelineStageLabels: authedQuery.query(async ({ ctx }) => {
    const orgId = requireOrganizationId(ctx.user);
    const canEdit = hasPermission(ctx.user, "settings.task_status");

    if (useMock()) {
      return toPipelineStageLabelsResponse(mockGetPipelineStageLabels(), canEdit);
    }

    await ensureSchema();
    const org = await findOrganizationById(orgId);
    if (!org) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found" });
    }

    return toPipelineStageLabelsResponse(org.pipelineStageLabelOverrides, canEdit);
  }),

  updatePipelineStageLabels: authedQuery
    .input(pipelineStageLabelsSchema)
    .mutation(async ({ ctx, input }) => {
      if (!hasPermission(ctx.user, "settings.task_status")) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have permission to edit task status names",
        });
      }

      const orgId = requireOrganizationId(ctx.user);
      const overrides = sparsePipelineLabelOverrides(input);

      if (useMock()) {
        mockSetPipelineStageLabels(overrides);
        return toPipelineStageLabelsResponse(overrides, true);
      }

      await ensureSchema();
      const existing = await findById<OrganizationDoc>(Collections.organizations, orgId);
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found" });
      }

      const updated = await updateById<OrganizationDoc>(Collections.organizations, orgId, {
        pipelineStageLabelOverrides: overrides,
        updatedAt: new Date(),
      });
      if (!updated) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found" });
      }

      return toPipelineStageLabelsResponse(updated.pipelineStageLabelOverrides, true);
    }),
});
