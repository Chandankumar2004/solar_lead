import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { UserRole, UserStatus } from "@prisma/client";
import { fail } from "../lib/http.js";
import { env } from "../config/env.js";
import { AuthUser } from "../types.js";
import { prisma } from "../lib/prisma.js";

interface AccessPayload {
  sub: string;
  email: string;
  role: AuthUser["role"];
  typ: "access";
}

type LooseDbRow = Record<string, unknown>;

function readString(row: LooseDbRow, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function normalizeRole(rawRole: string): UserRole | null {
  const role = rawRole.trim().toUpperCase();
  if (role === "SUPER_ADMIN") return "SUPER_ADMIN";
  if (role === "SUPERADMIN") return "SUPER_ADMIN";
  if (role === "SUPER-ADMIN") return "SUPER_ADMIN";
  if (role === "ADMIN") return "ADMIN";
  if (role === "MANAGER" || role === "DISTRICT_MANAGER") return "MANAGER";
  if (role === "DISTRICT-MANAGER" || role === "DISTRICTMANAGER") return "MANAGER";
  if (role === "EXECUTIVE" || role === "FIELD_EXECUTIVE") return "EXECUTIVE";
  if (role === "FIELD-EXECUTIVE" || role === "FIELDEXECUTIVE") return "EXECUTIVE";
  return null;
}

function normalizeStatus(rawStatus: string): UserStatus | null {
  const status = rawStatus.trim().toUpperCase();
  if (status === "ACTIVE") return "ACTIVE";
  if (status === "PENDING") return "PENDING";
  if (status === "SUSPENDED") return "SUSPENDED";
  return null;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const accessCookieName = (env.ACCESS_COOKIE_NAME ?? "accessToken").trim() || "accessToken";
  const token = req.cookies?.[accessCookieName] as string | undefined;
  if (!token) {
    return fail(res, 401, "UNAUTHORIZED", "Missing access token");
  }

  const accessSecret = (env.JWT_ACCESS_SECRET ?? process.env.JWT_ACCESS_SECRET ?? "").trim();
  if (accessSecret.length < 16) {
    console.error("AUTH_ME_ERROR", {
      reason: "JWT_ACCESS_SECRET_MISSING_OR_INVALID",
      requestId: req.requestId ?? null
    });
    return fail(res, 500, "AUTH_CONFIG_ERROR", "Authentication is not configured");
  }

  let payload: AccessPayload;
  try {
    payload = jwt.verify(token, accessSecret) as AccessPayload;
  } catch {
    return fail(res, 401, "UNAUTHORIZED", "Invalid or expired access token");
  }

  if (payload.typ !== "access" || !payload.sub) {
    return fail(res, 401, "UNAUTHORIZED", "Invalid token payload");
  }

  let user = null as
    | {
        id: string;
        email: string;
        fullName: string;
        role: UserRole;
        status: UserStatus;
      }
    | null;

  try {
    user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        status: true
      }
    });
  } catch (error) {
    console.error("AUTH_ME_ERROR", {
      reason: "USER_LOOKUP_FAILED",
      userId: payload.sub,
      requestId: req.requestId ?? null
    });
    console.error("auth_user_find_failed", {
      userId: payload.sub,
      error
    });
  }

  if (!user) {
    try {
      const fallbackCandidates = [
        () =>
          prisma.$queryRaw<Array<LooseDbRow>>`
            SELECT *
            FROM public.users
            WHERE id::text = ${payload.sub}
            LIMIT 1
          `,
        () =>
          prisma.$queryRaw<Array<LooseDbRow>>`
            SELECT *
            FROM public."User"
            WHERE "id"::text = ${payload.sub}
            LIMIT 1
          `
      ];

      let row: LooseDbRow | null = null;
      for (const candidate of fallbackCandidates) {
        try {
          const rows = await candidate();
          if (rows[0]) {
            row = rows[0];
            break;
          }
        } catch (error) {
          console.error("AUTH_ME_ERROR", {
            reason: "FALLBACK_USER_LOOKUP_QUERY_FAILED",
            userId: payload.sub,
            requestId: req.requestId ?? null
          });
          console.error("auth_user_fallback_query_failed", {
            userId: payload.sub,
            error
          });
        }
      }

      if (row) {
        const id = readString(row, ["id", "ID", "user_id", "userId"]);
        const email = readString(row, ["email", "Email", "EMAIL"]);
        const fullName = readString(row, ["full_name", "fullName", "fullname", "name"]) ?? email;
        const rawRole = readString(row, ["role", "user_role", "userRole"]);
        const rawStatus = readString(row, ["status", "user_status", "userStatus"]);
        const role = rawRole ? normalizeRole(rawRole) : null;
        const status = rawStatus ? normalizeStatus(rawStatus) : null;

        if (id && email && fullName && role && status) {
          user = {
            id,
            email,
            fullName,
            role,
            status
          };
        } else {
          console.error("AUTH_ME_ERROR", {
            reason: "USER_ENUM_MISMATCH",
            userId: id ?? payload.sub,
            requestId: req.requestId ?? null
          });
          console.error("auth_user_enum_mismatch", {
            userId: id ?? payload.sub,
            role: rawRole,
            status: rawStatus
          });
        }
      } else {
        console.error("AUTH_ME_ERROR", {
          reason: "FALLBACK_USER_NOT_FOUND",
          userId: payload.sub,
          requestId: req.requestId ?? null
        });
      }
    } catch (error) {
      console.error("AUTH_ME_ERROR", {
        reason: "FALLBACK_USER_LOOKUP_FAILED",
        userId: payload.sub,
        requestId: req.requestId ?? null
      });
      console.error("auth_user_fallback_failed", {
        userId: payload.sub,
        error
      });
    }
  }

  if (!user || user.status !== "ACTIVE") {
    return fail(res, 401, "UNAUTHORIZED", "User is not active");
  }

  req.user = user;
  return next();
}
