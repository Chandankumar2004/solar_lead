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

const isProduction = env.NODE_ENV === "production";
const cookieSameSite = isProduction ? ("none" as const) : ("lax" as const);

const refreshCookieConfig = {
  httpOnly: true,
  secure: isProduction,
  sameSite: cookieSameSite,
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: "/"
};

const accessCookieConfig = {
  httpOnly: true,
  secure: isProduction,
  sameSite: cookieSameSite,
  maxAge: 15 * 60 * 1000,
  path: "/"
};

const clearCookieConfig = {
  httpOnly: true,
  secure: isProduction,
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
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    await createAuditLog({
      action: "LOGIN_FAILED",
      entityType: "auth",
      detailsJson: {
        reason: "VALIDATION_ERROR",
        email: typeof req.body?.email === "string" ? req.body.email : null
      },
      ipAddress: requestIp(req)
    });
    return fail(res, 400, "VALIDATION_ERROR", "Invalid login payload", parsed.error);
  }

  const body = parsed.data;
  const result = await login(body.email, body.password);
  if (!result.ok) {
    const reasonMessage =
      result.reason === "ACCOUNT_PENDING"
        ? "Your account is pending approval"
        : result.reason === "ACCOUNT_SUSPENDED"
          ? "Your account is suspended"
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

    const statusCode = result.reason === "INVALID_CREDENTIALS" ? 401 : 403;
    return fail(res, statusCode, result.reason, reasonMessage);
  }

  res.cookie("accessToken", result.accessToken, accessCookieConfig);
  res.cookie("refreshToken", result.refreshToken, refreshCookieConfig);

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
});

authRouter.post("/refresh", async (req, res) => {
  const refreshToken = req.cookies?.refreshToken as string | undefined;
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

  res.cookie("accessToken", rotated.accessToken, accessCookieConfig);
  res.cookie("refreshToken", rotated.refreshToken, refreshCookieConfig);

  await createAuditLog({
    actorUserId: rotated.user.id,
    action: "TOKEN_REFRESH_SUCCESS",
    entityType: "auth",
    detailsJson: { userId: rotated.user.id },
    ipAddress: requestIp(req)
  });

  return ok(res, {}, "Token refreshed");
});

authRouter.post("/logout", requireAuth, async (req, res) => {
  const refreshToken = req.cookies?.refreshToken as string | undefined;
  const userId = req.user?.id ?? null;

  await revokeRefreshToken(refreshToken);
  res.clearCookie("accessToken", clearCookieConfig);
  res.clearCookie("refreshToken", clearCookieConfig);

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

  res.cookie("accessToken", changed.accessToken, accessCookieConfig);
  res.cookie("refreshToken", changed.refreshToken, refreshCookieConfig);

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
