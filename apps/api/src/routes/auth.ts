import { Router } from "express";
import { z } from "zod";
import { loginSchema } from "@solar/shared";
import { fail, ok } from "../lib/http.js";
import {
  changePassword,
  login,
  revokeRefreshToken,
  rotateRefreshToken
} from "../services/supabase-auth.service.js";
import { verifyRecaptchaToken } from "../services/recaptcha.service.js";
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
const enforceRecaptchaOnLogin = isSecureCookieEnv;

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

const loginRequestSchema = z.object({
  email: z.string().optional(),
  password: z.string().optional(),
  recaptchaToken: z.string().optional(),
  recaptcha_token: z.string().optional(),
  recaptchaAction: z.string().optional(),
  recaptcha_action: z.string().optional()
});

authRouter.post("/login", async (req, res) => {
  try {
    const parsedRequest = loginRequestSchema.safeParse(req.body ?? {});
    if (!parsedRequest.success) {
      return fail(res, 400, "INVALID_REQUEST_BODY", "invalid request body", parsedRequest.error);
    }

    const loginRequest = parsedRequest.data;
    const rawEmail = typeof loginRequest.email === "string" ? loginRequest.email.trim() : "";
    const rawPassword = typeof loginRequest.password === "string" ? loginRequest.password : "";
    const rawRecaptchaToken =
      typeof loginRequest.recaptchaToken === "string"
        ? loginRequest.recaptchaToken.trim()
        : typeof loginRequest.recaptcha_token === "string"
          ? loginRequest.recaptcha_token.trim()
          : "";
    const recaptchaAction =
      typeof loginRequest.recaptchaAction === "string" && loginRequest.recaptchaAction.trim()
        ? loginRequest.recaptchaAction.trim()
        : typeof loginRequest.recaptcha_action === "string" && loginRequest.recaptcha_action.trim()
          ? loginRequest.recaptcha_action.trim()
          : "admin_login";

    if (!rawEmail) {
      await createAuditLog({
        action: "LOGIN_FAILED",
        entityType: "auth",
        detailsJson: {
          reason: "MISSING_EMAIL",
          email: null
        },
        ipAddress: requestIp(req)
      });
      return fail(res, 400, "EMAIL_REQUIRED", "email is required");
    }

    if (!rawPassword) {
      await createAuditLog({
        action: "LOGIN_FAILED",
        entityType: "auth",
        detailsJson: {
          reason: "MISSING_PASSWORD",
          email: rawEmail
        },
        ipAddress: requestIp(req)
      });
      return fail(res, 400, "PASSWORD_REQUIRED", "password is required");
    }

    if (enforceRecaptchaOnLogin) {
      if (!rawRecaptchaToken) {
        return fail(res, 400, "RECAPTCHA_TOKEN_REQUIRED", "recaptchaToken is required");
      }

      const recaptchaResult = await verifyRecaptchaToken({
        token: rawRecaptchaToken,
        expectedAction: recaptchaAction,
        remoteIp: requestIp(req)
      });

      if (!recaptchaResult.ok) {
        const recaptchaMeta = {
          reason: recaptchaResult.reason,
          errorCodes: recaptchaResult.errorCodes,
          score: recaptchaResult.score,
          action: recaptchaResult.action,
          requestId: req.requestId ?? null
        };
        console.error("AUTH_LOGIN_RECAPTCHA_ERROR", recaptchaMeta);

        if (recaptchaResult.reason === "SECRET_MISSING") {
          console.error("AUTH_ENV_ERROR", {
            reason: "RECAPTCHA_SECRET_MISSING",
            requestId: req.requestId ?? null
          });
          console.error("RECAPTCHA_CONFIG_ERROR", recaptchaMeta);
          return fail(
            res,
            500,
            "RECAPTCHA_CONFIG_ERROR",
            "reCAPTCHA is not configured on server",
            recaptchaMeta
          );
        }

        if (recaptchaResult.reason === "TOKEN_MISSING") {
          console.error("AUTH_LOGIN_ERROR", {
            ...recaptchaMeta,
            reason: "RECAPTCHA_TOKEN_MISSING"
          });
          return fail(
            res,
            400,
            "RECAPTCHA_TOKEN_MISSING",
            "reCAPTCHA token is required",
            recaptchaMeta
          );
        }

        if (recaptchaResult.reason === "ACTION_MISMATCH") {
          console.error("AUTH_LOGIN_ERROR", {
            ...recaptchaMeta,
            reason: "RECAPTCHA_ACTION_MISMATCH"
          });
          return fail(
            res,
            400,
            "RECAPTCHA_ACTION_MISMATCH",
            "reCAPTCHA action mismatch",
            recaptchaMeta
          );
        }

        if (recaptchaResult.reason === "TOKEN_INVALID") {
          console.error("AUTH_LOGIN_ERROR", {
            ...recaptchaMeta,
            reason: "RECAPTCHA_TOKEN_INVALID"
          });
          return fail(
            res,
            401,
            "RECAPTCHA_TOKEN_INVALID",
            "reCAPTCHA verification failed",
            recaptchaMeta
          );
        }

        console.error("AUTH_LOGIN_ERROR", {
          ...recaptchaMeta,
          reason: "RECAPTCHA_VERIFY_FAILED"
        });
        return fail(
          res,
          502,
          "RECAPTCHA_VERIFY_FAILED",
          "Unable to verify reCAPTCHA token"
        );
      }
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
              : result.reason === "AUTH_BACKEND_ERROR"
                ? "Authentication service temporarily unavailable"
                : result.reason === "APP_PROFILE_NOT_FOUND"
                  ? "No app profile is mapped for this account"
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
          : result.reason === "APP_PROFILE_NOT_FOUND"
            ? 403
          : result.reason === "AUTH_CONFIG_ERROR" || result.reason === "AUTH_BACKEND_ERROR"
            ? 500
            : 403;

      if (result.reason === "AUTH_CONFIG_ERROR" || result.reason === "AUTH_BACKEND_ERROR") {
        if (result.reason === "AUTH_CONFIG_ERROR") {
          console.error("AUTH_ENV_ERROR", {
            reason: "TOKEN_GENERATION_FAILED",
            userId: result.userId ?? null,
            requestId: req.requestId ?? null
          });
        }
        console.error("AUTH_LOGIN_ERROR", {
          reason:
            result.reason === "AUTH_CONFIG_ERROR"
              ? "TOKEN_GENERATION_FAILED"
              : "USER_LOOKUP_FAILED",
          userId: result.userId ?? null,
          requestId: req.requestId ?? null
        });
      }

      const details =
        result.reason === "AUTH_CONFIG_ERROR"
          ? { reason: "AUTH_LOGIN_SUPABASE_CONFIG_ERROR", requestId: req.requestId ?? null }
          : result.reason === "AUTH_BACKEND_ERROR"
            ? { reason: "AUTH_LOGIN_SUPABASE_BACKEND_ERROR", requestId: req.requestId ?? null }
            : result.reason === "APP_PROFILE_NOT_FOUND"
              ? { reason: "AUTH_LOGIN_APP_PROFILE_NOT_FOUND", requestId: req.requestId ?? null }
            : undefined;

      return fail(res, statusCode, result.reason, reasonMessage, details);
    }

    if (!result.accessToken || !result.refreshToken) {
      console.error("AUTH_LOGIN_ERROR", {
        reason: "TOKEN_PAIR_EMPTY",
        userId: result.user.id,
        requestId: req.requestId ?? null
      });
      return fail(
        res,
        500,
        "AUTH_BACKEND_ERROR",
        "Authentication service temporarily unavailable",
        {
          reason: "TOKEN_PAIR_EMPTY",
          requestId: req.requestId ?? null
        }
      );
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
    const refreshToken = req.cookies?.[refreshCookieName] as string | undefined;
    if (!refreshToken) {
      await createAuditLog({
        action: "TOKEN_REFRESH_FAILED",
        entityType: "auth",
        detailsJson: { reason: "MISSING_REFRESH_COOKIE" },
        ipAddress: requestIp(req)
      });
      return fail(res, 401, "UNAUTHORIZED", "Missing session");
    }

    const rotated = await rotateRefreshToken(refreshToken);
    if (!rotated) {
      await createAuditLog({
        action: "TOKEN_REFRESH_FAILED",
        entityType: "auth",
        detailsJson: { reason: "INVALID_REFRESH_TOKEN" },
        ipAddress: requestIp(req)
      });
      return fail(res, 401, "UNAUTHORIZED", "Invalid or expired session");
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
