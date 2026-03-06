import { Prisma } from "@prisma/client";
import { Request } from "express";
import { prisma } from "../lib/prisma.js";

export async function createAuditLog(input: {
  actorUserId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  detailsJson?: unknown;
  ipAddress?: string | null;
}) {
  const details =
    input.detailsJson === undefined
      ? Prisma.JsonNull
      : (JSON.parse(JSON.stringify(input.detailsJson)) as Prisma.InputJsonValue);

  try {
    return await prisma.auditLog.create({
      data: {
        actorUserId: input.actorUserId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        detailsJson: details,
        ipAddress: input.ipAddress ?? null
      }
    });
  } catch (error) {
    console.error("audit_log_write_failed", error);
    return null;
  }
}

export function requestIp(req: Request) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length) {
    return forwarded.split(",")[0].trim();
  }
  return req.ip || null;
}
