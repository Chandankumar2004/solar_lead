import { createHash, randomBytes } from "node:crypto";
import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";

const DEFAULT_SETUP_PASSWORD_TTL_HOURS = 48;

function normalizePortalBaseUrl(value: string | null | undefined) {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function firstOriginFromList(value: string | null | undefined) {
  const first = (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0);
  return first ?? null;
}

export function hashSetupPasswordToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function setupPasswordTokenTtlHours() {
  const configured = Number(process.env.SETUP_PASSWORD_TOKEN_TTL_HOURS ?? "");
  if (Number.isFinite(configured) && configured > 0) {
    return Math.min(Math.floor(configured), 7 * 24);
  }
  return DEFAULT_SETUP_PASSWORD_TTL_HOURS;
}

export function setupPasswordExpiresAt() {
  return new Date(Date.now() + setupPasswordTokenTtlHours() * 60 * 60 * 1000);
}

export function generateSetupPasswordToken() {
  return randomBytes(32).toString("hex");
}

export function buildSetupPasswordLink(token: string) {
  const fromAdminPortal = normalizePortalBaseUrl(process.env.ADMIN_PORTAL_URL);
  const fromFrontend = normalizePortalBaseUrl(env.FRONTEND_URL);
  const fromWebOrigin = normalizePortalBaseUrl(firstOriginFromList(env.WEB_ORIGIN));
  const baseUrl = fromAdminPortal ?? fromFrontend ?? fromWebOrigin ?? "http://localhost:3200";
  const url = new URL("/setup-password", baseUrl);
  url.searchParams.set("token", token);
  return url.toString();
}

export async function findUsableSetupPasswordToken(token: string) {
  const tokenHash = hashSetupPasswordToken(token);
  return prisma.userSetupPasswordToken.findFirst({
    where: {
      tokenHash,
      usedAt: null,
      expiresAt: {
        gt: new Date()
      }
    },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          fullName: true,
          role: true,
          status: true
        }
      }
    }
  });
}
