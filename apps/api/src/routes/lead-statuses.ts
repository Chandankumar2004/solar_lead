import { Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { ok, created } from "../lib/http.js";
import { allowRoles } from "../middleware/rbac.js";
import { validateBody, validateParams, validateQuery } from "../middleware/validate.js";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../lib/errors.js";
import { createAuditLog, requestIp } from "../services/audit-log.service.js";

export const leadStatusesRouter = Router();

leadStatusesRouter.use(allowRoles("SUPER_ADMIN"));

const leadStatusIdParamSchema = z.object({
  id: z.string().uuid()
});

const leadStatusListQuerySchema = z.object({
  includeTransitions: z
    .string()
    .optional()
    .transform((value) => value === "true")
});

const slaDurationHoursSchema = z.preprocess(
  (input) => {
    if (input === undefined) return undefined;
    if (input === null || input === "") return null;
    if (typeof input === "string") {
      const parsed = Number(input);
      return Number.isNaN(parsed) ? input : parsed;
    }
    return input;
  },
  z.number().int().min(1).max(24 * 365).nullable().optional()
);

const createLeadStatusSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.union([z.string().trim().max(300), z.literal(""), z.null()]).optional(),
  orderIndex: z.coerce.number().int().min(1).optional(),
  isTerminal: z.boolean().default(false),
  slaDurationHours: slaDurationHoursSchema,
  sla_duration_hours: slaDurationHoursSchema,
  colorCode: z
    .string()
    .trim()
    .regex(/^#[A-Fa-f0-9]{6}$/)
    .optional(),
  requiresNote: z.boolean().default(false),
  requiresDocument: z.boolean().default(false),
  notifyCustomer: z.boolean().default(false),
  notificationTemplateId: z.union([z.string().uuid(), z.null()]).optional()
}).transform((value) => ({
  name: value.name,
  description: value.description,
  orderIndex: value.orderIndex,
  isTerminal: value.isTerminal,
  slaDurationHours:
    value.slaDurationHours !== undefined
      ? value.slaDurationHours
      : value.sla_duration_hours,
  colorCode: value.colorCode,
  requiresNote: value.requiresNote,
  requiresDocument: value.requiresDocument,
  notifyCustomer: value.notifyCustomer,
  notificationTemplateId: value.notificationTemplateId
}));

const patchLeadStatusBodySchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().trim().min(2).max(120).optional(),
    description: z.union([z.string().trim().max(300), z.literal(""), z.null()]).optional(),
    orderIndex: z.coerce.number().int().min(1).optional(),
    isTerminal: z.boolean().optional(),
    slaDurationHours: slaDurationHoursSchema,
    sla_duration_hours: slaDurationHoursSchema,
    colorCode: z.union([z.string().trim().regex(/^#[A-Fa-f0-9]{6}$/), z.null()]).optional(),
    requiresNote: z.boolean().optional(),
    requiresDocument: z.boolean().optional(),
    notifyCustomer: z.boolean().optional(),
    notificationTemplateId: z.union([z.string().uuid(), z.null()]).optional()
  })
  .superRefine((value, ctx) => {
    if (
      value.name === undefined &&
      value.description === undefined &&
      value.orderIndex === undefined &&
      value.isTerminal === undefined &&
      value.slaDurationHours === undefined &&
      value.sla_duration_hours === undefined &&
      value.colorCode === undefined &&
      value.requiresNote === undefined &&
      value.requiresDocument === undefined &&
      value.notifyCustomer === undefined &&
      value.notificationTemplateId === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [],
        message: "At least one updatable field is required"
      });
    }
  })
  .transform((value) => ({
    id: value.id,
    name: value.name,
    description: value.description,
    orderIndex: value.orderIndex,
    isTerminal: value.isTerminal,
    slaDurationHours:
      value.slaDurationHours !== undefined
        ? value.slaDurationHours
        : value.sla_duration_hours,
    colorCode: value.colorCode,
    requiresNote: value.requiresNote,
    requiresDocument: value.requiresDocument,
    notifyCustomer: value.notifyCustomer,
    notificationTemplateId: value.notificationTemplateId
  }));

const patchLeadStatusParamsSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    description: z.union([z.string().trim().max(300), z.literal(""), z.null()]).optional(),
    orderIndex: z.coerce.number().int().min(1).optional(),
    isTerminal: z.boolean().optional(),
    slaDurationHours: slaDurationHoursSchema,
    sla_duration_hours: slaDurationHoursSchema,
    colorCode: z.union([z.string().trim().regex(/^#[A-Fa-f0-9]{6}$/), z.null()]).optional(),
    requiresNote: z.boolean().optional(),
    requiresDocument: z.boolean().optional(),
    notifyCustomer: z.boolean().optional(),
    notificationTemplateId: z.union([z.string().uuid(), z.null()]).optional()
  })
  .superRefine((value, ctx) => {
    if (
      value.name === undefined &&
      value.description === undefined &&
      value.orderIndex === undefined &&
      value.isTerminal === undefined &&
      value.slaDurationHours === undefined &&
      value.sla_duration_hours === undefined &&
      value.colorCode === undefined &&
      value.requiresNote === undefined &&
      value.requiresDocument === undefined &&
      value.notifyCustomer === undefined &&
      value.notificationTemplateId === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [],
        message: "At least one updatable field is required"
      });
    }
  })
  .transform((value) => ({
    name: value.name,
    description: value.description,
    orderIndex: value.orderIndex,
    isTerminal: value.isTerminal,
    slaDurationHours:
      value.slaDurationHours !== undefined
        ? value.slaDurationHours
        : value.sla_duration_hours,
    colorCode: value.colorCode,
    requiresNote: value.requiresNote,
    requiresDocument: value.requiresDocument,
    notifyCustomer: value.notifyCustomer,
    notificationTemplateId: value.notificationTemplateId
  }));

const transitionMutationSchema = z
  .object({
    fromStatusId: z.string().uuid(),
    toStatusId: z.string().uuid(),
    action: z.enum(["create", "delete"]).default("create")
  })
  .superRefine((value, ctx) => {
    if (value.fromStatusId === value.toStatusId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["toStatusId"],
        message: "fromStatusId and toStatusId cannot be the same"
      });
    }
  });

const transitionsBodySchema = z
  .union([
    transitionMutationSchema,
    z.object({ transitions: z.array(transitionMutationSchema).min(1) })
  ])
  .transform((value) => ("transitions" in value ? value.transitions : [value]));

const transitionsQuerySchema = z.object({
  fromStatusId: z.string().uuid().optional(),
  toStatusId: z.string().uuid().optional()
});

type Tx = Prisma.TransactionClient;

async function reorderStatusList(tx: Tx, orderedIds: string[]) {
  await Promise.all(
    orderedIds.map((statusId, index) =>
      tx.leadStatus.update({
        where: { id: statusId },
        data: { orderIndex: index + 1 }
      })
    )
  );
}

async function repositionStatus(tx: Tx, statusId: string, targetOrderIndex: number) {
  const existing = await tx.leadStatus.findMany({
    select: { id: true },
    orderBy: [{ orderIndex: "asc" }, { createdAt: "asc" }]
  });

  const currentIds = existing.map((item) => item.id).filter((id) => id !== statusId);
  const boundedIndex = Math.min(
    Math.max(targetOrderIndex - 1, 0),
    currentIds.length
  );
  currentIds.splice(boundedIndex, 0, statusId);
  await reorderStatusList(tx, currentIds);
}

async function assertUniqueStatusName(name: string, ignoreId?: string) {
  const existing = await prisma.leadStatus.findFirst({
    where: {
      name: { equals: name, mode: "insensitive" }
    },
    select: { id: true }
  });
  if (existing && existing.id !== ignoreId) {
    throw new AppError(409, "STATUS_EXISTS", "Lead status with this name already exists");
  }
}

async function assertNotificationTemplate(templateId?: string | null) {
  if (!templateId) return;
  const template = await prisma.notificationTemplate.findUnique({
    where: { id: templateId },
    select: { id: true }
  });
  if (!template) {
    throw new AppError(400, "INVALID_TEMPLATE", "notificationTemplateId is invalid");
  }
}

async function patchLeadStatus(
  statusId: string,
  payload: Omit<z.infer<typeof patchLeadStatusBodySchema>, "id">,
  actorUserId?: string,
  ipAddress?: string | null
) {
  const status = await prisma.leadStatus.findUnique({
    where: { id: statusId },
    select: { id: true }
  });
  if (!status) {
    throw new AppError(404, "NOT_FOUND", "Lead status not found");
  }

  if (payload.name !== undefined) {
    await assertUniqueStatusName(payload.name, statusId);
  }
  if (payload.notificationTemplateId !== undefined) {
    await assertNotificationTemplate(payload.notificationTemplateId);
  }

  const updated = await prisma.$transaction(async (tx) => {
    await tx.leadStatus.update({
      where: { id: statusId },
      data: {
        ...(payload.name !== undefined ? { name: payload.name } : {}),
        ...(payload.description !== undefined
          ? { description: payload.description === "" ? null : payload.description }
          : {}),
        ...(payload.isTerminal !== undefined ? { isTerminal: payload.isTerminal } : {}),
        ...(payload.slaDurationHours !== undefined
          ? { slaDurationHours: payload.slaDurationHours }
          : {}),
        ...(payload.colorCode !== undefined ? { colorCode: payload.colorCode } : {}),
        ...(payload.requiresNote !== undefined ? { requiresNote: payload.requiresNote } : {}),
        ...(payload.requiresDocument !== undefined
          ? { requiresDocument: payload.requiresDocument }
          : {}),
        ...(payload.notifyCustomer !== undefined
          ? { notifyCustomer: payload.notifyCustomer }
          : {}),
        ...(payload.notificationTemplateId !== undefined
          ? { notificationTemplateId: payload.notificationTemplateId }
          : {})
      }
    });

    if (payload.orderIndex !== undefined) {
      await repositionStatus(tx, statusId, payload.orderIndex);
    }

    return tx.leadStatus.findUnique({
      where: { id: statusId }
    });
  });

  await createAuditLog({
    actorUserId,
    action: "LEAD_STATUS_UPDATED",
    entityType: "lead_status",
    entityId: statusId,
    detailsJson: payload,
    ipAddress
  });

  return updated;
}

leadStatusesRouter.get(
  "/",
  validateQuery(leadStatusListQuerySchema),
  async (req, res) => {
    const query = req.query as unknown as z.infer<typeof leadStatusListQuerySchema>;
    const statuses = await prisma.leadStatus.findMany({
      orderBy: [{ orderIndex: "asc" }, { createdAt: "asc" }],
      include: query.includeTransitions
        ? {
            fromTransitions: {
              select: {
                id: true,
                toStatusId: true
              }
            },
            toTransitions: {
              select: {
                id: true,
                fromStatusId: true
              }
            }
          }
        : undefined
    });

    return ok(res, statuses, "Lead statuses fetched");
  }
);

leadStatusesRouter.post("/", validateBody(createLeadStatusSchema), async (req, res) => {
  const body = req.body as z.infer<typeof createLeadStatusSchema>;

  await assertUniqueStatusName(body.name);
  await assertNotificationTemplate(body.notificationTemplateId);

  const createdStatus = await prisma.$transaction(async (tx) => {
    const maxOrder = await tx.leadStatus.aggregate({
      _max: { orderIndex: true }
    });
    const fallbackOrder = (maxOrder._max.orderIndex ?? 0) + 1;

    const status = await tx.leadStatus.create({
      data: {
        name: body.name,
        description: body.description === "" ? null : body.description,
        orderIndex: fallbackOrder,
        isTerminal: body.isTerminal,
        slaDurationHours: body.slaDurationHours,
        colorCode: body.colorCode,
        requiresNote: body.requiresNote,
        requiresDocument: body.requiresDocument,
        notifyCustomer: body.notifyCustomer,
        notificationTemplateId: body.notificationTemplateId
      }
    });

    if (body.orderIndex !== undefined) {
      await repositionStatus(tx, status.id, body.orderIndex);
    }

    return tx.leadStatus.findUnique({ where: { id: status.id } });
  });

  await createAuditLog({
    actorUserId: req.user?.id,
    action: "LEAD_STATUS_CREATED",
    entityType: "lead_status",
    entityId: createdStatus?.id ?? null,
    detailsJson: body,
    ipAddress: requestIp(req)
  });

  return created(res, createdStatus, "Lead status created");
});

leadStatusesRouter.patch("/", validateBody(patchLeadStatusBodySchema), async (req, res) => {
  const body = req.body as z.infer<typeof patchLeadStatusBodySchema>;

  const updated = await patchLeadStatus(
    body.id,
    {
      name: body.name,
      description: body.description,
      orderIndex: body.orderIndex,
      isTerminal: body.isTerminal,
      slaDurationHours: body.slaDurationHours,
      colorCode: body.colorCode,
      requiresNote: body.requiresNote,
      requiresDocument: body.requiresDocument,
      notifyCustomer: body.notifyCustomer,
      notificationTemplateId: body.notificationTemplateId
    },
    req.user?.id,
    requestIp(req)
  );

  return ok(res, updated, "Lead status updated");
});

leadStatusesRouter.patch(
  "/:id",
  validateParams(leadStatusIdParamSchema),
  validateBody(patchLeadStatusParamsSchema),
  async (req, res) => {
    const { id } = req.params as z.infer<typeof leadStatusIdParamSchema>;
    const body = req.body as z.infer<typeof patchLeadStatusParamsSchema>;
    const updated = await patchLeadStatus(id, body, req.user?.id, requestIp(req));
    return ok(res, updated, "Lead status updated");
  }
);

leadStatusesRouter.get(
  "/transitions",
  validateQuery(transitionsQuerySchema),
  async (req, res) => {
    const query = req.query as z.infer<typeof transitionsQuerySchema>;
    const transitions = await prisma.leadStatusTransition.findMany({
      where: {
        ...(query.fromStatusId ? { fromStatusId: query.fromStatusId } : {}),
        ...(query.toStatusId ? { toStatusId: query.toStatusId } : {})
      },
      include: {
        fromStatus: {
          select: { id: true, name: true, orderIndex: true, isTerminal: true }
        },
        toStatus: {
          select: { id: true, name: true, orderIndex: true, isTerminal: true }
        }
      },
      orderBy: [{ fromStatusId: "asc" }, { toStatusId: "asc" }]
    });

    return ok(res, transitions, "Lead status transitions fetched");
  }
);

leadStatusesRouter.post(
  "/transitions",
  validateBody(transitionsBodySchema),
  async (req, res) => {
    const mutations = req.body as z.infer<typeof transitionsBodySchema>;
    const uniqueStatusIds = [...new Set(mutations.flatMap((item) => [item.fromStatusId, item.toStatusId]))];

    const statuses = await prisma.leadStatus.findMany({
      where: { id: { in: uniqueStatusIds } },
      select: { id: true, name: true, isTerminal: true }
    });
    if (statuses.length !== uniqueStatusIds.length) {
      throw new AppError(400, "INVALID_STATUS_ID", "One or more status IDs are invalid");
    }
    const statusById = new Map(statuses.map((status) => [status.id, status]));

    await prisma.$transaction(async (tx) => {
      for (const mutation of mutations) {
        if (mutation.action === "delete") {
          await tx.leadStatusTransition.deleteMany({
            where: {
              fromStatusId: mutation.fromStatusId,
              toStatusId: mutation.toStatusId
            }
          });
          continue;
        }

        const fromStatus = statusById.get(mutation.fromStatusId);
        if (fromStatus?.isTerminal) {
          throw new AppError(
            400,
            "TERMINAL_STATUS_TRANSITION_FORBIDDEN",
            `Cannot add outgoing transitions from terminal status "${fromStatus.name}"`
          );
        }

        await tx.leadStatusTransition.upsert({
          where: {
            fromStatusId_toStatusId: {
              fromStatusId: mutation.fromStatusId,
              toStatusId: mutation.toStatusId
            }
          },
          update: {},
          create: {
            fromStatusId: mutation.fromStatusId,
            toStatusId: mutation.toStatusId
          }
        });
      }
    });

    await createAuditLog({
      actorUserId: req.user?.id,
      action: "LEAD_STATUS_TRANSITIONS_MUTATED",
      entityType: "lead_status_transition",
      detailsJson: mutations,
      ipAddress: requestIp(req)
    });

    const transitions = await prisma.leadStatusTransition.findMany({
      include: {
        fromStatus: {
          select: { id: true, name: true, orderIndex: true, isTerminal: true }
        },
        toStatus: {
          select: { id: true, name: true, orderIndex: true, isTerminal: true }
        }
      },
      orderBy: [{ fromStatusId: "asc" }, { toStatusId: "asc" }]
    });

    return ok(res, transitions, "Lead status transitions updated");
  }
);
