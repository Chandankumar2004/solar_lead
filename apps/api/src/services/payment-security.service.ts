import { Prisma } from "@prisma/client";

const FULL_REDACT_KEY_PATTERN =
  /(secret|token|password|authorization|auth|cvv|card|pan|expiry|exp_month|exp_year|otp)/i;
const MASKED_KEY_PATTERN =
  /(vpa|upi|email|phone|contact|mobile|account|ifsc)/i;

function maskString(value: string, visibleTail = 4) {
  const normalized = value.trim();
  if (!normalized) {
    return normalized;
  }
  if (normalized.length <= visibleTail) {
    return "*".repeat(normalized.length);
  }
  return `${"*".repeat(Math.max(1, normalized.length - visibleTail))}${normalized.slice(-visibleTail)}`;
}

function maskEmail(value: string) {
  const trimmed = value.trim();
  const at = trimmed.indexOf("@");
  if (at <= 1) {
    return maskString(trimmed);
  }
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  return `${local[0]}${"*".repeat(Math.max(1, local.length - 1))}@${domain}`;
}

function maskPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (!digits) {
    return maskString(value);
  }
  if (digits.length <= 4) {
    return "*".repeat(digits.length);
  }
  return `${"*".repeat(digits.length - 4)}${digits.slice(-4)}`;
}

export function maskUpiIdForLog(upiId: string | null | undefined) {
  if (!upiId) {
    return null;
  }
  const normalized = upiId.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  const atIndex = normalized.indexOf("@");
  if (atIndex <= 0) {
    return maskString(normalized);
  }
  const handle = normalized.slice(0, atIndex);
  const provider = normalized.slice(atIndex + 1);
  return `${maskString(handle, 2)}@${provider}`;
}

function sanitizeScalarByKey(key: string, value: string) {
  if (FULL_REDACT_KEY_PATTERN.test(key)) {
    return "[REDACTED]";
  }
  if (MASKED_KEY_PATTERN.test(key)) {
    const lowered = key.toLowerCase();
    if (lowered.includes("email")) {
      return maskEmail(value);
    }
    if (
      lowered.includes("phone") ||
      lowered.includes("contact") ||
      lowered.includes("mobile")
    ) {
      return maskPhone(value);
    }
    if (lowered.includes("upi") || lowered.includes("vpa")) {
      return maskUpiIdForLog(value) ?? "[REDACTED]";
    }
    return maskString(value);
  }
  return value;
}

function sanitizeValue(
  value: unknown,
  keyHint?: string
): Prisma.InputJsonValue | null {
  if (value === null) {
    return null;
  }
  if (typeof value === "string") {
    return keyHint ? sanitizeScalarByKey(keyHint, value) : value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeValue(entry));
  }
  if (typeof value === "object") {
    const input = value as Record<string, unknown>;
    const out: Record<string, Prisma.InputJsonValue | null> = {};
    for (const [key, child] of Object.entries(input)) {
      if (child === undefined) {
        continue;
      }
      if (FULL_REDACT_KEY_PATTERN.test(key)) {
        out[key] = "[REDACTED]";
        continue;
      }
      out[key] = sanitizeValue(child, key);
    }
    return out;
  }
  return String(value) as Prisma.InputJsonValue;
}

export function sanitizePaymentPayloadForStorage(value: unknown): Prisma.InputJsonValue {
  const sanitized = sanitizeValue(value);
  return sanitized ?? {};
}
