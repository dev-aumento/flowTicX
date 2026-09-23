import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { Collections } from "@db/mongo/collections";
import type {
  FormerEmployeeDoc,
  FormerEmployeeDocumentDoc,
} from "@db/mongo/types";
import { createRouter, authedQuery } from "./middleware";
import { ensureSchema } from "./lib/migrate";
import { isAuthDisabled } from "./lib/dev-mode";
import { orgFilter, requireOrganizationId, belongsToUserOrg } from "./lib/tenant";
import {
  findById,
  getCollection,
  hasMongoConfigured,
  insertDoc,
  updateById,
} from "./queries/connection";
import {
  deleteEmployeeDocumentFromGridFs,
  downloadEmployeeDocumentFromGridFs,
  uploadEmployeeDocumentToGridFs,
} from "./queries/employee-document-storage";
import { canManageLeaves } from "@/lib/leave-policy";
import { hasPermission } from "./lib/permissions";

const MAX_BASE64_CHARS = 70_000_000;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const dateKeySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const formerEmployeeInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.union([z.string().email().max(320), z.literal(""), z.null()]).optional(),
  department: z.string().max(120).nullable().optional(),
  position: z.string().max(120).nullable().optional(),
  joiningDate: dateKeySchema,
  resignationDate: dateKeySchema,
  servedNoticePeriod: z.boolean(),
  noticePeriodDays: z.number().int().min(0).max(365).nullable().optional(),
  lastWorkingDay: dateKeySchema,
  reasonForLeaving: z.string().trim().min(1).max(2000),
  notes: z.string().max(5000).nullable().optional(),
});

function assertHrOrAdmin(user: {
  role?: string | null;
  department?: string | null;
  permissions?: string[] | null;
}) {
  if (canManageLeaves(user) || hasPermission(user, "employees.manage")) return;
  throw new TRPCError({
    code: "FORBIDDEN",
    message: "You do not have permission to manage recent employees",
  });
}

function normalizeOptionalText(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
}

function normalizeEmail(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed.toLowerCase() : null;
}

type DocMeta = {
  id: number;
  formerEmployeeId: number;
  fileName: string;
  mimeType: string;
  fileSize: number;
  label: string | null;
  uploadedBy: number | null;
  createdAt: Date;
};

function toDocMeta(doc: FormerEmployeeDocumentDoc): DocMeta {
  return {
    id: doc.id,
    formerEmployeeId: doc.formerEmployeeId,
    fileName: doc.fileName,
    mimeType: doc.mimeType,
    fileSize: doc.fileSize,
    label: doc.label ?? null,
    uploadedBy: doc.uploadedBy,
    createdAt: doc.createdAt,
  };
}

const mockFormerEmployees: FormerEmployeeDoc[] = [];
const mockFormerDocs: FormerEmployeeDocumentDoc[] = [];
let mockFormerId = 1;
let mockFormerDocId = 1;

export const formerEmployeeRouter = createRouter({
  list: authedQuery
    .input(z.object({ search: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
      assertHrOrAdmin(ctx.user);

      if (isAuthDisabled() || !hasMongoConfigured()) {
        const search = input?.search?.trim().toLowerCase() ?? "";
        const employees = mockFormerEmployees
          .filter((e) => e.organizationId === (ctx.user.organizationId ?? 1))
          .filter((e) => {
            if (!search) return true;
            return (
              e.name.toLowerCase().includes(search) ||
              (e.email ?? "").toLowerCase().includes(search) ||
              (e.department ?? "").toLowerCase().includes(search) ||
              (e.reasonForLeaving ?? "").toLowerCase().includes(search)
            );
          })
          .sort((a, b) => b.lastWorkingDay.localeCompare(a.lastWorkingDay));
        return { employees };
      }

      await ensureSchema();
      const col = await getCollection<FormerEmployeeDoc>(Collections.formerEmployees);
      const filter: Record<string, unknown> = { ...orgFilter(ctx.user) };
      const search = input?.search?.trim();
      if (search) {
        const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
        filter.$or = [
          { name: regex },
          { email: regex },
          { department: regex },
          { position: regex },
          { reasonForLeaving: regex },
        ];
      }

      const employees = await col
        .find(filter)
        .sort({ lastWorkingDay: -1, createdAt: -1 })
        .toArray();
      return { employees };
    }),

  getById: authedQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      assertHrOrAdmin(ctx.user);

      if (isAuthDisabled() || !hasMongoConfigured()) {
        const employee = mockFormerEmployees.find(
          (e) => e.id === input.id && e.organizationId === (ctx.user.organizationId ?? 1),
        );
        return employee ?? null;
      }

      await ensureSchema();
      const employee = await findById<FormerEmployeeDoc>(
        Collections.formerEmployees,
        input.id,
      );
      if (!employee || !belongsToUserOrg(ctx.user, employee.organizationId)) {
        return null;
      }
      return employee;
    }),

  create: authedQuery
    .input(formerEmployeeInputSchema)
    .mutation(async ({ ctx, input }) => {
      assertHrOrAdmin(ctx.user);

      const payload = {
        name: input.name.trim(),
        email: normalizeEmail(input.email),
        department: normalizeOptionalText(input.department),
        position: normalizeOptionalText(input.position),
        joiningDate: input.joiningDate,
        resignationDate: input.resignationDate,
        servedNoticePeriod: input.servedNoticePeriod,
        noticePeriodDays: input.servedNoticePeriod
          ? input.noticePeriodDays ?? null
          : null,
        lastWorkingDay: input.lastWorkingDay,
        reasonForLeaving: input.reasonForLeaving.trim(),
        notes: normalizeOptionalText(input.notes),
      };

      if (isAuthDisabled() || !hasMongoConfigured()) {
        const now = new Date();
        const employee: FormerEmployeeDoc = {
          id: mockFormerId++,
          organizationId: ctx.user.organizationId ?? 1,
          ...payload,
          createdBy: ctx.user.id,
          createdAt: now,
          updatedAt: now,
        };
        mockFormerEmployees.unshift(employee);
        return { employee };
      }

      await ensureSchema();
      const now = new Date();
      const employee = await insertDoc<FormerEmployeeDoc>(Collections.formerEmployees, {
        organizationId: requireOrganizationId(ctx.user),
        ...payload,
        createdBy: ctx.user.id,
        createdAt: now,
        updatedAt: now,
      });
      return { employee };
    }),

  update: authedQuery
    .input(z.object({ id: z.number() }).merge(formerEmployeeInputSchema))
    .mutation(async ({ ctx, input }) => {
      assertHrOrAdmin(ctx.user);
      const { id, ...data } = input;

      const payload = {
        name: data.name.trim(),
        email: normalizeEmail(data.email),
        department: normalizeOptionalText(data.department),
        position: normalizeOptionalText(data.position),
        joiningDate: data.joiningDate,
        resignationDate: data.resignationDate,
        servedNoticePeriod: data.servedNoticePeriod,
        noticePeriodDays: data.servedNoticePeriod
          ? data.noticePeriodDays ?? null
          : null,
        lastWorkingDay: data.lastWorkingDay,
        reasonForLeaving: data.reasonForLeaving.trim(),
        notes: normalizeOptionalText(data.notes),
        updatedAt: new Date(),
      };

      if (isAuthDisabled() || !hasMongoConfigured()) {
        const employee = mockFormerEmployees.find(
          (e) => e.id === id && e.organizationId === (ctx.user.organizationId ?? 1),
        );
        if (!employee) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });
        }
        Object.assign(employee, payload);
        return { employee: { ...employee } };
      }

      await ensureSchema();
      const existing = await findById<FormerEmployeeDoc>(
        Collections.formerEmployees,
        id,
      );
      if (!existing || !belongsToUserOrg(ctx.user, existing.organizationId)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });
      }

      const employee = await updateById<FormerEmployeeDoc>(
        Collections.formerEmployees,
        id,
        payload,
      );
      return { employee };
    }),

  delete: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      assertHrOrAdmin(ctx.user);

      if (isAuthDisabled() || !hasMongoConfigured()) {
        const idx = mockFormerEmployees.findIndex(
          (e) => e.id === input.id && e.organizationId === (ctx.user.organizationId ?? 1),
        );
        if (idx < 0) return { success: false };
        mockFormerEmployees.splice(idx, 1);
        for (let i = mockFormerDocs.length - 1; i >= 0; i -= 1) {
          if (mockFormerDocs[i].formerEmployeeId === input.id) {
            mockFormerDocs.splice(i, 1);
          }
        }
        return { success: true };
      }

      await ensureSchema();
      const existing = await findById<FormerEmployeeDoc>(
        Collections.formerEmployees,
        input.id,
      );
      if (!existing || !belongsToUserOrg(ctx.user, existing.organizationId)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });
      }

      const docCol = await getCollection<FormerEmployeeDocumentDoc>(
        Collections.formerEmployeeDocuments,
      );
      const docs = await docCol.find({ formerEmployeeId: input.id }).toArray();
      for (const doc of docs) {
        await deleteEmployeeDocumentFromGridFs(doc.gridFsId);
      }
      await docCol.deleteMany({ formerEmployeeId: input.id });

      const col = await getCollection<FormerEmployeeDoc>(Collections.formerEmployees);
      await col.deleteOne({ id: input.id });
      return { success: true };
    }),

  listDocuments: authedQuery
    .input(z.object({ formerEmployeeId: z.number() }))
    .query(async ({ ctx, input }) => {
      assertHrOrAdmin(ctx.user);

      if (isAuthDisabled() || !hasMongoConfigured()) {
        return {
          documents: mockFormerDocs
            .filter((d) => d.formerEmployeeId === input.formerEmployeeId)
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
            .map(toDocMeta),
        };
      }

      await ensureSchema();
      const employee = await findById<FormerEmployeeDoc>(
        Collections.formerEmployees,
        input.formerEmployeeId,
      );
      if (!employee || !belongsToUserOrg(ctx.user, employee.organizationId)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });
      }

      const col = await getCollection<FormerEmployeeDocumentDoc>(
        Collections.formerEmployeeDocuments,
      );
      const documents = await col
        .find({ formerEmployeeId: input.formerEmployeeId, ...orgFilter(ctx.user) })
        .sort({ createdAt: -1 })
        .toArray();
      return { documents: documents.map(toDocMeta) };
    }),

  uploadDocument: authedQuery
    .input(
      z.object({
        formerEmployeeId: z.number(),
        fileName: z.string().min(1).max(500),
        mimeType: z.string().max(255).default("application/octet-stream"),
        fileSize: z.number().int().nonnegative(),
        label: z.string().max(120).nullable().optional(),
        dataBase64: z.string().min(1).max(MAX_BASE64_CHARS),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertHrOrAdmin(ctx.user);

      const approxBytes = Math.floor((input.dataBase64.length * 3) / 4);
      if (approxBytes > MAX_FILE_BYTES || input.fileSize > MAX_FILE_BYTES) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "File is too large. Maximum size is 20 MB.",
        });
      }

      if (isAuthDisabled() || !hasMongoConfigured()) {
        const now = new Date();
        const doc: FormerEmployeeDocumentDoc = {
          id: mockFormerDocId++,
          organizationId: ctx.user.organizationId ?? 1,
          formerEmployeeId: input.formerEmployeeId,
          fileName: input.fileName,
          mimeType: input.mimeType,
          fileSize: input.fileSize,
          label: input.label?.trim() || null,
          gridFsId: `mock_former_${mockFormerDocId}`,
          uploadedBy: ctx.user.id,
          createdAt: now,
        };
        mockFormerDocs.unshift(doc);
        return toDocMeta(doc);
      }

      await ensureSchema();
      const employee = await findById<FormerEmployeeDoc>(
        Collections.formerEmployees,
        input.formerEmployeeId,
      );
      if (!employee || !belongsToUserOrg(ctx.user, employee.organizationId)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });
      }

      const stored = await uploadEmployeeDocumentToGridFs({
        fileName: input.fileName,
        mimeType: input.mimeType,
        dataBase64: input.dataBase64,
      });

      const doc = await insertDoc<FormerEmployeeDocumentDoc>(
        Collections.formerEmployeeDocuments,
        {
          organizationId: requireOrganizationId(ctx.user),
          formerEmployeeId: input.formerEmployeeId,
          fileName: input.fileName.trim(),
          mimeType: input.mimeType || "application/octet-stream",
          fileSize: input.fileSize || stored.byteLength,
          label: input.label?.trim() || null,
          gridFsId: stored.gridFsId,
          uploadedBy: ctx.user.id,
          createdAt: new Date(),
        },
      );
      return toDocMeta(doc);
    }),

  getDocument: authedQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      assertHrOrAdmin(ctx.user);

      if (isAuthDisabled() || !hasMongoConfigured()) {
        const doc = mockFormerDocs.find((d) => d.id === input.id);
        if (!doc) return null;
        return { ...toDocMeta(doc), dataBase64: "" };
      }

      await ensureSchema();
      const doc = await findById<FormerEmployeeDocumentDoc>(
        Collections.formerEmployeeDocuments,
        input.id,
      );
      if (!doc || !belongsToUserOrg(ctx.user, doc.organizationId)) return null;

      const buffer = await downloadEmployeeDocumentFromGridFs(doc.gridFsId);
      return { ...toDocMeta(doc), dataBase64: buffer.toString("base64") };
    }),

  deleteDocument: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      assertHrOrAdmin(ctx.user);

      if (isAuthDisabled() || !hasMongoConfigured()) {
        const idx = mockFormerDocs.findIndex((d) => d.id === input.id);
        if (idx < 0) return { success: false };
        mockFormerDocs.splice(idx, 1);
        return { success: true };
      }

      await ensureSchema();
      const col = await getCollection<FormerEmployeeDocumentDoc>(
        Collections.formerEmployeeDocuments,
      );
      const doc = await findById<FormerEmployeeDocumentDoc>(
        Collections.formerEmployeeDocuments,
        input.id,
      );
      if (!doc || !belongsToUserOrg(ctx.user, doc.organizationId)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Document not found" });
      }
      await deleteEmployeeDocumentFromGridFs(doc.gridFsId);
      await col.deleteOne({ id: doc.id });
      return { success: true };
    }),
});
