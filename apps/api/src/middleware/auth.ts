import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { fail } from "../lib/http.js";
import { env } from "../config/env.js";
import { AuthUser } from "../types.js";
import { findSessionUserById } from "../services/auth.service.js";

interface AccessPayload {
  sub: string;
  email: string;
  role: AuthUser["role"];
  typ: "access";
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

  let user: Awaited<ReturnType<typeof findSessionUserById>> = null;
  try {
    user = await findSessionUserById(payload.sub);
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

  if (!user || user.status !== "ACTIVE") {
    return fail(res, 401, "UNAUTHORIZED", "User is not active");
  }

  req.user = user;
  return next();
}
