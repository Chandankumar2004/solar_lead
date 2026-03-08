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

function normalizeRole(rawRole: string): UserRole | null {
  const role = rawRole.trim().toUpperCase();
  if (role === "SUPER_ADMIN") return "SUPER_ADMIN";
  if (role === "ADMIN") return "ADMIN";
  if (role === "MANAGER" || role === "DISTRICT_MANAGER") return "MANAGER";
  if (role === "EXECUTIVE" || role === "FIELD_EXECUTIVE") return "EXECUTIVE";
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
      const fallbackRows = await prisma.$queryRaw<
        Array<{
          id: string;
          email: string;
          fullName: string;
          role: string;
          status: string;
        }>
      >`
        SELECT
          id::text AS "id",
          email,
          full_name AS "fullName",
          role::text AS "role",
          status::text AS "status"
        FROM users
        WHERE id = ${payload.sub}::uuid
        LIMIT 1
      `;

      const row = fallbackRows[0];
      if (row) {
        const role = normalizeRole(row.role);
        const status = normalizeStatus(row.status);
        if (role && status) {
          user = {
            id: row.id,
            email: row.email,
            fullName: row.fullName,
            role,
            status
          };
        } else {
          console.error("AUTH_ME_ERROR", {
            reason: "USER_ENUM_MISMATCH",
            userId: row.id,
            requestId: req.requestId ?? null
          });
          console.error("auth_user_enum_mismatch", {
            userId: row.id,
            role: row.role,
            status: row.status
          });
        }
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
