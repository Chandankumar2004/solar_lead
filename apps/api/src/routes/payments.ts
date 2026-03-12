import { randomUUID } from "crypto";
import { PaymentMethod, PaymentStatus, Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { created, ok } from "../lib/http.js";
import { AppError } from "../lib/errors.js";
import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import { allowRoles } from "../middleware/rbac.js";
import { validateBody, validateParams, validateQuery } from "../middleware/validate.js";
import { createAuditLog, requestIp } from "../services/audit-log.service.js";
import {
  assertValidTransition,
  getTokenPaymentVerifiedStatus
} from "../services/lead-status.service.js";
import {
  notifyUsers,
  queueLeadStatusCustomerNotification,
  triggerUtrPendingNotification
} from "../services/notification.service.js";
import { type LeadAccessActor, scopeLeadWhere } from "../services/lead-access.service.js";

export const paymentsRouter = Router();

const merchantDetails = {
  registeredName: env.PAYMENT_REGISTERED_NAME,
  cin: env.PAYMENT_CIN || null,
  pan: env.PAYMENT_PAN || null,
  tan: env.PAYMENT_TAN || null,
  gst: env.PAYMENT_GST || null
};

const paymentIdParamSchema = z.object({
  id: z.string().uuid()
});

const createQrUtrPaymentSchema = z
  .object({
    leadId: z.string().uuid(),
    amount: z.coerce.number().positive(),
    utrNumber: z.string().trim().min(6).max(120).optional(),
    utr_number: z.string().trim().min(6).max(120).optional()
  })
  .superRefine((value, ctx) => {
    if (!value.utrNumber && !value.utr_number) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["utrNumber"],
        message: "utrNumber is required for QR-UTR payment"
      });
    }
  })
  .transform((value) => ({
    leadId: value.leadId,
    amount: value.amount,
    utrNumber: value.utrNumber ?? value.utr_number ?? ""
  }));

const createPaymentSchema = z
  .object({
    leadId: z.string().uuid(),
    amount: z.coerce.number().positive(),
    method: z.nativeEnum(PaymentMethod),
    utrNumber: z.string().trim().min(6).max(120).optional(),
    utr_number: z.string().trim().min(6).max(120).optional()
  })
  .superRefine((value, ctx) => {
    if (value.method === "QR_UTR" && !value.utrNumber && !value.utr_number) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["utrNumber"],
        message: "utrNumber is required when method is QR_UTR"
      });
    }
  })
  .transform((value) => ({
    leadId: value.leadId,
    amount: value.amount,
    method: value.method,
    utrNumber: value.utrNumber ?? value.utr_number
  }));

const reviewPaymentSchema = z
  .object({
    action: z.enum(["verify", "reject"]),
    note: z.union([z.string().trim().max(500), z.literal(""), z.null()]).optional(),
    notes: z.union([z.string().trim().max(500), z.literal(""), z.null()]).optional()
  })
  .transform((value) => ({
    action: value.action,
    note: value.note ?? value.notes ?? null
  }))
  .superRefine((value, ctx) => {
    if (value.action === "reject" && (!value.note || value.note.trim().length < 5)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["note"],
        message: "Rejection note is required (minimum 5 characters)"
      });
    }
  });

const listQueueQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(10),
    status: z.nativeEnum(PaymentStatus).optional(),
    districtId: z.string().uuid().optional(),
    executiveId: z.string().uuid().optional(),
    execId: z.string().uuid().optional(),
    leadId: z.string().uuid().optional(),
    method: z.nativeEnum(PaymentMethod).optional(),
    search: z.string().trim().optional(),
    dateFrom: z.string().trim().optional(),
    dateTo: z.string().trim().optional()
  })
  .transform((value) => ({
    page: value.page,
    pageSize: value.pageSize,
    status: value.status ?? "PENDING",
    districtId: value.districtId,
    executiveId: value.executiveId ?? value.execId,
    leadId: value.leadId,
    method: value.method,
    search: value.search,
    dateFrom: value.dateFrom,
    dateTo: value.dateTo
  }));

const gatewayOrderSchema = z
  .object({
    leadId: z.string().uuid(),
    amount: z.coerce.number().positive(),
    currency: z.string().trim().min(3).max(3).default("INR"),
    receipt: z.string().trim().min(1).max(80).optional(),
    notes: z.record(z.string(), z.string()).optional()
  })
  .transform((value) => ({
    ...value,
    currency: value.currency.toUpperCase()
  }));

type RazorpayOrderResponse = {
  id: string;
  amount: number;
  amount_due: number;
  amount_paid: number;
  currency: string;
  receipt: string | null;
  status: string;
  notes: Record<string, string>;
  created_at: number;
};

function resolveRazorpayCredentials() {
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
    throw new AppError(
      503,
      "RAZORPAY_NOT_CONFIGURED",
      "Razorpay credentials are not configured"
    );
  }

  return {
    keyId: env.RAZORPAY_KEY_ID,
    keySecret: env.RAZORPAY_KEY_SECRET
  };
}

function resolveRazorpayOrderApiUrl() {
  const sanitizedBase = env.RAZORPAY_API_BASE_URL.replace(/\/+$/, "");
  const withVersion = sanitizedBase.endsWith("/v1")
    ? sanitizedBase
    : `${sanitizedBase}/v1`;
  return `${withVersion}/orders`;
}

async function createRazorpayOrder(input: {
  amountInPaise: number;
  currency: string;
  receipt: string;
  notes: Record<string, string>;
}) {
  const credentials = resolveRazorpayCredentials();
  const authHeader = Buffer.from(
    `${credentials.keyId}:${credentials.keySecret}`,
    "utf-8"
  ).toString("base64");

  const response = await fetch(resolveRazorpayOrderApiUrl(), {
    method: "POST",
    headers: {
      Authorization: `Basic ${authHeader}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      amount: input.amountInPaise,
      currency: input.currency,
      receipt: input.receipt,
      notes: input.notes
    })
  });

  const rawBody = await response.text();
  let parsedBody: Record<string, unknown> | null = null;
  try {
    parsedBody = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : null;
  } catch {
    parsedBody = null;
  }

  if (!response.ok) {
    const razorpayMessage =
      typeof parsedBody?.error === "object" && parsedBody.error
        ? String((parsedBody.error as Record<string, unknown>).description ?? "")
        : String(parsedBody?.message ?? "");
    const message =
      razorpayMessage.trim() || rawBody || "Failed to create Razorpay order";
    throw new AppError(502, "RAZORPAY_ORDER_CREATE_FAILED", message);
  }

  if (!parsedBody || typeof parsedBody.id !== "string") {
    throw new AppError(
      502,
      "RAZORPAY_ORDER_CREATE_FAILED",
      "Invalid response from Razorpay order API"
    );
  }

  return parsedBody as unknown as RazorpayOrderResponse;
}

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

async function assertLeadExists(leadId: string, actor: LeadAccessActor) {
  const lead = await prisma.lead.findFirst({
    where: scopeLeadWhere(actor, { id: leadId }),
    select: {
      id: true,
      externalId: true,
      assignedExecutiveId: true,
      assignedManagerId: true
    }
  });
  if (!lead) {
    throw new AppError(404, "NOT_FOUND", "Lead not found");
  }
  return lead;
}

async function createPendingQrUtrPayment(input: {
  leadId: string;
  amount: number;
  utrNumber: string;
  actor: LeadAccessActor;
  actorIpAddress?: string | null;
}) {
  const lead = await assertLeadExists(input.leadId, input.actor);

  const payment = await prisma.payment.create({
    data: {
      leadId: input.leadId,
      amount: input.amount,
      method: "QR_UTR",
      utrNumber: input.utrNumber,
      status: "PENDING",
      collectedByUserId: input.actor.id
    },
    include: {
      lead: {
        select: {
          id: true,
          externalId: true,
          name: true,
          phone: true
        }
      },
      collectedByUser: {
        select: {
          id: true,
          fullName: true,
          email: true
        }
      }
    }
  });

  await triggerUtrPendingNotification({
    paymentId: payment.id,
    leadId: payment.leadId,
    amount: payment.amount.toString(),
    utrNumber: payment.utrNumber
  });

  await createAuditLog({
    actorUserId: input.actor.id,
    action: "PAYMENT_QR_UTR_CREATED",
    entityType: "payment",
    entityId: payment.id,
    detailsJson: {
      leadId: input.leadId,
      externalId: lead.externalId,
      amount: payment.amount.toString(),
      method: payment.method,
      status: payment.status,
      utrNumber: payment.utrNumber
    },
    ipAddress: input.actorIpAddress
  });

  return payment;
}

paymentsRouter.post(
  "/qr-utr",
  allowRoles("SUPER_ADMIN", "ADMIN", "DISTRICT_MANAGER", "FIELD_EXECUTIVE"),
  validateBody(createQrUtrPaymentSchema),
  async (req, res) => {
    const body = req.body as z.infer<typeof createQrUtrPaymentSchema>;
    const payment = await createPendingQrUtrPayment({
      leadId: body.leadId,
      amount: body.amount,
      utrNumber: body.utrNumber,
      actor: req.user!,
      actorIpAddress: requestIp(req)
    });
    return created(res, payment, "QR-UTR payment submitted for verification");
  }
);

paymentsRouter.get(
  "/merchant-details",
  allowRoles("SUPER_ADMIN", "ADMIN", "DISTRICT_MANAGER", "FIELD_EXECUTIVE"),
  async (_req, res) => {
    return ok(res, merchantDetails, "Payment merchant details fetched");
  }
);

paymentsRouter.post(
  "/",
  allowRoles("SUPER_ADMIN", "ADMIN", "DISTRICT_MANAGER", "FIELD_EXECUTIVE"),
  validateBody(createPaymentSchema),
  async (req, res) => {
    const body = req.body as z.infer<typeof createPaymentSchema>;

    if (body.method !== "QR_UTR") {
      throw new AppError(
        400,
        "PAYMENT_METHOD_NOT_SUPPORTED",
        "Use /api/payments/gateway/razorpay/order or /api/payments/gateway/payu/order for gateway flow"
      );
    }

    if (!body.utrNumber) {
      throw new AppError(400, "VALIDATION_ERROR", "utrNumber is required for QR_UTR");
    }

    const payment = await createPendingQrUtrPayment({
      leadId: body.leadId,
      amount: body.amount,
      utrNumber: body.utrNumber,
      actor: req.user!,
      actorIpAddress: requestIp(req)
    });

    return created(res, payment, "Payment submitted for verification");
  }
);

paymentsRouter.get(
  "/verification-queue",
  allowRoles("SUPER_ADMIN", "ADMIN", "DISTRICT_MANAGER"),
  validateQuery(listQueueQuerySchema),
  async (req, res) => {
    const query = req.query as unknown as z.infer<typeof listQueueQuerySchema>;
    const dateFrom = parseDateBoundary(query.dateFrom, "dateFrom");
    const dateTo = parseDateBoundary(query.dateTo, "dateTo");

    if (dateFrom && dateTo && dateFrom > dateTo) {
      throw new AppError(400, "VALIDATION_ERROR", "dateFrom cannot be greater than dateTo");
    }

    const whereClauses: Prisma.PaymentWhereInput[] = [{ status: query.status }];

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
      whereClauses.push({
        leadId: query.leadId
      });
    }

    if (query.method) {
      whereClauses.push({
        method: query.method
      });
    }

    if (query.search) {
      whereClauses.push({
        OR: [
          { utrNumber: { contains: query.search, mode: "insensitive" } },
          { gatewayOrderId: { contains: query.search, mode: "insensitive" } },
          { gatewayPaymentId: { contains: query.search, mode: "insensitive" } },
          {
            lead: {
              is: {
                externalId: query.search
              }
            }
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
                email: { contains: query.search, mode: "insensitive" }
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

    if (req.user!.role !== "SUPER_ADMIN" && req.user!.role !== "ADMIN") {
      whereClauses.push({
        lead: {
          is: scopeLeadWhere(req.user!, {})
        }
      });
    }

    const where: Prisma.PaymentWhereInput =
      whereClauses.length > 0 ? { AND: whereClauses } : {};

    const skip = (query.page - 1) * query.pageSize;
    const [total, payments] = await prisma.$transaction([
      prisma.payment.count({ where }),
      prisma.payment.findMany({
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
                select: {
                  id: true,
                  name: true,
                  state: true
                }
              },
              currentStatus: {
                select: {
                  id: true,
                  name: true
                }
              },
              assignedExecutive: {
                select: {
                  id: true,
                  fullName: true,
                  email: true
                }
              }
            }
          },
          collectedByUser: {
            select: {
              id: true,
              fullName: true,
              email: true
            }
          },
          verifiedByUser: {
            select: {
              id: true,
              fullName: true,
              email: true
            }
          }
        }
      })
    ]);

    return ok(
      res,
      payments,
      "Payment verification queue fetched",
      {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / query.pageSize)
      }
    );
  }
);

paymentsRouter.post(
  "/:id/review",
  allowRoles("SUPER_ADMIN", "ADMIN", "DISTRICT_MANAGER"),
  validateParams(paymentIdParamSchema),
  validateBody(reviewPaymentSchema),
  async (req, res) => {
    const { id } = req.params as z.infer<typeof paymentIdParamSchema>;
    const body = req.body as z.infer<typeof reviewPaymentSchema>;

    const existing = await prisma.payment.findUnique({
      where: { id },
      select: {
        id: true,
        leadId: true,
        status: true,
        method: true,
        amount: true,
        utrNumber: true,
        lead: {
          select: {
            id: true,
            externalId: true,
            currentStatusId: true,
            assignedExecutiveId: true
          }
        }
      }
    });
    if (!existing) {
      throw new AppError(404, "NOT_FOUND", "Payment not found");
    }
    if (req.user!.role !== "SUPER_ADMIN" && req.user!.role !== "ADMIN") {
      const accessibleLead = await prisma.lead.findFirst({
        where: scopeLeadWhere(req.user!, { id: existing.leadId }),
        select: { id: true }
      });
      if (!accessibleLead) {
        throw new AppError(404, "NOT_FOUND", "Payment not found");
      }
    }
    if (existing.status !== "PENDING") {
      throw new AppError(
        409,
        "PAYMENT_ALREADY_REVIEWED",
        "Only pending payments can be reviewed"
      );
    }

    let tokenPaymentVerifiedStatus: Awaited<
      ReturnType<typeof getTokenPaymentVerifiedStatus>
    > | null = null;
    let shouldTransitionLead = false;
    if (body.action === "verify") {
      tokenPaymentVerifiedStatus = await getTokenPaymentVerifiedStatus();
      if (!tokenPaymentVerifiedStatus) {
        throw new AppError(
          400,
          "NO_STATUS_CONFIG",
          'Lead status "Token Payment Verified" is not configured'
        );
      }
      shouldTransitionLead = existing.lead.currentStatusId !== tokenPaymentVerifiedStatus.id;
      if (shouldTransitionLead) {
        const isAllowed = await assertValidTransition(
          existing.lead.currentStatusId,
          tokenPaymentVerifiedStatus.id
        );
        if (!isAllowed) {
          throw new AppError(
            400,
            "INVALID_STATUS_TRANSITION",
            `Transition to "${tokenPaymentVerifiedStatus.name}" is not allowed from the current lead status`
          );
        }
      }
    }

    const actionNote = body.note?.trim() || null;
    const updatedStatus: PaymentStatus = body.action === "verify" ? "VERIFIED" : "REJECTED";

    const result = await prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: existing.id },
        data: {
          status: updatedStatus,
          rejectionReason: body.action === "reject" ? actionNote : null,
          verifiedByUserId: req.user!.id,
          verifiedAt: new Date()
        }
      });

      if (body.action === "verify" && shouldTransitionLead && tokenPaymentVerifiedStatus) {
        const historyNoteParts = [
          "Auto transition after payment verification",
          existing.utrNumber ? `UTR: ${existing.utrNumber}` : null,
          actionNote ? `Note: ${actionNote}` : null
        ].filter(Boolean);

        await tx.lead.update({
          where: { id: existing.leadId },
          data: {
            currentStatusId: tokenPaymentVerifiedStatus.id,
            statusHistory: {
              create: {
                fromStatusId: existing.lead.currentStatusId,
                toStatusId: tokenPaymentVerifiedStatus.id,
                changedByUserId: req.user!.id,
                notes: historyNoteParts.join(" | ")
              }
            }
          }
        });
      }

      const payment = await tx.payment.findUnique({
        where: { id: existing.id },
        include: {
          lead: {
            select: {
              id: true,
              externalId: true,
              name: true,
              phone: true,
              assignedExecutiveId: true,
              currentStatus: {
                select: {
                  id: true,
                  name: true
                }
              }
            }
          },
          collectedByUser: {
            select: {
              id: true,
              fullName: true,
              email: true
            }
          },
          verifiedByUser: {
            select: {
              id: true,
              fullName: true,
              email: true
            }
          }
        }
      });

      return {
        payment,
        leadTransitioned: body.action === "verify" ? shouldTransitionLead : false,
        transitionedToStatus: body.action === "verify" ? tokenPaymentVerifiedStatus?.name ?? null : null
      };
    });

    await createAuditLog({
      actorUserId: req.user!.id,
      action: body.action === "verify" ? "PAYMENT_VERIFIED" : "PAYMENT_REJECTED",
      entityType: "payment",
      entityId: existing.id,
      detailsJson: {
        leadId: existing.leadId,
        externalId: existing.lead.externalId,
        previousStatus: existing.status,
        nextStatus: updatedStatus,
        note: actionNote,
        leadTransitioned: result.leadTransitioned,
        transitionedToStatus: result.transitionedToStatus
      },
      ipAddress: requestIp(req)
    });

    if (
      body.action === "verify" &&
      result.leadTransitioned &&
      tokenPaymentVerifiedStatus
    ) {
      await queueLeadStatusCustomerNotification({
        leadId: existing.leadId,
        toStatusId: tokenPaymentVerifiedStatus.id,
        changedByUserId: req.user?.id,
        transitionNotes: actionNote
      });
    }

    if (body.action === "reject" && existing.lead.assignedExecutiveId) {
      await notifyUsers(
        [existing.lead.assignedExecutiveId],
        "UTR rejected",
        `Payment UTR for lead ${existing.lead.externalId} was rejected.`,
        {
          type: "INTERNAL",
          leadId: existing.leadId,
          entityType: "payment",
          entityId: existing.id,
          metadata: {
            note: actionNote
          }
        }
      );
    }

    return ok(
      res,
      {
        ...result.payment,
        leadTransitioned: result.leadTransitioned,
        transitionedToStatus: result.transitionedToStatus
      },
      `Payment ${body.action === "verify" ? "verified" : "rejected"}`
    );
  }
);

paymentsRouter.post(
  "/gateway/razorpay/order",
  allowRoles("SUPER_ADMIN", "ADMIN", "DISTRICT_MANAGER", "FIELD_EXECUTIVE"),
  validateBody(gatewayOrderSchema),
  async (req, res) => {
    const body = req.body as z.infer<typeof gatewayOrderSchema>;
    const lead = await assertLeadExists(body.leadId, req.user!);
    const amountInPaise = Math.round(body.amount * 100);
    if (!Number.isFinite(amountInPaise) || amountInPaise <= 0) {
      throw new AppError(400, "VALIDATION_ERROR", "amount must be a valid positive number");
    }

    const receipt =
      body.receipt ??
      `lead-${lead.externalId.slice(0, 8)}-${Date.now().toString().slice(-8)}`;

    const orderNotes = {
      leadId: lead.id,
      leadExternalId: lead.externalId,
      requestedByUserId: req.user!.id,
      ...(body.notes ?? {})
    };

    const order = await createRazorpayOrder({
      amountInPaise,
      currency: body.currency,
      receipt,
      notes: orderNotes
    });

    const payment = await prisma.payment.create({
      data: {
        leadId: lead.id,
        amount: body.amount,
        method: PaymentMethod.UPI_GATEWAY,
        status: PaymentStatus.PENDING,
        gatewayOrderId: order.id,
        collectedByUserId: req.user!.id
      },
      include: {
        lead: {
          select: {
            id: true,
            externalId: true,
            name: true
          }
        }
      }
    });

    await createAuditLog({
      actorUserId: req.user?.id,
      action: "PAYMENT_GATEWAY_ORDER_CREATED",
      entityType: "payment_gateway_order",
      entityId: order.id,
      detailsJson: {
        provider: "razorpay",
        leadId: lead.id,
        externalId: lead.externalId,
        amount: body.amount,
        currency: body.currency,
        receipt,
        paymentId: payment.id
      },
      ipAddress: requestIp(req)
    });

    return created(
      res,
      {
        provider: "razorpay",
        mode: "live",
        keyId: env.RAZORPAY_KEY_ID,
        merchant: merchantDetails,
        order: {
          id: order.id,
          amount: order.amount / 100,
          amountPaise: order.amount,
          currency: order.currency,
          status: order.status,
          receipt: order.receipt,
          notes: order.notes,
          createdAt: new Date(order.created_at * 1000).toISOString()
        },
        payment: {
          id: payment.id,
          leadId: payment.leadId,
          externalId: payment.lead.externalId,
          amount: payment.amount,
          method: payment.method,
          status: payment.status,
          gatewayOrderId: payment.gatewayOrderId
        }
      },
      "Razorpay order created"
    );
  }
);

paymentsRouter.post(
  "/gateway/payu/order",
  allowRoles("SUPER_ADMIN", "ADMIN", "DISTRICT_MANAGER", "FIELD_EXECUTIVE"),
  validateBody(gatewayOrderSchema),
  async (req, res) => {
    const body = req.body as z.infer<typeof gatewayOrderSchema>;
    const lead = await assertLeadExists(body.leadId, req.user!);
    const orderId = `payu_${randomUUID().replace(/-/g, "")}`;

    await createAuditLog({
      actorUserId: req.user?.id,
      action: "PAYMENT_GATEWAY_ORDER_PLACEHOLDER_CREATED",
      entityType: "payment_gateway_order",
      entityId: orderId,
      detailsJson: {
        provider: "payu",
        leadId: lead.id,
        externalId: lead.externalId,
        amount: body.amount,
        currency: body.currency,
        receipt: body.receipt ?? null
      },
      ipAddress: requestIp(req)
    });

    return created(
      res,
      {
        provider: "payu",
        mode: "placeholder",
        merchant: merchantDetails,
        orderId,
        leadId: lead.id,
        externalId: lead.externalId,
        amount: body.amount,
        currency: body.currency,
        receipt: body.receipt ?? `lead-${lead.externalId}`,
        notes: body.notes ?? {},
        expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString()
      },
      "PayU order placeholder created"
    );
  }
);
