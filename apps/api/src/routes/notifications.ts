import { DevicePlatform, NotificationChannel, Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { created, ok } from "../lib/http.js";
import { AppError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { allowRoles } from "../middleware/rbac.js";
import { validateBody, validateParams, validateQuery } from "../middleware/validate.js";
import {
  enqueueInAppNotification,
  listUserDeviceTokens,
  removeUserDeviceToken,
  renderTemplateVariables,
  upsertUserDeviceToken
} from "../services/notification.service.js";
import { createAuditLog, requestIp } from "../services/audit-log.service.js";

export const notificationsRouter = Router();
const allowNotificationManagers = allowRoles("SUPER_ADMIN", "ADMIN");

const customerTemplateChannelSchema = z.enum(["SMS", "EMAIL", "WHATSAPP"]);

const createInternalNotificationSchema = z.object({
  title: z.string().min(1).max(120),
  body: z.string().min(1).max(500)
});

const registerDeviceTokenSchema = z.object({
  token: z.string().min(20),
  platform: z.nativeEnum(DevicePlatform),
  deviceId: z.union([z.string().min(2).max(120), z.literal(""), z.null()]).optional(),
  appVersion: z.union([z.string().min(1).max(40), z.literal(""), z.null()]).optional()
});

const removeDeviceTokenSchema = z.object({
  token: z.string().min(20)
});

const notificationTemplateIdParamSchema = z.object({
  id: z.string().uuid()
});

const templateListQuerySchema = z.object({
  search: z.string().trim().optional(),
  channel: customerTemplateChannelSchema.optional(),
  isActive: z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((value) => {
      if (typeof value === "boolean") return value;
      if (typeof value === "string") {
        const normalized = value.toLowerCase();
        if (normalized === "true") return true;
        if (normalized === "false") return false;
      }
      return undefined;
    })
});

const createTemplateSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    channel: customerTemplateChannelSchema,
    subject: z.union([z.string().trim().max(200), z.literal(""), z.null()]).optional(),
    bodyTemplate: z.string().trim().min(3).max(5_000),
    isActive: z.boolean().default(true)
  })
  .superRefine((value, ctx) => {
    if (value.channel === "EMAIL" && (!value.subject || value.subject.trim().length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["subject"],
        message: "subject is required for email templates"
      });
    }
  })
  .transform((value) => ({
    ...value,
    subject:
      value.subject === undefined ? undefined : value.subject === "" ? null : value.subject
  }));

const patchTemplateSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    channel: customerTemplateChannelSchema.optional(),
    subject: z.union([z.string().trim().max(200), z.literal(""), z.null()]).optional(),
    bodyTemplate: z.string().trim().min(3).max(5_000).optional(),
    isActive: z.boolean().optional()
  })
  .superRefine((value, ctx) => {
    if (
      value.name === undefined &&
      value.channel === undefined &&
      value.subject === undefined &&
      value.bodyTemplate === undefined &&
      value.isActive === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [],
        message: "At least one updatable field is required"
      });
    }
  })
  .transform((value) => ({
    ...value,
    subject:
      value.subject === undefined ? undefined : value.subject === "" ? null : value.subject
  }));

const previewTemplateSchema = z.object({
  leadId: z.string().uuid(),
  status: z.string().trim().min(2).max(120).optional()
});

const logsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  channel: z.nativeEnum(NotificationChannel).optional(),
  leadId: z.string().uuid().optional(),
  templateId: z.string().uuid().optional(),
  recipient: z.string().trim().optional(),
  status: z.string().trim().optional(),
  search: z.string().trim().optional(),
  dateFrom: z.string().trim().optional(),
  dateTo: z.string().trim().optional()
});

const logIdParamSchema = z.object({
  id: z.string().uuid()
});

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

async function assertUniqueTemplateName(name: string, ignoreId?: string) {
  const existing = await prisma.notificationTemplate.findFirst({
    where: {
      name: { equals: name, mode: "insensitive" }
    },
    select: { id: true }
  });
  if (existing && existing.id !== ignoreId) {
    throw new AppError(409, "TEMPLATE_EXISTS", "Template with this name already exists");
  }
}

notificationsRouter.get("/feed", async (req, res) => {
  const logs = await prisma.notificationLog.findMany({
    where: {
      recipient: req.user!.id
    },
    orderBy: { createdAt: "desc" },
    take: 50
  });
  return ok(res, logs, "Notification feed fetched");
});

notificationsRouter.get("/device-token", async (req, res) => {
  const tokens = await listUserDeviceTokens(req.user!.id);
  return ok(res, tokens, "Registered device tokens fetched");
});

notificationsRouter.post(
  "/device-token",
  validateBody(registerDeviceTokenSchema),
  async (req, res) => {
    const body = req.body as z.infer<typeof registerDeviceTokenSchema>;

    const saved = await upsertUserDeviceToken({
      userId: req.user!.id,
      token: body.token,
      platform: body.platform,
      deviceId: body.deviceId && body.deviceId.length > 0 ? body.deviceId : null,
      appVersion: body.appVersion && body.appVersion.length > 0 ? body.appVersion : null
    });

    await createAuditLog({
      actorUserId: req.user!.id,
      action: "DEVICE_TOKEN_REGISTERED",
      entityType: "notification",
      entityId: saved.id,
      detailsJson: {
        platform: body.platform,
        deviceId: saved.deviceId,
        appVersion: saved.appVersion
      },
      ipAddress: requestIp(req)
    });

    return ok(
      res,
      {
        id: saved.id,
        platform: saved.platform,
        deviceId: saved.deviceId,
        appVersion: saved.appVersion,
        updatedAt: saved.updatedAt
      },
      "Device token saved"
    );
  }
);

notificationsRouter.delete(
  "/device-token",
  validateBody(removeDeviceTokenSchema),
  async (req, res) => {
    const body = req.body as z.infer<typeof removeDeviceTokenSchema>;
    await removeUserDeviceToken({
      userId: req.user!.id,
      token: body.token
    });

    await createAuditLog({
      actorUserId: req.user!.id,
      action: "DEVICE_TOKEN_REMOVED",
      entityType: "notification",
      detailsJson: {
        tokenPrefix: body.token.slice(0, 12)
      },
      ipAddress: requestIp(req)
    });

    return ok(res, {}, "Device token removed");
  }
);

notificationsRouter.post(
  "/internal",
  allowNotificationManagers,
  validateBody(createInternalNotificationSchema),
  async (req, res) => {
    const body = req.body as z.infer<typeof createInternalNotificationSchema>;
    await enqueueInAppNotification({
      userId: req.user!.id,
      title: body.title,
      body: body.body,
      type: "INTERNAL",
      entityType: "notification",
      metadata: {
        source: "manual_internal"
      }
    });
    return ok(res, {}, "Internal notification queued");
  }
);

notificationsRouter.get(
  "/templates",
  allowNotificationManagers,
  validateQuery(templateListQuerySchema),
  async (req, res) => {
    const query = req.query as unknown as z.infer<typeof templateListQuerySchema>;
    const whereClauses: Prisma.NotificationTemplateWhereInput[] = [
      {
        channel: {
          in: ["SMS", "EMAIL", "WHATSAPP"]
        }
      }
    ];

    if (query.search) {
      whereClauses.push({
        OR: [
          { name: { contains: query.search, mode: "insensitive" } },
          { subject: { contains: query.search, mode: "insensitive" } },
          { bodyTemplate: { contains: query.search, mode: "insensitive" } }
        ]
      });
    }
    if (query.channel) {
      whereClauses.push({ channel: query.channel });
    }
    if (query.isActive !== undefined) {
      whereClauses.push({ isActive: query.isActive });
    }

    const templates = await prisma.notificationTemplate.findMany({
      where: whereClauses.length > 0 ? { AND: whereClauses } : undefined,
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }]
    });

    return ok(res, templates, "Notification templates fetched");
  }
);

notificationsRouter.post(
  "/templates",
  allowNotificationManagers,
  validateBody(createTemplateSchema),
  async (req, res) => {
    const body = req.body as z.infer<typeof createTemplateSchema>;
    await assertUniqueTemplateName(body.name);

    const template = await prisma.notificationTemplate.create({
      data: {
        name: body.name,
        channel: body.channel,
        subject: body.subject ?? null,
        bodyTemplate: body.bodyTemplate,
        isActive: body.isActive
      }
    });

    await createAuditLog({
      actorUserId: req.user?.id,
      action: "NOTIFICATION_TEMPLATE_CREATED",
      entityType: "notification_template",
      entityId: template.id,
      detailsJson: body,
      ipAddress: requestIp(req)
    });

    return created(res, template, "Notification template created");
  }
);

notificationsRouter.patch(
  "/templates/:id",
  allowNotificationManagers,
  validateParams(notificationTemplateIdParamSchema),
  validateBody(patchTemplateSchema),
  async (req, res) => {
    const { id } = req.params as z.infer<typeof notificationTemplateIdParamSchema>;
    const body = req.body as z.infer<typeof patchTemplateSchema>;

    const existing = await prisma.notificationTemplate.findUnique({
      where: { id },
      select: { id: true, channel: true, subject: true }
    });
    if (!existing) {
      throw new AppError(404, "NOT_FOUND", "Notification template not found");
    }

    if (body.name) {
      await assertUniqueTemplateName(body.name, id);
    }

    const nextChannel = body.channel ?? existing.channel;
    const nextSubject = body.subject !== undefined ? body.subject : existing.subject;
    if (nextChannel === "EMAIL" && (!nextSubject || nextSubject.trim().length === 0)) {
      throw new AppError(400, "VALIDATION_ERROR", "subject is required for email templates");
    }

    const updated = await prisma.notificationTemplate.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.channel !== undefined ? { channel: body.channel } : {}),
        ...(body.subject !== undefined ? { subject: body.subject } : {}),
        ...(body.bodyTemplate !== undefined ? { bodyTemplate: body.bodyTemplate } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {})
      }
    });

    await createAuditLog({
      actorUserId: req.user?.id,
      action: "NOTIFICATION_TEMPLATE_UPDATED",
      entityType: "notification_template",
      entityId: updated.id,
      detailsJson: body,
      ipAddress: requestIp(req)
    });

    return ok(res, updated, "Notification template updated");
  }
);

notificationsRouter.delete(
  "/templates/:id",
  allowNotificationManagers,
  validateParams(notificationTemplateIdParamSchema),
  async (req, res) => {
    const { id } = req.params as z.infer<typeof notificationTemplateIdParamSchema>;

    const template = await prisma.notificationTemplate.findUnique({
      where: { id },
      select: { id: true, name: true }
    });
    if (!template) {
      throw new AppError(404, "NOT_FOUND", "Notification template not found");
    }

    await prisma.notificationTemplate.delete({ where: { id } });

    await createAuditLog({
      actorUserId: req.user?.id,
      action: "NOTIFICATION_TEMPLATE_DELETED",
      entityType: "notification_template",
      entityId: template.id,
      detailsJson: {
        name: template.name
      },
      ipAddress: requestIp(req)
    });

    return ok(res, {}, "Notification template deleted");
  }
);

notificationsRouter.post(
  "/templates/:id/render",
  allowNotificationManagers,
  validateParams(notificationTemplateIdParamSchema),
  validateBody(previewTemplateSchema),
  async (req, res) => {
    const { id } = req.params as z.infer<typeof notificationTemplateIdParamSchema>;
    const body = req.body as z.infer<typeof previewTemplateSchema>;

    const [template, lead] = await Promise.all([
      prisma.notificationTemplate.findUnique({
        where: { id },
        select: {
          id: true,
          name: true,
          channel: true,
          subject: true,
          bodyTemplate: true,
          isActive: true
        }
      }),
      prisma.lead.findUnique({
        where: { id: body.leadId },
        select: {
          id: true,
          externalId: true,
          name: true,
          phone: true,
          email: true,
          currentStatus: {
            select: {
              name: true
            }
          }
        }
      })
    ]);

    if (!template) {
      throw new AppError(404, "NOT_FOUND", "Notification template not found");
    }
    if (!lead) {
      throw new AppError(404, "NOT_FOUND", "Lead not found");
    }

    const statusName = body.status ?? lead.currentStatus.name;
    const variables = {
      customer_name: lead.name,
      lead_id: lead.id,
      lead_external_id: lead.externalId,
      status: statusName,
      lead_status: statusName,
      phone: lead.phone ?? "",
      email: lead.email ?? ""
    };

    const renderedSubject = template.subject
      ? renderTemplateVariables(template.subject, variables)
      : null;
    const renderedBody = renderTemplateVariables(template.bodyTemplate, variables);

    return ok(
      res,
      {
        template: {
          id: template.id,
          name: template.name,
          channel: template.channel,
          isActive: template.isActive
        },
        lead: {
          id: lead.id,
          externalId: lead.externalId,
          name: lead.name
        },
        variables,
        rendered: {
          subject: renderedSubject,
          body: renderedBody
        }
      },
      "Template rendered"
    );
  }
);

notificationsRouter.get(
  "/logs",
  allowNotificationManagers,
  validateQuery(logsQuerySchema),
  async (req, res) => {
    const query = req.query as unknown as z.infer<typeof logsQuerySchema>;
    const dateFrom = parseDateBoundary(query.dateFrom, "dateFrom");
    const dateTo = parseDateBoundary(query.dateTo, "dateTo");

    if (dateFrom && dateTo && dateFrom > dateTo) {
      throw new AppError(400, "VALIDATION_ERROR", "dateFrom cannot be greater than dateTo");
    }

    const whereClauses: Prisma.NotificationLogWhereInput[] = [];

    if (query.channel) {
      whereClauses.push({ channel: query.channel });
    }
    if (query.leadId) {
      whereClauses.push({ leadId: query.leadId });
    }
    if (query.templateId) {
      whereClauses.push({ templateId: query.templateId });
    }
    if (query.recipient) {
      whereClauses.push({
        recipient: { contains: query.recipient, mode: "insensitive" }
      });
    }
    if (query.status) {
      whereClauses.push({
        deliveryStatus: { equals: query.status, mode: "insensitive" }
      });
    }
    if (query.search) {
      whereClauses.push({
        OR: [
          { recipient: { contains: query.search, mode: "insensitive" } },
          { contentSent: { contains: query.search, mode: "insensitive" } },
          { providerMessageId: { contains: query.search, mode: "insensitive" } }
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
    const where: Prisma.NotificationLogWhereInput =
      whereClauses.length > 0 ? { AND: whereClauses } : {};
    const skip = (query.page - 1) * query.pageSize;

    const [total, logs] = await prisma.$transaction([
      prisma.notificationLog.count({ where }),
      prisma.notificationLog.findMany({
        where,
        skip,
        take: query.pageSize,
        orderBy: { createdAt: "desc" },
        include: {
          template: {
            select: {
              id: true,
              name: true,
              channel: true
            }
          },
          lead: {
            select: {
              id: true,
              externalId: true,
              name: true,
              phone: true
            }
          }
        }
      })
    ]);

    return ok(
      res,
      logs,
      "Notification logs fetched",
      {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / query.pageSize)
      }
    );
  }
);

notificationsRouter.get(
  "/logs/:id",
  allowNotificationManagers,
  validateParams(logIdParamSchema),
  async (req, res) => {
    const { id } = req.params as z.infer<typeof logIdParamSchema>;
    const log = await prisma.notificationLog.findUnique({
      where: { id },
      include: {
        template: true,
        lead: {
          select: {
            id: true,
            externalId: true,
            name: true,
            phone: true,
            email: true
          }
        }
      }
    });
    if (!log) {
      throw new AppError(404, "NOT_FOUND", "Notification log not found");
    }
    return ok(res, log, "Notification log fetched");
  }
);
