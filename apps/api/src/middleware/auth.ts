import { NextFunction, Request, Response } from "express";
import { fail } from "../lib/http.js";
import { env } from "../config/env.js";
import { resolveSessionUserFromAccessToken } from "../services/supabase-auth.service.js";

function bearerAccessToken(req: Request) {
  const rawHeader = req.header("authorization");
  if (!rawHeader) {
    return null;
  }

  const [scheme, token] = rawHeader.split(" ");
  if (!scheme || !token || scheme.toLowerCase() !== "bearer") {
    return null;
  }

  const trimmedToken = token.trim();
  return trimmedToken.length > 0 ? trimmedToken : null;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const fromBearer = bearerAccessToken(req);
  const accessCookieName = (env.ACCESS_COOKIE_NAME ?? "accessToken").trim() || "accessToken";
  const fromCookie = req.cookies?.[accessCookieName] as string | undefined;
  const token = fromBearer ?? fromCookie;
  if (!token) {
    return fail(res, 401, "UNAUTHORIZED", "Missing session");
  }

  const resolved = await resolveSessionUserFromAccessToken(token);
  if (!resolved.ok) {
    if (resolved.reason === "MISSING_SESSION") {
      return fail(res, 401, "UNAUTHORIZED", "Missing session");
    }
    if (resolved.reason === "INVALID_SESSION") {
      return fail(res, 401, "UNAUTHORIZED", "Invalid or expired session");
    }
    if (resolved.reason === "APP_PROFILE_NOT_FOUND") {
      return fail(
        res,
        403,
        "APP_PROFILE_NOT_FOUND",
        "No app profile mapped to this authenticated account"
      );
    }
    if (resolved.reason === "AUTH_CONFIG_ERROR") {
      return fail(res, 500, "AUTH_CONFIG_ERROR", "Authentication is not configured");
    }
    return fail(res, 500, "AUTH_BACKEND_ERROR", "Authentication service temporarily unavailable");
  }

  if (resolved.user.status !== "ACTIVE") {
    return fail(res, 401, "UNAUTHORIZED", "User is not active");
  }

  req.user = resolved.user;
  return next();
}
