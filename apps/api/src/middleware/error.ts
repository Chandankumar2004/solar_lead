import { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { fail } from "../lib/http.js";
import { AppError } from "../lib/errors.js";

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

  console.error("unhandled_error", err);
  return fail(res, 500, "INTERNAL_ERROR", "Unexpected server error", {
    requestId: req.requestId ?? null
  });
}
