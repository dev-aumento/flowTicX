import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { Collections } from "@db/mongo/collections";
import type { EmployeeDocumentDoc, UserDoc } from "@db/mongo/types";
import { createRouter, authedQuery } from "./middleware";
import { ensureSchema } from "./lib/migrate";
import { isAuthDisabled } from "./lib/dev-mode";
import { hasPermission } from "./lib/permissions";
import { belongsToUserOrg, orgFilter, requireOrganizationId } from "./lib/tenant";
import {
  findById,
  getCollection,
  hasMongoConfigured,
  insertDoc,
} from "./queries/connection";
import {
  deleteEmployeeDocumentFromGridFs,
  downloadEmployeeDocumentFromGridFs,
  uploadEmployeeDocumentToGridFs,
} from "./queries/employee-document-storage";

const MAX_BASE64_CHARS = 70_000_000;
const MAX_FILE_BYTES = 20 * 1024 * 1024;

type DocMeta = {
  id: number;
  userId: number;
  fileName: string;
  mimeType: string;
  fileSize: number;
  label: string | null;
  uploadedBy: number | null;
  createdAt: Date;
};

function toMeta(doc: EmployeeDocumentDoc): DocMeta {
  return {
    id: doc.id,
    userId: doc.userId,
    fileName: doc.fileName,
    mimeType: doc.mimeType,
    fileSize: doc.fileSize,
    label: doc.label ?? null,
    uploadedBy: doc.uploadedBy,
    createdAt: doc.createdAt,
  };
}

function canAccessUserDocuments(
  actor: { id: number; role?: string | null; permissions?: string[] },
  targetUserId: number,
) {
  if (actor.id === targetUserId) return true;
  return hasPermission(actor, "employees.manage");
}

async function assertTargetUser(actor: UserDoc | { id: number; organizationId: number | null; role: string; permissions?: string[] }, targetUserId: number) {
  if (!canAccessUserDocuments(actor, targetUserId)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You do not have permission to manage these documents",
    });
  }

  const target = await findById<UserDoc>(Collections.users, targetUserId);
  if (!target || !belongsToUserOrg(actor, target.organizationId)) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Employee not found" });
  }
  return target;
}

const mockDocs: EmployeeDocumentDoc[] = [];
let mockDocId = 1;

export const personalDocumentRouter = createRouter({
  list: authedQuery
    .input(z.object({ userId: z.number().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const targetUserId = input?.userId ?? ctx.user.id;

      if (isAuthDisabled() || !hasMongoConfigured()) {
        if (!canAccessUserDocuments(ctx.user, targetUserId)) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Forbidden" });
        }
        return {
          documents: mockDocs
            .filter((d) => d.userId === targetUserId)
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
            .map(toMeta),
        };
      }

      await ensureSchema();
      await assertTargetUser(ctx.user, targetUserId);

      const col = await getCollection<EmployeeDocumentDoc>(Collections.employeeDocuments);
      const documents = await col
        .find({ userId: targetUserId, ...orgFilter(ctx.user) })
        .sort({ createdAt: -1 })
        .toArray();

      return { documents: documents.map(toMeta) };
    }),

  upload: authedQuery
    .input(
      z.object({
        userId: z.number().optional(),
        fileName: z.string().min(1).max(500),
        mimeType: z.string().max(255).default("application/octet-stream"),
        fileSize: z.number().int().nonnegative(),
        label: z.string().max(120).nullable().optional(),
        dataBase64: z.string().min(1).max(MAX_BASE64_CHARS),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const targetUserId = input.userId ?? ctx.user.id;

      if (isAuthDisabled() || !hasMongoConfigured()) {
        if (!canAccessUserDocuments(ctx.user, targetUserId)) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Forbidden" });
        }
        const now = new Date();
        const doc: EmployeeDocumentDoc = {
          id: mockDocId++,
          organizationId: ctx.user.organizationId ?? 1,
          userId: targetUserId,
          fileName: input.fileName,
          mimeType: input.mimeType,
          fileSize: input.fileSize,
          label: input.label?.trim() || null,
          gridFsId: `mock_${mockDocId}`,
          uploadedBy: ctx.user.id,
          createdAt: now,
        };
        mockDocs.unshift(doc);
        return toMeta(doc);
      }

      await ensureSchema();
      await assertTargetUser(ctx.user, targetUserId);

      const approxBytes = Math.floor((input.dataBase64.length * 3) / 4);
      if (approxBytes > MAX_FILE_BYTES || input.fileSize > MAX_FILE_BYTES) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "File is too large. Maximum size is 20 MB.",
        });
      }

      const stored = await uploadEmployeeDocumentToGridFs({
        fileName: input.fileName,
        mimeType: input.mimeType,
        dataBase64: input.dataBase64,
      });

      const doc = await insertDoc<EmployeeDocumentDoc>(Collections.employeeDocuments, {
        organizationId: requireOrganizationId(ctx.user),
        userId: targetUserId,
        fileName: input.fileName.trim(),
        mimeType: input.mimeType || "application/octet-stream",
        fileSize: input.fileSize || stored.byteLength,
        label: input.label?.trim() || null,
        gridFsId: stored.gridFsId,
        uploadedBy: ctx.user.id,
        createdAt: new Date(),
      });

      return toMeta(doc);
    }),

  get: authedQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      if (isAuthDisabled() || !hasMongoConfigured()) {
        const doc = mockDocs.find((d) => d.id === input.id);
        if (!doc || !canAccessUserDocuments(ctx.user, doc.userId)) return null;
        return { ...toMeta(doc), dataBase64: "" };
      }

      await ensureSchema();
      const doc = await findById<EmployeeDocumentDoc>(
        Collections.employeeDocuments,
        input.id,
      );
      if (!doc || !belongsToUserOrg(ctx.user, doc.organizationId)) return null;
      if (!canAccessUserDocuments(ctx.user, doc.userId)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Forbidden" });
      }

      const buffer = await downloadEmployeeDocumentFromGridFs(doc.gridFsId);
      return {
        ...toMeta(doc),
        dataBase64: buffer.toString("base64"),
      };
    }),

  delete: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (isAuthDisabled() || !hasMongoConfigured()) {
        const idx = mockDocs.findIndex((d) => d.id === input.id);
        if (idx < 0) return { success: false };
        const doc = mockDocs[idx];
        if (!canAccessUserDocuments(ctx.user, doc.userId)) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Forbidden" });
        }
        mockDocs.splice(idx, 1);
        return { success: true };
      }

      await ensureSchema();
      const col = await getCollection<EmployeeDocumentDoc>(Collections.employeeDocuments);
      const doc = await findById<EmployeeDocumentDoc>(
        Collections.employeeDocuments,
        input.id,
      );
      if (!doc || !belongsToUserOrg(ctx.user, doc.organizationId)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Document not found" });
      }
      if (!canAccessUserDocuments(ctx.user, doc.userId)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Forbidden" });
      }

      await deleteEmployeeDocumentFromGridFs(doc.gridFsId);
      await col.deleteOne({ id: doc.id });
      return { success: true };
    }),
});
