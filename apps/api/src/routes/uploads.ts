import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ok } from "../lib/http.js";
import { requireAuth } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import { validateBody, validateParams } from "../middleware/validate.js";
import { AppError } from "../lib/errors.js";
import { triggerDocumentPendingNotification } from "../services/notification.service.js";
import {
  createDocumentDownloadUrl,
  createDocumentUploadUrl,
  STORAGE_BUCKET_NAME
} from "../services/storage/supabaseStorage.js";

export const uploadsRouter = Router();

const createUploadSchema = z.object({
  leadId: z.string().uuid(),
  fileName: z.string().min(1),
  mimeType: z.string().min(3),
  sizeBytes: z.number().int().positive()
});

const documentIdParamSchema = z.object({
  documentId: z.string().uuid()
});

uploadsRouter.post("/presign", requireAuth, validateBody(createUploadSchema), async (req, res) => {
  const parsed = req.body as z.infer<typeof createUploadSchema>;

  const fileKey = `leads/${parsed.leadId}/${randomUUID()}-${parsed.fileName}`;
  const uploadUrl = await createDocumentUploadUrl(fileKey);

  const document = await prisma.document.create({
    data: {
      leadId: parsed.leadId,
      category: "general",
      s3Key: fileKey,
      fileName: parsed.fileName,
      fileType: parsed.mimeType,
      fileSize: parsed.sizeBytes,
      uploadedByUserId: req.user?.id
    }
  });

  await triggerDocumentPendingNotification({
    leadId: parsed.leadId,
    documentId: document.id,
    fileName: parsed.fileName,
    uploadedByUserId: req.user?.id
  });

  return ok(res, {
    uploadUrl,
    fileKey,
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
        s3Key: true,
        fileName: true,
        fileType: true
      }
    });

    if (!document) {
      throw new AppError(404, "NOT_FOUND", "Document not found");
    }

    const downloadUrl = await createDocumentDownloadUrl(document.s3Key, 300);

    return ok(res, {
      documentId: document.id,
      fileName: document.fileName,
      fileType: document.fileType,
      downloadUrl
    });
  }
);
