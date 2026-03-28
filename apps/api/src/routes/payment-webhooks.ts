import { createHash, createHmac, timingSafeEqual } from "crypto";
import { PaymentMethod, PaymentStatus, Prisma } from "@prisma/client";
import { Router, type Request } from "express";
import { env } from "../config/env.js";
import { AppError } from "../lib/errors.js";
import { ok } from "../lib/http.js";
import { prisma } from "../lib/prisma.js";
import { getTokenPaymentReceivedStatus } from "../services/lead-status.service.js";
import { sanitizePaymentPayloadForStorage } from "../services/payment-security.service.js";
import {
  notifyUsers,
  queueLeadStatusCustomerNotification
} from "../services/notification.service.js";

export const paymentWebhooksRouter = Router();

type RazorpayPaymentEntity = {
  id?: string;
  order_id?: string;
  status?: string;
  amount?: number;
  currency?: string;
  vpa?: string;
  notes?: Record<string, unknown>;
  error_description?: string;
  error_reason?: string;
};

type RazorpayWebhookPayload = {
  event?: string;
  payload?: {
    payment?: {
      entity?: RazorpayPaymentEntity;
    };
  };
};

function readRawBody(req: Request) {
  if (Buffer.isBuffer(req.body)) {
    return req.body;
  }
  if (typeof req.body === "string") {
    return Buffer.from(req.body, "utf8");
  }
  if (req.body && typeof req.body === "object") {
    return Buffer.from(JSON.stringify(req.body), "utf8");
  }
  return Buffer.from("", "utf8");
}

function parseWebhookBody(rawBody: Buffer) {
  try {
    const parsed = JSON.parse(rawBody.toString("utf8")) as RazorpayWebhookPayload;
    return parsed;
  } catch {
    throw new AppError(400, "INVALID_WEBHOOK_PAYLOAD", "Webhook payload must be valid JSON");
  }
}

function normalizeSignature(raw: string | undefined) {
  return (raw ?? "").trim();
}

function isValidSignature(expected: string, received: string) {
  const expectedBytes = Buffer.from(expected, "utf8");
  const receivedBytes = Buffer.from(received, "utf8");
  if (expectedBytes.length !== receivedBytes.length) {
    return false;
  }
  return timingSafeEqual(expectedBytes, receivedBytes);
}

function verifyRazorpaySignature(rawBody: Buffer, signature: string) {
  const webhookSecret = env.RAZORPAY_WEBHOOK_SECRET?.trim();
  if (!webhookSecret) {
    throw new AppError(
      503,
      "RAZORPAY_WEBHOOK_NOT_CONFIGURED",
      "Razorpay webhook secret is not configured"
    );
  }

  const expected = createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
  if (!isValidSignature(expected, signature)) {
    throw new AppError(401, "INVALID_WEBHOOK_SIGNATURE", "Invalid Razorpay webhook signature");
  }
}

function readRazorpayEventId(req: Request, rawBody: Buffer) {
  const headerEventId = req.header("x-razorpay-event-id")?.trim();
  if (headerEventId) {
    return headerEventId;
  }
  return `razorpay-${createHash("sha256").update(rawBody).digest("hex")}`;
}

function isUuid(value: string | undefined | null) {
  if (!value) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

function normalizePaymentStatus(status: string | undefined | null) {
  return (status ?? "").trim().toLowerCase();
}

function isSuccessEvent(eventType: string, paymentStatus: string) {
  if (eventType === "payment.captured") return true;
  if (eventType === "order.paid") return true;
  return paymentStatus === "captured";
}

function isFailureEvent(eventType: string, paymentStatus: string) {
  if (eventType === "payment.failed") return true;
  return paymentStatus === "failed";
}

async function findUpiGatewayPayment(input: {
  tx: Prisma.TransactionClient;
  paymentId: string | null;
  gatewayOrderId: string | null;
  leadIdFromNotes: string | null;
}) {
  const orClauses: Prisma.PaymentWhereInput[] = [];
  if (input.paymentId) {
    orClauses.push({ gatewayPaymentId: input.paymentId });
    orClauses.push({ gatewayRequestId: input.paymentId });
  }
  if (input.gatewayOrderId) {
    orClauses.push({ gatewayOrderId: input.gatewayOrderId });
  }
  if (input.leadIdFromNotes) {
    orClauses.push({ leadId: input.leadIdFromNotes });
  }
  if (!orClauses.length) {
    return null;
  }

  return input.tx.payment.findFirst({
    where: {
      method: PaymentMethod.UPI_GATEWAY,
      OR: orClauses
    },
    orderBy: { createdAt: "desc" },
    include: {
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
}

paymentWebhooksRouter.post("/", async (req, res) => {
  const signature = normalizeSignature(req.header("x-razorpay-signature"));
  if (!signature) {
    throw new AppError(400, "MISSING_WEBHOOK_SIGNATURE", "Missing Razorpay webhook signature");
  }

  const rawBody = readRawBody(req);
  verifyRazorpaySignature(rawBody, signature);

  const payload = parseWebhookBody(rawBody);
  const eventType = (payload.event ?? "unknown").trim();
  const paymentEntity = payload.payload?.payment?.entity ?? {};
  const gatewayPaymentId = typeof paymentEntity.id === "string" ? paymentEntity.id : null;
  const gatewayOrderId =
    typeof paymentEntity.order_id === "string" ? paymentEntity.order_id : null;
  const gatewayStatus = normalizePaymentStatus(paymentEntity.status);
  const upiId = typeof paymentEntity.vpa === "string" ? paymentEntity.vpa.trim() : null;
  const eventId = readRazorpayEventId(req, rawBody);

  const notes = paymentEntity.notes ?? {};
  const leadIdFromNotes =
    typeof notes.leadId === "string" && isUuid(notes.leadId) ? notes.leadId : null;
  const sanitizedPayload = sanitizePaymentPayloadForStorage(payload);

  let webhookEvent = await prisma.paymentWebhookEvent.findUnique({
    where: { eventId },
    select: {
      id: true,
      processed: true
    }
  });

  if (!webhookEvent) {
    try {
      webhookEvent = await prisma.paymentWebhookEvent.create({
        data: {
          provider: "razorpay",
          eventId,
          eventType,
          gatewayOrderId,
          gatewayPaymentId,
          signature,
          payload: sanitizedPayload,
          processed: false
        },
        select: {
          id: true,
          processed: true
        }
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        webhookEvent = await prisma.paymentWebhookEvent.findUnique({
          where: { eventId },
          select: {
            id: true,
            processed: true
          }
        });
      } else {
        throw error;
      }
    }
  }

  if (!webhookEvent) {
    throw new AppError(500, "WEBHOOK_EVENT_PERSIST_FAILED", "Unable to persist webhook event");
  }

  if (webhookEvent.processed) {
    return ok(
      res,
      { eventId, duplicate: true },
      "Webhook already processed"
    );
  }

  const isSuccess = isSuccessEvent(eventType, gatewayStatus);
  const isFailure = isFailureEvent(eventType, gatewayStatus);

  const tokenReceivedStatus = isSuccess ? await getTokenPaymentReceivedStatus() : null;

  const processingResult = await prisma.$transaction(async (tx) => {
    const payment = await findUpiGatewayPayment({
      tx,
      paymentId: gatewayPaymentId,
      gatewayOrderId,
      leadIdFromNotes
    });

    if (!payment) {
      await tx.paymentWebhookEvent.update({
        where: { id: webhookEvent.id },
        data: {
          processed: true,
          processedAt: new Date(),
          processingNote: "payment_not_found",
          gatewayOrderId,
          gatewayPaymentId,
          payload: sanitizedPayload
        }
      });

      await tx.auditLog.create({
        data: {
          actorUserId: null,
          action: "PAYMENT_GATEWAY_WEBHOOK_UNMATCHED",
          entityType: "payment_gateway_event",
          entityId: eventId,
          detailsJson: {
            provider: "razorpay",
            eventType,
            gatewayOrderId,
            gatewayPaymentId
          },
          ipAddress: null
        }
      });

      return {
        processed: true,
        reason: "payment_not_found",
        paymentId: null,
        leadId: null,
        assignedExecutiveId: null,
        transitioned: false,
        transitionStatusId: null,
        newlyVerified: false
      };
    }

    if (!isSuccess && !isFailure) {
      await tx.paymentWebhookEvent.update({
        where: { id: webhookEvent.id },
        data: {
          processed: true,
          processedAt: new Date(),
          processingNote: "event_ignored",
          paymentId: payment.id,
          leadId: payment.leadId,
          gatewayOrderId: gatewayOrderId ?? payment.gatewayOrderId,
          gatewayPaymentId: gatewayPaymentId ?? payment.gatewayPaymentId,
          payload: sanitizedPayload
        }
      });

      return {
        processed: true,
        reason: "event_ignored",
        paymentId: payment.id,
        leadId: payment.leadId,
        assignedExecutiveId: payment.lead.assignedExecutiveId,
        transitioned: false,
        transitionStatusId: null,
        newlyVerified: false
      };
    }

    let transitioned = false;
    let transitionStatusId: string | null = null;
    let newlyVerified = false;

    if (isSuccess) {
      const resolvedGatewayPaymentId = gatewayPaymentId ?? payment.gatewayPaymentId;
      if (!resolvedGatewayPaymentId) {
        await tx.paymentWebhookEvent.update({
          where: { id: webhookEvent.id },
          data: {
            processed: true,
            processedAt: new Date(),
            processingNote: "missing_gateway_payment_id",
            paymentId: payment.id,
            leadId: payment.leadId,
            gatewayOrderId: gatewayOrderId ?? payment.gatewayOrderId,
            gatewayPaymentId: payment.gatewayPaymentId,
            payload: sanitizedPayload
          }
        });

        await tx.auditLog.create({
          data: {
            actorUserId: null,
            action: "PAYMENT_GATEWAY_WEBHOOK_IGNORED",
            entityType: "payment_gateway_event",
            entityId: eventId,
            detailsJson: {
              provider: "razorpay",
              eventType,
              reason: "missing_gateway_payment_id",
              leadId: payment.leadId,
              gatewayOrderId: gatewayOrderId ?? payment.gatewayOrderId
            },
            ipAddress: null
          }
        });

        return {
          processed: true,
          reason: "missing_gateway_payment_id",
          paymentId: payment.id,
          leadId: payment.leadId,
          assignedExecutiveId: payment.lead.assignedExecutiveId,
          transitioned: false,
          transitionStatusId: null,
          newlyVerified: false
        };
      }

      const duplicateVerified = await tx.payment.findFirst({
        where: {
          leadId: payment.leadId,
          status: PaymentStatus.VERIFIED,
          id: { not: payment.id }
        },
        select: {
          id: true
        }
      });

      if (!duplicateVerified) {
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: PaymentStatus.VERIFIED,
            provider: "razorpay",
            upiId: upiId ?? payment.upiId,
            gatewayOrderId: gatewayOrderId ?? payment.gatewayOrderId,
            gatewayRequestId:
              resolvedGatewayPaymentId ?? payment.gatewayRequestId ?? payment.gatewayPaymentId,
            gatewayPaymentId: resolvedGatewayPaymentId,
            gatewayStatus: gatewayStatus || paymentEntity.status || payment.gatewayStatus,
            webhookReferenceId: eventId,
            providerPayload: sanitizedPayload,
            rejectionReason: null,
            verifiedAt: new Date()
          }
        });
        newlyVerified = payment.status !== PaymentStatus.VERIFIED;

        if (
          tokenReceivedStatus &&
          payment.lead.currentStatusId !== tokenReceivedStatus.id
        ) {
          const allowedTransition = await tx.leadStatusTransition.findFirst({
            where: {
              fromStatusId: payment.lead.currentStatusId,
              toStatusId: tokenReceivedStatus.id
            },
            select: { id: true }
          });

          if (allowedTransition) {
            const historyActorId =
              payment.collectedByUserId ?? payment.lead.assignedExecutiveId ?? null;
            if (!historyActorId) {
              transitioned = false;
              transitionStatusId = null;
            } else {
              await tx.lead.update({
                where: { id: payment.leadId },
                data: {
                  currentStatusId: tokenReceivedStatus.id,
                  statusUpdatedAt: new Date(),
                  isOverdue: false,
                  overdueAt: null,
                  statusHistory: {
                    create: {
                      fromStatusId: payment.lead.currentStatusId,
                      toStatusId: tokenReceivedStatus.id,
                      changedByUserId: historyActorId,
                      notes: "Auto transition after Razorpay UPI payment capture"
                    }
                  }
                }
              });
              transitioned = true;
              transitionStatusId = tokenReceivedStatus.id;
            }
          }
        }
      }
    } else if (isFailure && payment.status !== PaymentStatus.VERIFIED) {
      const rejectionReason =
        paymentEntity.error_description ||
        paymentEntity.error_reason ||
        "Gateway reported payment failure";
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.REJECTED,
          provider: "razorpay",
          upiId: upiId ?? payment.upiId,
          gatewayOrderId: gatewayOrderId ?? payment.gatewayOrderId,
          gatewayRequestId:
            gatewayPaymentId ?? payment.gatewayRequestId ?? payment.gatewayPaymentId,
          gatewayPaymentId: gatewayPaymentId ?? payment.gatewayPaymentId,
          gatewayStatus: gatewayStatus || paymentEntity.status || payment.gatewayStatus,
          webhookReferenceId: eventId,
          providerPayload: sanitizedPayload,
          rejectionReason
        }
      });
    }

    await tx.paymentWebhookEvent.update({
      where: { id: webhookEvent.id },
      data: {
        processed: true,
        processedAt: new Date(),
        processingNote: isSuccess ? "success_processed" : "failure_processed",
        paymentId: payment.id,
        leadId: payment.leadId,
        gatewayOrderId: gatewayOrderId ?? payment.gatewayOrderId,
        gatewayPaymentId: gatewayPaymentId ?? payment.gatewayPaymentId,
        payload: sanitizedPayload
      }
    });

    await tx.auditLog.create({
      data: {
        actorUserId: null,
        action: isSuccess ? "PAYMENT_GATEWAY_CONFIRMED" : "PAYMENT_GATEWAY_FAILED",
        entityType: "payment",
        entityId: payment.id,
        detailsJson: {
          provider: "razorpay",
          eventType,
          eventId,
          leadId: payment.leadId,
          gatewayOrderId: gatewayOrderId ?? payment.gatewayOrderId,
          gatewayPaymentId: gatewayPaymentId ?? payment.gatewayPaymentId,
          transitioned,
          transitionStatusId
        },
        ipAddress: null
      }
    });

    return {
      processed: true,
      reason: isSuccess ? "success_processed" : "failure_processed",
      paymentId: payment.id,
      leadId: payment.leadId,
      assignedExecutiveId: payment.lead.assignedExecutiveId,
      transitioned,
      transitionStatusId,
      newlyVerified
    };
  });

  if (
    isSuccess &&
    processingResult.transitioned &&
    processingResult.leadId &&
    processingResult.transitionStatusId
  ) {
    try {
      await queueLeadStatusCustomerNotification({
        leadId: processingResult.leadId,
        toStatusId: processingResult.transitionStatusId,
        transitionNotes: "Token payment received via UPI gateway"
      });
    } catch (error) {
      console.error("payment_gateway_customer_notification_failed", {
        leadId: processingResult.leadId,
        paymentId: processingResult.paymentId,
        error
      });
    }
  }

  if (
    isSuccess &&
    processingResult.newlyVerified &&
    processingResult.assignedExecutiveId &&
    processingResult.leadId
  ) {
    try {
      await notifyUsers(
        [processingResult.assignedExecutiveId],
        "Token payment received",
        "Customer UPI token payment was received successfully.",
        {
          type: "LEAD_STATUS_UPDATED",
          leadId: processingResult.leadId,
          entityType: "payment",
          entityId: processingResult.paymentId ?? undefined,
          metadata: {
            provider: "razorpay",
            eventType
          }
        }
      );
    } catch (error) {
      console.error("payment_gateway_executive_notification_failed", {
        leadId: processingResult.leadId,
        paymentId: processingResult.paymentId,
        error
      });
    }
  }

  return ok(
    res,
    {
      eventId,
      eventType,
      processed: processingResult.processed,
      reason: processingResult.reason
    },
    "Razorpay webhook processed"
  );
});
