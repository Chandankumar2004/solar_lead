import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ok } from "../lib/http.js";
import { env } from "../config/env.js";
import { requireAuth } from "../middleware/auth.js";
import { allowRoles } from "../middleware/rbac.js";
import { prisma } from "../lib/prisma.js";
import { validateBody, validateParams } from "../middleware/validate.js";
import { AppError } from "../lib/errors.js";
import {
  createDocumentDownloadUrl,
  createDocumentUploadUrl,
  STORAGE_BUCKET_NAME
} from "../services/storage/supabaseStorage.js";
import { type LeadAccessActor, scopeLeadWhere } from "../services/lead-access.service.js";

export const uploadsRouter = Router();
const DOCUMENT_SIGNED_URL_EXPIRES_SECONDS = env.DOCUMENT_SIGNED_URL_EXPIRES_SECONDS;
const MAX_DOCUMENT_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png"
]);

const createUploadSchema = z.object({
  leadId: z.string().uuid(),
  fileName: z.string().min(1),
  category: z.string().trim().min(2).max(80).optional(),
  mimeType: z.string().min(3),
  sizeBytes: z.number().int().positive()
});

const documentIdParamSchema = z.object({
  documentId: z.string().uuid()
});

function assertFileTypeAndSize(mimeType: string, sizeBytes: number) {
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new AppError(
      400,
      "INVALID_FILE_TYPE",
      `Unsupported file type. Allowed: ${[...ALLOWED_MIME_TYPES].join(", ")}`
    );
  }
  if (sizeBytes > MAX_DOCUMENT_SIZE_BYTES) {
    throw new AppError(
      400,
      "FILE_TOO_LARGE",
      `File size exceeds limit of ${MAX_DOCUMENT_SIZE_BYTES} bytes`
    );
  }
}

function sanitizeFileName(fileName: string) {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function normalizeCategory(category: string) {
  const normalized = category
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_-]/g, "_");
  return normalized.length >= 2 ? normalized : "general";
}

async function assertLeadAccessible(leadId: string, actor: LeadAccessActor) {
  const lead = await prisma.lead.findFirst({
    where: scopeLeadWhere(actor, { id: leadId }),
    select: { id: true }
  });
  if (!lead) {
    throw new AppError(404, "NOT_FOUND", "Lead not found");
  }
}

uploadsRouter.use(allowRoles("SUPER_ADMIN", "ADMIN", "DISTRICT_MANAGER", "FIELD_EXECUTIVE"));

uploadsRouter.post("/presign", requireAuth, validateBody(createUploadSchema), async (req, res) => {
  const parsed = req.body as z.infer<typeof createUploadSchema>;
  assertFileTypeAndSize(parsed.mimeType, parsed.sizeBytes);
  await assertLeadAccessible(parsed.leadId, req.user!);

  const safeCategory = normalizeCategory(parsed.category ?? "general");
  const safeFileName = sanitizeFileName(parsed.fileName);
  const timestamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
  const fileKey = `leads/${parsed.leadId}/documents/${safeCategory}/${timestamp}_${randomUUID()}_${safeFileName}`;
  const uploadUrl = await createDocumentUploadUrl(fileKey);

  return ok(res, {
    uploadUrl,
    storagePath: fileKey,
    s3Key: fileKey,
    fileKey,
    expiresInSeconds: DOCUMENT_SIGNED_URL_EXPIRES_SECONDS,
    bucket: STORAGE_BUCKET_NAME
  });
});

uploadsRouter.get(
  "/:documentId/download-url",
  requireAuth,
  validateParams(documentIdParamSchema),
  async (req, res) => {
    const { documentId } = req.params as z.infer<typeof documentIdParamSchema>;
    const document = await prisma.document.findUnique({
      where: { id: documentId },
      select: {
        id: true,
        leadId: true,
        s3Key: true,
        fileName: true,
        fileType: true
      }
    });

    if (!document) {
      throw new AppError(404, "NOT_FOUND", "Document not found");
    }
    if (req.user!.role !== "SUPER_ADMIN" && req.user!.role !== "ADMIN") {
      const lead = await prisma.lead.findFirst({
        where: scopeLeadWhere(req.user!, { id: document.leadId }),
        select: { id: true }
      });
      if (!lead) {
        throw new AppError(404, "NOT_FOUND", "Document not found");
      }
    }

    const downloadUrl = await createDocumentDownloadUrl(
      document.s3Key,
      DOCUMENT_SIGNED_URL_EXPIRES_SECONDS
    );

    return ok(res, {
      documentId: document.id,
      leadId: document.leadId,
      fileName: document.fileName,
      fileType: document.fileType,
      downloadUrl,
      expiresInSeconds: DOCUMENT_SIGNED_URL_EXPIRES_SECONDS
    });
  }
);
