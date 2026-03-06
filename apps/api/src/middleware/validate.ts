import { NextFunction, Request, Response } from "express";
import { ZodError, ZodTypeAny } from "zod";
import { AppError } from "../lib/errors.js";

function zodToDetails(error: ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
    code: issue.code
  }));
}

export function validateBody(schema: ZodTypeAny) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return next(
        new AppError(400, "VALIDATION_ERROR", "Request body validation failed", zodToDetails(parsed.error))
      );
    }
    req.body = parsed.data as Request["body"];
    return next();
  };
}

export function validateQuery(schema: ZodTypeAny) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const parsed = schema.safeParse(req.query);
    if (!parsed.success) {
      return next(
        new AppError(
          400,
          "VALIDATION_ERROR",
          "Request query validation failed",
          zodToDetails(parsed.error)
        )
      );
    }
    req.query = parsed.data as Request["query"];
    return next();
  };
}

export function validateParams(schema: ZodTypeAny) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const parsed = schema.safeParse(req.params);
    if (!parsed.success) {
      return next(
        new AppError(
          400,
          "VALIDATION_ERROR",
          "Request params validation failed",
          zodToDetails(parsed.error)
        )
      );
    }
    req.params = parsed.data as Request["params"];
    return next();
  };
}
