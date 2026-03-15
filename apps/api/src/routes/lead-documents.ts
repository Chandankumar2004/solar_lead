import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { created, ok } from "../lib/http.js";
import { AppError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { allowRoles } from "../middleware/rbac.js";
import { validateBody, validateParams, validateQuery } from "../middleware/validate.js";
import { createAuditLog, requestIp } from "../services/audit-log.service.js";
import { triggerDocumentPendingNotification } from "../services/notification.service.js";
import {
  createDocumentUploadUrl,
  STORAGE_BUCKET_NAME
} from "../services/storage/supabaseStorage.js";
import { type LeadAccessActor, scopeLeadWhere } from "../services/lead-access.service.js";

export const leadDocumentsRouter = Router({ mergeParams: true });

const PRESIGNED_URL_TTL_SECONDS = 300;
const MAX_DOCUMENT_SIZE_BYTES = 10 * 1024 * 1024;
const SITE_PHOTO_ALLOWED_MAX = 10;
const SITE_PHOTO_CATEGORY_PREFIXES = ["site_photo", "site_photograph"] as const;
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png"
]);

const leadIdParamSchema = z.object({
  leadId: z.string().uuid()
});

const createPresignSchema = z.object({
  category: z.string().trim().min(2).max(80),
  fileName: z.string().trim().min(1).max(255),
  fileType: z.string().trim().min(3).max(120),
  fileSize: z.coerce.number().int().positive()
});

const completeDocumentSchema = z
  .object({
    category: z.string().trim().min(2).max(80),
    storagePath: z.string().trim().min(10).max(1024).optional(),
    s3Key: z.string().trim().min(10).max(1024).optional(),
    fileName: z.string().trim().min(1).max(255),
    fileType: z.string().trim().min(3).max(120),
    fileSize: z.coerce.number().int().positive()
  })
  .superRefine((value, ctx) => {
    if (!value.storagePath && !value.s3Key) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "storagePath is required"
      });
    }
  });

const listDocumentsQuerySchema = z.object({
  category: z.string().trim().min(2).max(80).optional(),
  latestOnly: z
    .string()
    .optional()
    .transform((value) => value === "true")
});

function sanitizeFileName(fileName: string) {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function normalizeCategory(category: string) {
  return category.trim().toLowerCase().replace(/\s+/g, "_");
}

function isSitePhotoCategory(category: string) {
  const normalized = normalizeCategory(category);
  return SITE_PHOTO_CATEGORY_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function sitePhotoCategoryFilters(): Prisma.StringFilter[] {
  return SITE_PHOTO_CATEGORY_PREFIXES.map((prefix) => ({
    startsWith: prefix,
    mode: "insensitive"
  }));
}

function assertFileTypeAndSize(fileType: string, fileSize: number) {
  if (!ALLOWED_MIME_TYPES.has(fileType)) {
    throw new AppError(
      400,
      "INVALID_FILE_TYPE",
      `Unsupported file type. Allowed: ${[...ALLOWED_MIME_TYPES].join(", ")}`
    );
  }
  if (fileSize > MAX_DOCUMENT_SIZE_BYTES) {
    throw new AppError(
      400,
      "FILE_TOO_LARGE",
      `File size exceeds limit of ${MAX_DOCUMENT_SIZE_BYTES} bytes`
    );
  }
}

async function ensureLeadExists(leadId: string, actor: LeadAccessActor) {
  const lead = await prisma.lead.findFirst({
    where: scopeLeadWhere(actor, { id: leadId }),
    select: { id: true }
  });
  if (!lead) {
    throw new AppError(404, "NOT_FOUND", "Lead not found");
  }
}

async function createVersionedDocument(input: {
  leadId: string;
  category: string;
  s3Key: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  uploadedByUserId?: string | null;
}) {
  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      const created = await prisma.$transaction(async (tx) => {
        const versionAgg = await tx.document.aggregate({
          where: {
            leadId: input.leadId,
            category: input.category
          },
          _max: { version: true }
        });
        const nextVersion = (versionAgg._max.version ?? 0) + 1;

        await tx.document.updateMany({
          where: {
            leadId: input.leadId,
            category: input.category,
            isLatest: true
          },
          data: {
            isLatest: false
          }
        });

        return tx.document.create({
          data: {
            leadId: input.leadId,
            category: input.category,
            s3Key: input.s3Key,
            fileName: input.fileName,
            fileType: input.fileType,
            fileSize: input.fileSize,
            version: nextVersion,
            isLatest: true,
            uploadedByUserId: input.uploadedByUserId ?? null
          }
        });
      });

      return created;
    } catch (error) {
      const isUniqueVersionConflict =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002";
      if (isUniqueVersionConflict && attempt < maxRetries) {
        continue;
      }
      throw error;
    }
  }

  throw new AppError(500, "DOCUMENT_VERSIONING_FAILED", "Could not allocate document version");
}

leadDocumentsRouter.use(
  allowRoles("SUPER_ADMIN", "ADMIN", "DISTRICT_MANAGER", "FIELD_EXECUTIVE")
);

leadDocumentsRouter.post(
  "/presign",
  validateParams(leadIdParamSchema),
  validateBody(createPresignSchema),
  async (req, res) => {
    const { leadId } = req.params as z.infer<typeof leadIdParamSchema>;
    const body = req.body as z.infer<typeof createPresignSchema>;

    assertFileTypeAndSize(body.fileType, body.fileSize);
    await ensureLeadExists(leadId, req.user!);

    const safeCategory = normalizeCategory(body.category).replace(/[^a-z0-9_-]/g, "_");
    const safeFileName = sanitizeFileName(body.fileName);
    const s3Key = `leads/${leadId}/documents/${safeCategory}/${randomUUID()}-${safeFileName}`;
    const uploadUrl = await createDocumentUploadUrl(s3Key);

    return ok(
      res,
      {
        uploadUrl,
        storagePath: s3Key,
        s3Key,
        expiresInSeconds: PRESIGNED_URL_TTL_SECONDS,
        bucket: STORAGE_BUCKET_NAME
      },
      "Document upload URL generated"
    );
  }
);

leadDocumentsRouter.post(
  "/complete",
  validateParams(leadIdParamSchema),
  validateBody(completeDocumentSchema),
  async (req, res) => {
    const { leadId } = req.params as z.infer<typeof leadIdParamSchema>;
    const body = req.body as z.infer<typeof completeDocumentSchema>;
    const storagePath = body.storagePath ?? body.s3Key;

    if (!storagePath) {
      throw new AppError(400, "INVALID_STORAGE_PATH", "storagePath is required");
    }

    assertFileTypeAndSize(body.fileType, body.fileSize);
    await ensureLeadExists(leadId, req.user!);

    if (isSitePhotoCategory(body.category)) {
      const [existingLatestForSameCategory, sitePhotoLatestCount] = await Promise.all([
        prisma.document.findFirst({
          where: {
            leadId,
            isLatest: true,
            category: {
              equals: body.category,
              mode: "insensitive"
            }
          },
          select: { id: true }
        }),
        prisma.document.count({
          where: {
            leadId,
            isLatest: true,
            OR: sitePhotoCategoryFilters().map((category) => ({ category }))
          }
        })
      ]);

      if (!existingLatestForSameCategory && sitePhotoLatestCount >= SITE_PHOTO_ALLOWED_MAX) {
        throw new AppError(
          400,
          "SITE_PHOTO_LIMIT_REACHED",
          `A maximum of ${SITE_PHOTO_ALLOWED_MAX} site photographs is allowed for this lead`
        );
      }
    }

    const expectedPrefix = `leads/${leadId}/documents/`;
    if (!storagePath.startsWith(expectedPrefix)) {
      throw new AppError(
        400,
        "INVALID_STORAGE_PATH",
        "storagePath must match the expected lead documents path"
      );
    }

    const document = await createVersionedDocument({
      leadId,
      category: body.category,
      s3Key: storagePath,
      fileName: body.fileName,
      fileType: body.fileType,
      fileSize: body.fileSize,
      uploadedByUserId: req.user?.id
    });

    await createAuditLog({
      actorUserId: req.user?.id,
      action: "LEAD_DOCUMENT_COMPLETED",
      entityType: "document",
      entityId: document.id,
      detailsJson: {
        leadId,
        category: document.category,
        version: document.version,
        isLatest: document.isLatest,
        fileName: document.fileName,
        fileType: document.fileType
      },
      ipAddress: requestIp(req)
    });

    await triggerDocumentPendingNotification({
      leadId,
      documentId: document.id,
      fileName: document.fileName,
      uploadedByUserId: req.user?.id
    });

    return created(res, document, "Document metadata stored");
  }
);

leadDocumentsRouter.get(
  "/",
  validateParams(leadIdParamSchema),
  validateQuery(listDocumentsQuerySchema),
  async (req, res) => {
    const { leadId } = req.params as z.infer<typeof leadIdParamSchema>;
    const query = req.query as unknown as z.infer<typeof listDocumentsQuerySchema>;

    await ensureLeadExists(leadId, req.user!);

    const documents = await prisma.document.findMany({
      where: {
        leadId,
        ...(query.category ? { category: query.category } : {}),
        ...(query.latestOnly ? { isLatest: true } : {})
      },
      orderBy: [{ category: "asc" }, { version: "desc" }, { createdAt: "desc" }],
      include: {
        uploadedByUser: {
          select: { id: true, fullName: true, email: true }
        },
        reviewedByUser: {
          select: { id: true, fullName: true, email: true }
        }
      }
    });

    return ok(res, documents, "Lead documents fetched");
  }
);
