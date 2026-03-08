import { Router } from "express";
import { z } from "zod";
import { loginSchema } from "@solar/shared";
import { fail, ok } from "../lib/http.js";
import {
  changePassword,
  login,
  revokeRefreshToken,
  rotateRefreshToken
} from "../services/auth.service.js";
import { requireAuth } from "../middleware/auth.js";
import { env } from "../config/env.js";
import { createAuditLog, requestIp } from "../services/audit-log.service.js";
import { toRbacRole, ROLE_LABEL } from "../middleware/rbac.js";
import { validateBody } from "../middleware/validate.js";

export const authRouter = Router();

const accessCookieName = (env.ACCESS_COOKIE_NAME ?? "accessToken").trim() || "accessToken";
const refreshCookieName = (env.REFRESH_COOKIE_NAME ?? "refreshToken").trim() || "refreshToken";

const isSecureCookieEnv =
  env.NODE_ENV === "production" ||
  process.env.RENDER === "true" ||
  Boolean(process.env.RENDER_EXTERNAL_URL);
const cookieSameSite = isSecureCookieEnv ? ("none" as const) : ("lax" as const);

function hasJwtSecrets() {
  const accessSecret = (env.JWT_ACCESS_SECRET ?? process.env.JWT_ACCESS_SECRET ?? "").trim();
  const refreshSecret = (env.JWT_REFRESH_SECRET ?? process.env.JWT_REFRESH_SECRET ?? "").trim();
  return accessSecret.length >= 16 && refreshSecret.length >= 16;
}

const refreshCookieConfig = {
  httpOnly: true,
  secure: isSecureCookieEnv,
  sameSite: cookieSameSite,
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: "/"
};

const accessCookieConfig = {
  httpOnly: true,
  secure: isSecureCookieEnv,
  sameSite: cookieSameSite,
  maxAge: 15 * 60 * 1000,
  path: "/"
};

const clearCookieConfig = {
  httpOnly: true,
  secure: isSecureCookieEnv,
  sameSite: cookieSameSite,
  path: "/"
};

const changePasswordSchema = z.object({
  currentPassword: z.string().min(8),
  newPassword: z.string().min(12)
}).refine((data) => data.currentPassword !== data.newPassword, {
  message: "New password must differ from current password",
  path: ["newPassword"]
});

authRouter.post("/login", async (req, res) => {
  try {
    const rawEmail = typeof req.body?.email === "string" ? req.body.email.trim() : "";
    const rawPassword = typeof req.body?.password === "string" ? req.body.password : "";

    if (!rawEmail || !rawPassword) {
      await createAuditLog({
        action: "LOGIN_FAILED",
        entityType: "auth",
        detailsJson: {
          reason: "MISSING_EMAIL_OR_PASSWORD",
          email: rawEmail || null
        },
        ipAddress: requestIp(req)
      });
      return fail(res, 400, "VALIDATION_ERROR", "Email and password are required");
    }

    const parsed = loginSchema.safeParse({ email: rawEmail, password: rawPassword });
    if (!parsed.success) {
      await createAuditLog({
        action: "LOGIN_FAILED",
        entityType: "auth",
        detailsJson: {
          reason: "VALIDATION_ERROR",
          email: rawEmail
        },
        ipAddress: requestIp(req)
      });
      return fail(res, 400, "VALIDATION_ERROR", "Invalid login payload", parsed.error);
    }

    if (!hasJwtSecrets()) {
      console.error("AUTH_LOGIN_ERROR", {
        reason: "JWT_SECRETS_MISSING_OR_INVALID",
        requestId: req.requestId ?? null
      });
      return fail(res, 500, "AUTH_CONFIG_ERROR", "Authentication is not configured");
    }

    const body = parsed.data;
    const result = await login(body.email, body.password);
    if (!result.ok) {
      const reasonMessage =
        result.reason === "ACCOUNT_PENDING"
          ? "Your account is pending approval"
          : result.reason === "ACCOUNT_SUSPENDED"
            ? "Your account is suspended"
            : result.reason === "AUTH_CONFIG_ERROR"
              ? "Authentication is not configured"
              : "Invalid email/password";

      await createAuditLog({
        actorUserId: result.userId ?? null,
        action: "LOGIN_FAILED",
        entityType: "auth",
        detailsJson: {
          email: body.email,
          reason: result.reason
        },
        ipAddress: requestIp(req)
      });

      const statusCode =
        result.reason === "INVALID_CREDENTIALS"
          ? 401
          : result.reason === "AUTH_CONFIG_ERROR"
            ? 500
            : 403;

      if (result.reason === "AUTH_CONFIG_ERROR") {
        console.error("AUTH_LOGIN_ERROR", {
          reason: "TOKEN_GENERATION_FAILED",
          userId: result.userId ?? null,
          requestId: req.requestId ?? null
        });
      }

      return fail(res, statusCode, result.reason, reasonMessage);
    }

    res.cookie(accessCookieName, result.accessToken, accessCookieConfig);
    res.cookie(refreshCookieName, result.refreshToken, refreshCookieConfig);

    await createAuditLog({
      actorUserId: result.user.id,
      action: "LOGIN_SUCCESS",
      entityType: "auth",
      detailsJson: { email: result.user.email },
      ipAddress: requestIp(req)
    });

    return ok(
      res,
      {
        user: {
          id: result.user.id,
          email: result.user.email,
          fullName: result.user.fullName,
          role: toRbacRole(result.user.role),
          roleLabel: ROLE_LABEL[toRbacRole(result.user.role)],
          status: result.user.status
        }
      },
      "Logged in"
    );
  } catch (error) {
    console.error("AUTH_LOGIN_ERROR", {
      requestId: req.requestId ?? null,
      error
    });
    return fail(res, 500, "INTERNAL_ERROR", "Unexpected server error", {
      requestId: req.requestId ?? null
    });
  }
});

authRouter.post("/refresh", async (req, res) => {
  try {
    if (!hasJwtSecrets()) {
      console.error("AUTH_REFRESH_ERROR", {
        reason: "JWT_SECRETS_MISSING_OR_INVALID",
        requestId: req.requestId ?? null
      });
      return fail(res, 500, "AUTH_CONFIG_ERROR", "Authentication is not configured");
    }

    const refreshToken = req.cookies?.[refreshCookieName] as string | undefined;
    if (!refreshToken) {
      await createAuditLog({
        action: "TOKEN_REFRESH_FAILED",
        entityType: "auth",
        detailsJson: { reason: "MISSING_REFRESH_COOKIE" },
        ipAddress: requestIp(req)
      });
      return fail(res, 401, "UNAUTHORIZED", "Missing refresh token");
    }

    const rotated = await rotateRefreshToken(refreshToken);
    if (!rotated) {
      await createAuditLog({
        action: "TOKEN_REFRESH_FAILED",
        entityType: "auth",
        detailsJson: { reason: "INVALID_REFRESH_TOKEN" },
        ipAddress: requestIp(req)
      });
      return fail(res, 401, "UNAUTHORIZED", "Invalid refresh token");
    }

    res.cookie(accessCookieName, rotated.accessToken, accessCookieConfig);
    res.cookie(refreshCookieName, rotated.refreshToken, refreshCookieConfig);

    await createAuditLog({
      actorUserId: rotated.user.id,
      action: "TOKEN_REFRESH_SUCCESS",
      entityType: "auth",
      detailsJson: { userId: rotated.user.id },
      ipAddress: requestIp(req)
    });

    return ok(res, {}, "Token refreshed");
  } catch (error) {
    console.error("AUTH_REFRESH_ERROR", {
      requestId: req.requestId ?? null,
      error
    });
    return fail(res, 500, "INTERNAL_ERROR", "Unexpected server error", {
      requestId: req.requestId ?? null
    });
  }
});

authRouter.post("/logout", requireAuth, async (req, res) => {
  const refreshToken = req.cookies?.[refreshCookieName] as string | undefined;
  const userId = req.user?.id ?? null;

  await revokeRefreshToken(refreshToken);
  res.clearCookie(accessCookieName, clearCookieConfig);
  res.clearCookie(refreshCookieName, clearCookieConfig);

  await createAuditLog({
    actorUserId: userId,
    action: "LOGOUT",
    entityType: "auth",
    detailsJson: { userId },
    ipAddress: requestIp(req)
  });

  return ok(res, {}, "Logged out");
});

authRouter.get("/me", requireAuth, async (req, res) => {
  try {
    await createAuditLog({
      actorUserId: req.user!.id,
      action: "AUTH_ME",
      entityType: "user",
      entityId: req.user!.id,
      detailsJson: { route: "/auth/me" },
      ipAddress: requestIp(req)
    });

    return ok(res, {
      user: {
        id: req.user!.id,
        email: req.user!.email,
        fullName: req.user!.fullName,
        role: toRbacRole(req.user!.role),
        roleLabel: ROLE_LABEL[toRbacRole(req.user!.role)],
        status: req.user!.status
      }
    });
  } catch (error) {
    console.error("AUTH_ME_ERROR", {
      requestId: req.requestId ?? null,
      error
    });
    return fail(res, 500, "INTERNAL_ERROR", "Unexpected server error", {
      requestId: req.requestId ?? null
    });
  }
});

authRouter.post("/change-password", requireAuth, validateBody(changePasswordSchema), async (req, res) => {
  const parsed = req.body as z.infer<typeof changePasswordSchema>;
  const changed = await changePassword({
    userId: req.user!.id,
    currentPassword: parsed.currentPassword,
    newPassword: parsed.newPassword
  });
  if (!changed) {
    await createAuditLog({
      actorUserId: req.user!.id,
      action: "PASSWORD_CHANGE_FAILED",
      entityType: "auth",
      detailsJson: { reason: "INVALID_CURRENT_PASSWORD_OR_STATUS" },
      ipAddress: requestIp(req)
    });
    return fail(res, 400, "INVALID_PASSWORD", "Current password is invalid");
  }

  res.cookie(accessCookieName, changed.accessToken, accessCookieConfig);
  res.cookie(refreshCookieName, changed.refreshToken, refreshCookieConfig);

  await createAuditLog({
    actorUserId: req.user!.id,
    action: "PASSWORD_CHANGED",
    entityType: "user",
    entityId: req.user!.id,
    detailsJson: { userId: req.user!.id },
    ipAddress: requestIp(req)
  });

  return ok(res, {}, "Password changed");
});
