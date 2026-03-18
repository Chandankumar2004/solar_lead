import { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { fail } from "../lib/http.js";
import { AppError } from "../lib/errors.js";

const DB_ERROR_LOG_INTERVAL_MS = 30_000;
let lastDbErrorLogAt = 0;

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
) {
  void _next;
  if (res.headersSent) {
    return;
  }

  if (
    err instanceof SyntaxError &&
    typeof (err as { message?: unknown }).message === "string" &&
    (err as { status?: unknown; type?: unknown }).status === 400 &&
    (err as { type?: unknown }).type === "entity.parse.failed"
  ) {
    console.error("REQUEST_BODY_PARSE_ERROR", {
      requestId: req.requestId ?? null,
      message: err.message
    });
    return fail(res, 400, "INVALID_REQUEST_BODY", "invalid request body", {
      requestId: req.requestId ?? null
    });
  }

  if (err instanceof AppError) {
    const details =
      err.details && typeof err.details === "object" && !Array.isArray(err.details)
        ? { ...(err.details as Record<string, unknown>), requestId: req.requestId ?? null }
        : { details: err.details ?? null, requestId: req.requestId ?? null };
    return fail(res, err.statusCode, err.code, err.message, details);
  }

  if (err instanceof ZodError) {
    return fail(res, 400, "VALIDATION_ERROR", "Validation failed", {
      issues: err.issues,
      requestId: req.requestId ?? null
    });
  }

  if (
    err instanceof Error &&
    (err.name.startsWith("PrismaClient") || err.message.toLowerCase().includes("prisma"))
  ) {
    const prismaLike = err as Error & { code?: string; meta?: unknown };
    const now = Date.now();
    if (now - lastDbErrorLogAt > DB_ERROR_LOG_INTERVAL_MS) {
      lastDbErrorLogAt = now;
      console.error("DB_ERROR", {
        requestId: req.requestId ?? null,
        name: prismaLike.name,
        code: prismaLike.code ?? null,
        message: err.message,
        path: req.originalUrl
      });
    }
    return fail(res, 500, "DATABASE_ERROR", "Database operation failed", {
      requestId: req.requestId ?? null
    });
  }

  if (err instanceof Error && err.message.toLowerCase().includes("cors")) {
    console.error("CORS_ERROR", {
      requestId: req.requestId ?? null,
      message: err.message
    });
    return fail(res, 403, "CORS_ERROR", "Origin is not allowed", {
      requestId: req.requestId ?? null
    });
  }

  console.error("unhandled_error", err);
  return fail(res, 500, "INTERNAL_ERROR", "Unexpected server error", {
    requestId: req.requestId ?? null
  });
}
