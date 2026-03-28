import { createHmac, timingSafeEqual } from "node:crypto";
import { AppError } from "../lib/errors.js";
import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";

export type CommunicationPreferenceChannel = "EMAIL" | "WHATSAPP";

type UnsubscribeTokenPayload = {
  v: 1;
  leadId: string;
  channel: CommunicationPreferenceChannel;
  recipient?: string;
  exp: number;
};

function resolvePreferenceSecret() {
  const secret =
    env.CUSTOMER_NOTIFICATION_UNSUBSCRIBE_SECRET?.trim() ||
    env.JWT_ACCESS_SECRET?.trim() ||
    env.JWT_REFRESH_SECRET?.trim() ||
    env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!secret || secret.length < 16) {
    throw new AppError(
      500,
      "COMMUNICATION_PREFERENCE_SECRET_MISSING",
      "Customer communication preference secret is not configured"
    );
  }
  return secret;
}

function base64UrlEncodeJson(value: unknown) {
  return Buffer.from(JSON.stringify(value), "utf-8").toString("base64url");
}

function base64UrlDecodeJson<T>(value: string) {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf-8")) as T;
}

function signPayload(encodedPayload: string, secret: string) {
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

function sanitizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function normalizeIndianPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (digits.length >= 10) {
    return digits.slice(-10);
  }
  return digits;
}

export function createUnsubscribeToken(input: {
  leadId: string;
  channel: CommunicationPreferenceChannel;
  recipient?: string | null;
}) {
  const secret = resolvePreferenceSecret();
  const ttlHours = env.CUSTOMER_UNSUBSCRIBE_TOKEN_TTL_HOURS;
  const nowSeconds = Math.floor(Date.now() / 1000);
  const payload: UnsubscribeTokenPayload = {
    v: 1,
    leadId: input.leadId,
    channel: input.channel,
    recipient: input.recipient?.trim() || undefined,
    exp: nowSeconds + ttlHours * 3600
  };
  const encodedPayload = base64UrlEncodeJson(payload);
  const signature = signPayload(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

export function verifyUnsubscribeToken(token: string): UnsubscribeTokenPayload {
  const secret = resolvePreferenceSecret();
  const parts = token.trim().split(".");
  if (parts.length !== 2) {
    throw new AppError(400, "INVALID_UNSUBSCRIBE_TOKEN", "Invalid unsubscribe token");
  }

  const [encodedPayload, providedSignature] = parts;
  const expectedSignature = signPayload(encodedPayload, secret);
  const providedBuffer = Buffer.from(providedSignature, "utf-8");
  const expectedBuffer = Buffer.from(expectedSignature, "utf-8");

  if (
    providedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    throw new AppError(400, "INVALID_UNSUBSCRIBE_TOKEN", "Invalid unsubscribe token");
  }

  let payload: UnsubscribeTokenPayload;
  try {
    payload = base64UrlDecodeJson<UnsubscribeTokenPayload>(encodedPayload);
  } catch {
    throw new AppError(400, "INVALID_UNSUBSCRIBE_TOKEN", "Invalid unsubscribe token");
  }

  if (
    payload.v !== 1 ||
    !payload.leadId ||
    (payload.channel !== "EMAIL" && payload.channel !== "WHATSAPP")
  ) {
    throw new AppError(400, "INVALID_UNSUBSCRIBE_TOKEN", "Invalid unsubscribe token");
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(payload.exp) || payload.exp < nowSeconds) {
    throw new AppError(400, "UNSUBSCRIBE_TOKEN_EXPIRED", "Unsubscribe token expired");
  }

  return payload;
}

export async function applyLeadChannelOptOut(input: {
  leadId: string;
  channel: CommunicationPreferenceChannel;
  source: string;
  ipAddress?: string | null;
  actorUserId?: string | null;
}) {
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const existing = await tx.lead.findUnique({
      where: { id: input.leadId },
      select: {
        id: true,
        externalId: true,
        emailOptOut: true,
        whatsappOptOut: true
      }
    });

    if (!existing) {
      throw new AppError(404, "NOT_FOUND", "Lead not found");
    }

    const updated = await tx.lead.update({
      where: { id: input.leadId },
      data: {
        ...(input.channel === "EMAIL" ? { emailOptOut: true } : { whatsappOptOut: true }),
        optOutTimestamp: now,
        optOutSource: input.source
      },
      select: {
        id: true,
        externalId: true,
        emailOptOut: true,
        whatsappOptOut: true,
        optOutTimestamp: true,
        optOutSource: true
      }
    });

    await tx.auditLog.create({
      data: {
        actorUserId: input.actorUserId ?? null,
        action: "CUSTOMER_CHANNEL_OPT_OUT_UPDATED",
        entityType: "lead",
        entityId: existing.id,
        detailsJson: {
          leadId: existing.id,
          externalId: existing.externalId,
          channel: input.channel,
          source: input.source,
          previous: {
            emailOptOut: existing.emailOptOut,
            whatsappOptOut: existing.whatsappOptOut
          },
          next: {
            emailOptOut: updated.emailOptOut,
            whatsappOptOut: updated.whatsappOptOut
          }
        },
        ipAddress: input.ipAddress ?? null
      }
    });

    return updated;
  });
}

export async function unsubscribeFromToken(input: {
  token: string;
  ipAddress?: string | null;
}) {
  const payload = verifyUnsubscribeToken(input.token);
  return applyLeadChannelOptOut({
    leadId: payload.leadId,
    channel: payload.channel,
    source: "UNSUBSCRIBE_LINK",
    ipAddress: input.ipAddress ?? null
  });
}

export async function applyLeadChannelOptOutByContact(input: {
  channel: CommunicationPreferenceChannel;
  source: string;
  phone?: string | null;
  email?: string | null;
  ipAddress?: string | null;
}) {
  let leadId = "";

  if (input.channel === "EMAIL") {
    const email = sanitizeEmail(input.email ?? "");
    if (!email) {
      throw new AppError(400, "VALIDATION_ERROR", "email is required for EMAIL opt-out");
    }

    const lead = await prisma.lead.findFirst({
      where: {
        email: {
          equals: email,
          mode: "insensitive"
        }
      },
      orderBy: { createdAt: "desc" },
      select: { id: true }
    });
    if (!lead) {
      throw new AppError(404, "NOT_FOUND", "Lead not found for provided email");
    }
    leadId = lead.id;
  } else {
    const normalizedPhone = normalizeIndianPhone(input.phone ?? "");
    if (normalizedPhone.length !== 10) {
      throw new AppError(400, "VALIDATION_ERROR", "phone is required for WHATSAPP opt-out");
    }

    const lead = await prisma.lead.findFirst({
      where: {
        OR: [
          { phone: normalizedPhone },
          { phone: `91${normalizedPhone}` },
          { phone: `+91${normalizedPhone}` },
          { phone: { endsWith: normalizedPhone } }
        ]
      },
      orderBy: { createdAt: "desc" },
      select: { id: true }
    });
    if (!lead) {
      throw new AppError(404, "NOT_FOUND", "Lead not found for provided phone");
    }
    leadId = lead.id;
  }

  return applyLeadChannelOptOut({
    leadId,
    channel: input.channel,
    source: input.source,
    ipAddress: input.ipAddress ?? null
  });
}

export async function markLeadSmsDndByPhone(input: {
  phone: string;
  source: string;
  ipAddress?: string | null;
}) {
  const normalizedPhone = normalizeIndianPhone(input.phone);
  if (normalizedPhone.length !== 10) {
    throw new AppError(400, "VALIDATION_ERROR", "phone is required for SMS DND update");
  }

  const lead = await prisma.lead.findFirst({
    where: {
      OR: [
        { phone: normalizedPhone },
        { phone: `91${normalizedPhone}` },
        { phone: `+91${normalizedPhone}` },
        { phone: { endsWith: normalizedPhone } }
      ]
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      externalId: true,
      smsDndStatus: true
    }
  });

  if (!lead) {
    throw new AppError(404, "NOT_FOUND", "Lead not found for provided phone");
  }

  const now = new Date();
  const updated = await prisma.lead.update({
    where: { id: lead.id },
    data: {
      smsDndStatus: true,
      optOutTimestamp: now,
      optOutSource: input.source
    },
    select: {
      id: true,
      externalId: true,
      smsDndStatus: true,
      optOutTimestamp: true,
      optOutSource: true
    }
  });

  await prisma.auditLog.create({
    data: {
      action: "CUSTOMER_SMS_DND_UPDATED",
      entityType: "lead",
      entityId: lead.id,
      detailsJson: {
        leadId: lead.id,
        externalId: lead.externalId,
        previousSmsDndStatus: lead.smsDndStatus,
        nextSmsDndStatus: updated.smsDndStatus,
        source: input.source
      },
      ipAddress: input.ipAddress ?? null
    }
  });

  return updated;
}

export function containsStopKeyword(message: string | null | undefined) {
  const normalized = (message ?? "").trim().toLowerCase();
  if (!normalized) return false;
  return /\b(stop|unsubscribe|opt\s*out|cancel)\b/i.test(normalized);
}

export function buildEmailUnsubscribeUrl(input: {
  leadId: string;
  recipient?: string | null;
}) {
  const baseUrl = env.CUSTOMER_NOTIFICATIONS_UNSUBSCRIBE_URL?.trim();
  if (!baseUrl) return null;

  const token = createUnsubscribeToken({
    leadId: input.leadId,
    channel: "EMAIL",
    recipient: input.recipient ?? null
  });

  try {
    const url = new URL(baseUrl);
    url.searchParams.set("token", token);
    return url.toString();
  } catch {
    const separator = baseUrl.includes("?") ? "&" : "?";
    return `${baseUrl}${separator}token=${encodeURIComponent(token)}`;
  }
}
