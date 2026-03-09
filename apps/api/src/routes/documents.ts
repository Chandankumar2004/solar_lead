import { DocumentReviewStatus, Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { ok } from "../lib/http.js";
import { AppError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { allowRoles } from "../middleware/rbac.js";
import { validateBody, validateParams, validateQuery } from "../middleware/validate.js";
import { createAuditLog, requestIp } from "../services/audit-log.service.js";
import { notifyUsers } from "../services/notification.service.js";
import { createDocumentDownloadUrl } from "../services/storage/supabaseStorage.js";

export const documentsRouter = Router();

const PRESIGNED_URL_TTL_SECONDS = 300;

const documentIdParamSchema = z.object({
  id: z.string().uuid()
});

const reviewListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(10),
    status: z.nativeEnum(DocumentReviewStatus).optional(),
    districtId: z.string().uuid().optional(),
    executiveId: z.string().uuid().optional(),
    leadId: z.string().uuid().optional(),
    category: z.string().trim().min(2).max(80).optional(),
    search: z.string().trim().optional(),
    dateFrom: z.string().trim().optional(),
    dateTo: z.string().trim().optional()
  })
  .transform((value) => ({
    ...value,
    status: value.status ?? "PENDING"
  }));

const reviewActionSchema = z
  .object({
    action: z.enum(["verify", "reject"]),
    notes: z.union([z.string().trim().max(500), z.literal(""), z.null()]).optional()
  })
  .superRefine((value, ctx) => {
    if (value.action === "reject" && (!value.notes || value.notes.trim().length < 5)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["notes"],
        message: "Rejection notes are required (minimum 5 characters)"
      });
    }
  })
  .transform((value) => ({
    action: value.action,
    notes: value.notes && value.notes.trim().length ? value.notes.trim() : null
  }));

function parseDateBoundary(
  raw: string | undefined,
  field: "dateFrom" | "dateTo"
) {
  if (!raw) return undefined;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw new AppError(400, "VALIDATION_ERROR", `${field} must be a valid date`);
  }
  if (!raw.includes("T")) {
    if (field === "dateFrom") {
      date.setHours(0, 0, 0, 0);
    } else {
      date.setHours(23, 59, 59, 999);
    }
  }
  return date;
}

documentsRouter.get(
  "/review",
  allowRoles("SUPER_ADMIN", "ADMIN", "DISTRICT_MANAGER"),
  validateQuery(reviewListQuerySchema),
  async (req, res) => {
    const query = req.query as unknown as z.infer<typeof reviewListQuerySchema>;
    const dateFrom = parseDateBoundary(query.dateFrom, "dateFrom");
    const dateTo = parseDateBoundary(query.dateTo, "dateTo");

    if (dateFrom && dateTo && dateFrom > dateTo) {
      throw new AppError(400, "VALIDATION_ERROR", "dateFrom cannot be greater than dateTo");
    }

    const whereClauses: Prisma.DocumentWhereInput[] = [{ reviewStatus: query.status }];

    if (query.districtId) {
      whereClauses.push({
        lead: {
          is: {
            districtId: query.districtId
          }
        }
      });
    }

    if (query.executiveId) {
      whereClauses.push({
        lead: {
          is: {
            assignedExecutiveId: query.executiveId
          }
        }
      });
    }

    if (query.leadId) {
      whereClauses.push({ leadId: query.leadId });
    }

    if (query.category) {
      whereClauses.push({
        category: { equals: query.category, mode: "insensitive" }
      });
    }

    if (query.search) {
      whereClauses.push({
        OR: [
          {
            fileName: { contains: query.search, mode: "insensitive" }
          },
          {
            lead: {
              is: {
                name: { contains: query.search, mode: "insensitive" }
              }
            }
          },
          {
            lead: {
              is: {
                phone: { contains: query.search, mode: "insensitive" }
              }
            }
          },
          {
            lead: {
              is: {
                externalId: { equals: query.search }
              }
            }
          }
        ]
      });
    }

    if (dateFrom || dateTo) {
      whereClauses.push({
        createdAt: {
          ...(dateFrom ? { gte: dateFrom } : {}),
          ...(dateTo ? { lte: dateTo } : {})
        }
      });
    }

    const where: Prisma.DocumentWhereInput =
      whereClauses.length > 0 ? { AND: whereClauses } : {};

    const skip = (query.page - 1) * query.pageSize;
    const [total, documents] = await prisma.$transaction([
      prisma.document.count({ where }),
      prisma.document.findMany({
        where,
        skip,
        take: query.pageSize,
        orderBy: { createdAt: "desc" },
        include: {
          lead: {
            select: {
              id: true,
              externalId: true,
              name: true,
              phone: true,
              district: {
                select: { id: true, name: true, state: true }
              },
              assignedExecutive: {
                select: { id: true, fullName: true, email: true }
              }
            }
          },
          uploadedByUser: {
            select: { id: true, fullName: true, email: true }
          },
          reviewedByUser: {
            select: { id: true, fullName: true, email: true }
          }
        }
      })
    ]);

    return ok(
      res,
      documents,
      "Document review queue fetched",
      {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / query.pageSize)
      }
    );
  }
);

documentsRouter.post(
  "/:id/review",
  allowRoles("SUPER_ADMIN", "ADMIN", "DISTRICT_MANAGER"),
  validateParams(documentIdParamSchema),
  validateBody(reviewActionSchema),
  async (req, res) => {
    const { id } = req.params as z.infer<typeof documentIdParamSchema>;
    const body = req.body as z.infer<typeof reviewActionSchema>;

    const existing = await prisma.document.findUnique({
      where: { id },
      include: {
        lead: {
          select: {
            id: true,
            externalId: true,
            assignedExecutiveId: true
          }
        }
      }
    });
    if (!existing) {
      throw new AppError(404, "NOT_FOUND", "Document not found");
    }

    const nextStatus: DocumentReviewStatus =
      body.action === "verify" ? "VERIFIED" : "REJECTED";

    const updated = await prisma.document.update({
      where: { id },
      data: {
        reviewStatus: nextStatus,
        reviewNotes: body.notes,
        reviewedByUserId: req.user!.id,
        reviewedAt: new Date()
      },
      include: {
        lead: {
          select: {
            id: true,
            externalId: true,
            name: true,
            assignedExecutiveId: true,
            assignedExecutive: {
              select: { id: true, fullName: true, email: true }
            }
          }
        },
        reviewedByUser: {
          select: { id: true, fullName: true, email: true }
        },
        uploadedByUser: {
          select: { id: true, fullName: true, email: true }
        }
      }
    });

    await createAuditLog({
      actorUserId: req.user!.id,
      action: nextStatus === "VERIFIED" ? "DOCUMENT_VERIFIED" : "DOCUMENT_REJECTED",
      entityType: "document",
      entityId: updated.id,
      detailsJson: {
        leadId: updated.leadId,
        previousStatus: existing.reviewStatus,
        nextStatus,
        notes: body.notes
      },
      ipAddress: requestIp(req)
    });

    if (nextStatus === "REJECTED" && updated.lead.assignedExecutiveId) {
      await notifyUsers(
        [updated.lead.assignedExecutiveId],
        "Document rejected",
        `Document ${updated.fileName} for lead ${updated.lead.externalId} was rejected.`,
        {
          type: "INTERNAL",
          leadId: updated.leadId,
          entityType: "document",
          entityId: updated.id,
          metadata: {
            reviewNotes: body.notes
          }
        }
      );
    }

    return ok(res, updated, `Document ${body.action === "verify" ? "verified" : "rejected"}`);
  }
);

documentsRouter.get(
  "/:id/download-url",
  allowRoles("SUPER_ADMIN", "ADMIN", "DISTRICT_MANAGER", "FIELD_EXECUTIVE"),
  validateParams(documentIdParamSchema),
  async (req, res) => {
    const { id } = req.params as z.infer<typeof documentIdParamSchema>;

    const document = await prisma.document.findUnique({
      where: { id },
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

    const downloadUrl = await createDocumentDownloadUrl(
      document.s3Key,
      PRESIGNED_URL_TTL_SECONDS
    );

    return ok(
      res,
      {
        documentId: document.id,
        leadId: document.leadId,
        fileName: document.fileName,
        fileType: document.fileType,
        downloadUrl,
        expiresInSeconds: PRESIGNED_URL_TTL_SECONDS
      },
      "Document download URL generated"
    );
  }
);
