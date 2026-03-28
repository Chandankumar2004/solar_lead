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
  getTokenPaymentVerificationPendingStatus,
  getTokenPaymentVerifiedStatus
} from "../services/lead-status.service.js";
import {
  maskUpiIdForLog,
  sanitizePaymentPayloadForStorage
} from "../services/payment-security.service.js";
import {
  notifyUsers,
  queueLeadStatusCustomerNotification,
  triggerUtrPendingNotification
} from "../services/notification.service.js";
import { type LeadAccessActor, scopeLeadWhere } from "../services/lead-access.service.js";

export const paymentsRouter = Router();

const merchantDetails = {
  registeredName: env.PAYMENT_REGISTERED_NAME,
  upiId: env.PAYMENT_UPI_ID?.trim() || null,
  upiDisplayName: env.PAYMENT_UPI_NAME?.trim() || null,
  qrImageUrl: env.PAYMENT_QR_IMAGE_URL?.trim() || null,
  cin: env.PAYMENT_CIN || null,
  pan: env.PAYMENT_PAN || null,
  tan: env.PAYMENT_TAN || null,
  gst: env.PAYMENT_GST || null
};

const TOKEN_PAYMENT_AMOUNT_INR = Number(env.TOKEN_PAYMENT_AMOUNT_INR);
const TOKEN_PAYMENT_AMOUNT_PAISE = Math.round(TOKEN_PAYMENT_AMOUNT_INR * 100);
const UPI_ID_REGEX = /^[a-z0-9._-]{2,256}@[a-z][a-z0-9.-]{1,63}$/i;
const UTR_REGEX = /^[a-z0-9][a-z0-9._/-]{5,119}$/i;

const paymentIdParamSchema = z.object({
  id: z.string().uuid()
});

const createQrUtrPaymentSchema = z
  .object({
    leadId: z.string().uuid(),
    amount: z.coerce.number().positive().optional(),
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
    amount: z.coerce.number().positive().optional(),
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
    if (!value.note || value.note.trim().length < 3) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["note"],
        message: "Review note is required (minimum 3 characters)"
      });
      return;
    }
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
    amount: z.coerce.number().positive().optional(),
    customerUpiId: z.string().trim().min(5).max(120).optional(),
    customer_upi_id: z.string().trim().min(5).max(120).optional(),
    currency: z.string().trim().min(3).max(3).default("INR"),
    receipt: z.string().trim().min(1).max(80).optional(),
    notes: z.record(z.string(), z.string()).optional()
  })
  .transform((value) => ({
    ...value,
    currency: value.currency.toUpperCase(),
    customerUpiId: (value.customerUpiId ?? value.customer_upi_id)?.trim().toLowerCase()
  }));

type RazorpayUpiCollectResponse = {
  id: string;
  entity: string;
  amount: number;
  currency: string;
  status: string;
  order_id?: string | null;
  vpa?: string | null;
  notes?: Record<string, string>;
  created_at?: number;
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

function resolveRazorpayUpiCollectApiUrl() {
  const sanitizedBase = env.RAZORPAY_API_BASE_URL.replace(/\/+$/, "");
  const withVersion = sanitizedBase.endsWith("/v1")
    ? sanitizedBase
    : `${sanitizedBase}/v1`;
  const endpoint = env.RAZORPAY_UPI_COLLECT_ENDPOINT.trim();
  if (/^https?:\/\//i.test(endpoint)) {
    return endpoint;
  }
  if (endpoint.startsWith("/")) {
    return `${withVersion}${endpoint}`;
  }
  return `${withVersion}/${endpoint}`;
}

function normalizeUpiId(upiId: string) {
  return upiId.trim().toLowerCase();
}

function assertValidUpiId(upiId: string) {
  if (!UPI_ID_REGEX.test(upiId)) {
    throw new AppError(400, "VALIDATION_ERROR", "customerUpiId must be a valid UPI ID");
  }
}

function normalizeUtrNumber(utrNumber: string) {
  return utrNumber.trim().replace(/\s+/g, "").toUpperCase();
}

function assertValidUtrNumber(utrNumber: string) {
  if (!UTR_REGEX.test(utrNumber)) {
    throw new AppError(
      400,
      "VALIDATION_ERROR",
      "utrNumber must be 6-120 characters and contain only letters, numbers, '.', '_', '/', '-'"
    );
  }
}

function assertTokenAmountIsConfigured() {
  if (!Number.isFinite(TOKEN_PAYMENT_AMOUNT_INR) || TOKEN_PAYMENT_AMOUNT_INR <= 0) {
    throw new AppError(
      500,
      "TOKEN_PAYMENT_AMOUNT_INVALID",
      "TOKEN_PAYMENT_AMOUNT_INR must be configured as a positive number"
    );
  }
}

function assertClientTokenAmountNotTampered(amount: number | undefined) {
  if (amount === undefined) {
    return;
  }
  const rounded = Number(amount.toFixed(2));
  const expected = Number(TOKEN_PAYMENT_AMOUNT_INR.toFixed(2));
  if (rounded !== expected) {
    throw new AppError(
      400,
      "INVALID_TOKEN_AMOUNT",
      `Token amount is fixed at INR ${expected.toFixed(2)}`
    );
  }
}

async function createRazorpayUpiCollectRequest(input: {
  amountInPaise: number;
  currency: string;
  receipt: string;
  notes: Record<string, string>;
  customerUpiId: string;
  customerPhone?: string | null;
  customerEmail?: string | null;
}) {
  const credentials = resolveRazorpayCredentials();
  const authHeader = Buffer.from(
    `${credentials.keyId}:${credentials.keySecret}`,
    "utf-8"
  ).toString("base64");

  const response = await fetch(resolveRazorpayUpiCollectApiUrl(), {
    method: "POST",
    headers: {
      Authorization: `Basic ${authHeader}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      amount: input.amountInPaise,
      currency: input.currency,
      method: "upi",
      vpa: input.customerUpiId,
      receipt: input.receipt,
      notes: input.notes,
      contact: input.customerPhone ?? undefined,
      email: input.customerEmail ?? undefined
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
      razorpayMessage.trim() || rawBody || "Failed to create Razorpay UPI collect request";
    throw new AppError(502, "RAZORPAY_UPI_COLLECT_CREATE_FAILED", message);
  }

  if (!parsedBody || typeof parsedBody.id !== "string") {
    throw new AppError(
      502,
      "RAZORPAY_UPI_COLLECT_CREATE_FAILED",
      "Invalid response from Razorpay UPI collect API"
    );
  }

  return parsedBody as unknown as RazorpayUpiCollectResponse;
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

function managerDistrictLeadScope(userId: string): Prisma.LeadWhereInput {
  return {
    district: {
      assignments: {
        some: {
          userId,
          user: {
            role: "MANAGER",
            status: "ACTIVE"
          }
        }
      }
    }
  };
}

async function assertLeadExists(leadId: string, actor: LeadAccessActor) {
  const lead = await prisma.lead.findFirst({
    where: scopeLeadWhere(actor, { id: leadId }),
    select: {
      id: true,
      externalId: true,
      name: true,
      phone: true,
      email: true,
      currentStatusId: true,
      assignedExecutiveId: true,
      assignedManagerId: true
    }
  });
  if (!lead) {
    throw new AppError(404, "NOT_FOUND", "Lead not found");
  }
  return lead;
}

function assertActorCanInitiateTokenPayment(
  actor: LeadAccessActor,
  lead: {
    assignedExecutiveId: string | null;
  }
) {
  if (actor.role === "EXECUTIVE" && lead.assignedExecutiveId !== actor.id) {
    throw new AppError(
      403,
      "FORBIDDEN",
      "Only the assigned field executive can initiate token payment for this lead"
    );
  }
}

function assertActorCanSubmitQrUtrPayment(
  actor: LeadAccessActor,
  lead: {
    assignedExecutiveId: string | null;
  }
) {
  if (actor.role !== "EXECUTIVE") {
    throw new AppError(
      403,
      "FORBIDDEN",
      "Only the assigned field executive can submit QR UTR payment for this lead"
    );
  }
  if (lead.assignedExecutiveId !== actor.id) {
    throw new AppError(
      403,
      "FORBIDDEN",
      "Only the assigned field executive can submit QR UTR payment for this lead"
    );
  }
}

async function assertNoVerifiedTokenPayment(leadId: string) {
  const existingVerified = await prisma.payment.findFirst({
    where: {
      leadId,
      status: PaymentStatus.VERIFIED
    },
    select: {
      id: true
    }
  });

  if (existingVerified) {
    throw new AppError(
      409,
      "TOKEN_PAYMENT_ALREADY_CONFIRMED",
      "A successful token payment already exists for this lead"
    );
  }
}

async function assertQrUtrSubmissionAllowed(leadId: string, utrNumber: string) {
  const [existingPendingForLead, existingDuplicateUtr] = await Promise.all([
    prisma.payment.findFirst({
      where: {
        leadId,
        method: PaymentMethod.QR_UTR,
        status: PaymentStatus.PENDING
      },
      select: {
        id: true
      }
    }),
    prisma.payment.findFirst({
      where: {
        method: PaymentMethod.QR_UTR,
        status: {
          in: [PaymentStatus.PENDING, PaymentStatus.VERIFIED]
        },
        utrNumber: {
          equals: utrNumber,
          mode: "insensitive"
        }
      },
      select: {
        id: true,
        leadId: true,
        status: true
      }
    })
  ]);

  if (existingPendingForLead) {
    throw new AppError(
      409,
      "PAYMENT_ALREADY_PENDING",
      "A QR UTR payment is already pending verification for this lead"
    );
  }

  if (existingDuplicateUtr) {
    const duplicateScope =
      existingDuplicateUtr.leadId === leadId ? "this lead" : "another lead";
    throw new AppError(
      409,
      "DUPLICATE_UTR",
      `UTR already exists in active payment records for ${duplicateScope}`
    );
  }
}

async function tryAutoTransitionToTokenVerificationPendingStatus(input: {
  leadId: string;
  changedByUserId: string;
  amount: number;
  utrNumber: string;
}) {
  const targetStatus = await getTokenPaymentVerificationPendingStatus();
  if (!targetStatus) {
    return;
  }

  const lead = await prisma.lead.findUnique({
    where: { id: input.leadId },
    select: {
      id: true,
      currentStatusId: true
    }
  });
  if (!lead) return;
  if (lead.currentStatusId === targetStatus.id) return;

  const allowed = await assertValidTransition(lead.currentStatusId, targetStatus.id);
  if (!allowed) return;

  const transitionNotes = [
    "Auto transition after QR UTR payment submission",
    `Amount: INR ${input.amount.toFixed(2)}`,
    `UTR: ${input.utrNumber}`
  ].join(" | ");

  await prisma.lead.update({
    where: { id: lead.id },
    data: {
      currentStatusId: targetStatus.id,
      statusUpdatedAt: new Date(),
      isOverdue: false,
      overdueAt: null,
      statusHistory: {
        create: {
          fromStatusId: lead.currentStatusId,
          toStatusId: targetStatus.id,
          changedByUserId: input.changedByUserId,
          notes: transitionNotes
        }
      }
    }
  });

  await queueLeadStatusCustomerNotification({
    leadId: lead.id,
    toStatusId: targetStatus.id,
    changedByUserId: input.changedByUserId,
    transitionNotes
  });
}

async function createPendingQrUtrPayment(input: {
  leadId: string;
  utrNumber: string;
  actor: LeadAccessActor;
  actorIpAddress?: string | null;
}) {
  assertTokenAmountIsConfigured();
  const lead = await assertLeadExists(input.leadId, input.actor);
  assertActorCanSubmitQrUtrPayment(input.actor, lead);
  const normalizedUtrNumber = normalizeUtrNumber(input.utrNumber);
  assertValidUtrNumber(normalizedUtrNumber);
  await assertNoVerifiedTokenPayment(input.leadId);
  await assertQrUtrSubmissionAllowed(input.leadId, normalizedUtrNumber);
  const tokenAmount = TOKEN_PAYMENT_AMOUNT_INR;

  const payment = await prisma.payment.create({
    data: {
      leadId: input.leadId,
      amount: tokenAmount,
      method: "QR_UTR",
      provider: "manual",
      utrNumber: normalizedUtrNumber,
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

  try {
    await tryAutoTransitionToTokenVerificationPendingStatus({
      leadId: input.leadId,
      changedByUserId: input.actor.id,
      amount: tokenAmount,
      utrNumber: normalizedUtrNumber
    });
  } catch (error) {
    console.error("token_verification_pending_auto_transition_failed", {
      leadId: input.leadId,
      paymentId: payment.id,
      error
    });
  }

  try {
    await triggerUtrPendingNotification({
      paymentId: payment.id,
      leadId: payment.leadId,
      amount: payment.amount.toString(),
      utrNumber: payment.utrNumber,
      submittedByUserId: input.actor.id,
      submittedByRole: input.actor.role
    });
  } catch (error) {
    console.error("utr_pending_notification_failed", {
      paymentId: payment.id,
      leadId: payment.leadId,
      error
    });
  }

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
  allowRoles("FIELD_EXECUTIVE"),
  validateBody(createQrUtrPaymentSchema),
  async (req, res) => {
    const body = req.body as z.infer<typeof createQrUtrPaymentSchema>;
    assertClientTokenAmountNotTampered(body.amount);
    const payment = await createPendingQrUtrPayment({
      leadId: body.leadId,
      utrNumber: body.utrNumber,
      actor: req.user!,
      actorIpAddress: requestIp(req)
    });
    return created(
      res,
      payment,
      `QR-UTR payment submitted for verification (INR ${TOKEN_PAYMENT_AMOUNT_INR.toFixed(2)})`
    );
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
  allowRoles("FIELD_EXECUTIVE"),
  validateBody(createPaymentSchema),
  async (req, res) => {
    const body = req.body as z.infer<typeof createPaymentSchema>;
    assertClientTokenAmountNotTampered(body.amount);

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

    if (req.user!.role === "MANAGER") {
      whereClauses.push({
        lead: {
          is: managerDistrictLeadScope(req.user!.id)
        }
      });
    } else if (req.user!.role !== "SUPER_ADMIN" && req.user!.role !== "ADMIN") {
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
    if (existing.method !== PaymentMethod.QR_UTR) {
      throw new AppError(
        400,
        "PAYMENT_METHOD_REVIEW_NOT_ALLOWED",
        "Only QR UTR payments can be manually verified or rejected from this endpoint"
      );
    }
    if (req.user!.role === "MANAGER") {
      const accessibleLead = await prisma.lead.findFirst({
        where: {
          AND: [{ id: existing.leadId }, managerDistrictLeadScope(req.user!.id)]
        },
        select: { id: true }
      });
      if (!accessibleLead) {
        throw new AppError(404, "NOT_FOUND", "Payment not found");
      }
    } else if (req.user!.role !== "SUPER_ADMIN" && req.user!.role !== "ADMIN") {
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
      if (body.action === "verify") {
        const alreadyVerifiedForLead = await tx.payment.findFirst({
          where: {
            leadId: existing.leadId,
            status: PaymentStatus.VERIFIED,
            id: {
              not: existing.id
            }
          },
          select: {
            id: true
          }
        });
        if (alreadyVerifiedForLead) {
          throw new AppError(
            409,
            "TOKEN_PAYMENT_ALREADY_CONFIRMED",
            "A successful token payment already exists for this lead"
          );
        }
      }

      const marked = await tx.payment.updateMany({
        where: {
          id: existing.id,
          status: PaymentStatus.PENDING
        },
        data: {
          status: updatedStatus,
          rejectionReason: body.action === "reject" ? actionNote : null,
          verifiedByUserId: req.user!.id,
          verifiedAt: new Date()
        }
      });
      if (marked.count === 0) {
        throw new AppError(
          409,
          "PAYMENT_ALREADY_REVIEWED",
          "Only pending payments can be reviewed"
        );
      }

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
            statusUpdatedAt: new Date(),
            isOverdue: false,
            overdueAt: null,
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
      try {
        await queueLeadStatusCustomerNotification({
          leadId: existing.leadId,
          toStatusId: tokenPaymentVerifiedStatus.id,
          changedByUserId: req.user?.id,
          transitionNotes: actionNote
        });
      } catch (error) {
        console.error("payment_verified_customer_notification_failed", {
          paymentId: existing.id,
          leadId: existing.leadId,
          error
        });
      }
    }

    if (body.action === "reject" && existing.lead.assignedExecutiveId) {
      try {
        await notifyUsers(
          [existing.lead.assignedExecutiveId],
          "UTR rejected",
          `Payment UTR for lead ${existing.lead.externalId} was rejected. Please submit UTR again.`,
          {
            type: "UTR_REJECTED",
            leadId: existing.leadId,
            entityType: "payment",
            entityId: existing.id,
            metadata: {
              externalId: existing.lead.externalId
            }
          }
        );
      } catch (error) {
        console.error("utr_rejected_notification_failed", {
          paymentId: existing.id,
          leadId: existing.leadId,
          error
        });
      }
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
    assertClientTokenAmountNotTampered(body.amount);
    assertTokenAmountIsConfigured();
    const lead = await assertLeadExists(body.leadId, req.user!);
    assertActorCanInitiateTokenPayment(req.user!, lead);
    await assertNoVerifiedTokenPayment(lead.id);

    if (body.currency !== "INR") {
      throw new AppError(
        400,
        "VALIDATION_ERROR",
        "Only INR is supported for token payment collection"
      );
    }
    const customerUpiId = normalizeUpiId(body.customerUpiId ?? "");
    if (!customerUpiId) {
      throw new AppError(400, "VALIDATION_ERROR", "customerUpiId is required");
    }
    assertValidUpiId(customerUpiId);

    const receipt =
      body.receipt ??
      `token-${lead.externalId.slice(0, 8)}-${Date.now().toString().slice(-8)}`;

    const requestNotes = {
      leadId: lead.id,
      leadExternalId: lead.externalId,
      requestedByUserId: req.user!.id,
      customerUpiId,
      ...(body.notes ?? {})
    };

    const collectRequest = await createRazorpayUpiCollectRequest({
      amountInPaise: TOKEN_PAYMENT_AMOUNT_PAISE,
      currency: "INR",
      receipt,
      notes: requestNotes,
      customerUpiId,
      customerPhone: lead.phone,
      customerEmail: lead.email
    });

    const payment = await prisma.payment.create({
      data: {
        leadId: lead.id,
        amount: TOKEN_PAYMENT_AMOUNT_INR,
        method: PaymentMethod.UPI_GATEWAY,
        provider: "razorpay",
        upiId: customerUpiId,
        status: PaymentStatus.PENDING,
        gatewayOrderId: collectRequest.order_id ?? null,
        gatewayRequestId: collectRequest.id,
        gatewayStatus: collectRequest.status ?? null,
        providerPayload: sanitizePaymentPayloadForStorage(collectRequest),
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
      action: "PAYMENT_UPI_COLLECT_REQUEST_CREATED",
      entityType: "payment_gateway_request",
      entityId: collectRequest.id,
      detailsJson: {
        provider: "razorpay",
        leadId: lead.id,
        externalId: lead.externalId,
        amount: TOKEN_PAYMENT_AMOUNT_INR,
        currency: "INR",
        receipt,
        customerUpiId: maskUpiIdForLog(customerUpiId),
        gatewayOrderId: collectRequest.order_id ?? null,
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
        amountInr: TOKEN_PAYMENT_AMOUNT_INR,
        orderId: collectRequest.order_id ?? null,
        requestId: collectRequest.id,
        collectRequest: {
          id: collectRequest.id,
          orderId: collectRequest.order_id ?? null,
          status: collectRequest.status,
          upiId: collectRequest.vpa ?? customerUpiId,
          amount: TOKEN_PAYMENT_AMOUNT_INR,
          currency: "INR",
          createdAt: collectRequest.created_at
            ? new Date(collectRequest.created_at * 1000).toISOString()
            : new Date().toISOString()
        },
        payment: {
          id: payment.id,
          leadId: payment.leadId,
          externalId: payment.lead.externalId,
          amount: payment.amount,
          method: payment.method,
          status: payment.status,
          provider: payment.provider,
          upiId: payment.upiId,
          gatewayOrderId: payment.gatewayOrderId,
          gatewayRequestId: payment.gatewayRequestId
        }
      },
      "Razorpay UPI collect request created"
    );
  }
);

paymentsRouter.post(
  "/gateway/payu/order",
  allowRoles("SUPER_ADMIN", "ADMIN", "DISTRICT_MANAGER", "FIELD_EXECUTIVE"),
  validateBody(gatewayOrderSchema),
  async (req, res) => {
    const body = req.body as z.infer<typeof gatewayOrderSchema>;
    assertClientTokenAmountNotTampered(body.amount);
    assertTokenAmountIsConfigured();
    const lead = await assertLeadExists(body.leadId, req.user!);
    assertActorCanInitiateTokenPayment(req.user!, lead);
    await assertNoVerifiedTokenPayment(lead.id);
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
        amount: TOKEN_PAYMENT_AMOUNT_INR,
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
        amount: TOKEN_PAYMENT_AMOUNT_INR,
        currency: body.currency,
        receipt: body.receipt ?? `lead-${lead.externalId}`,
        notes: body.notes ?? {},
        expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString()
      },
      "PayU order placeholder created"
    );
  }
);
