import { NextFunction, Request, Response } from "express";
import { randomUUID } from "node:crypto";

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const requestId = randomUUID();
  req.requestId = requestId;
  const start = Date.now();

  console.info(
    `[REQ] id=${requestId} method=${req.method} path=${req.originalUrl} ip=${req.ip}`
  );

  res.on("finish", () => {
    const duration = Date.now() - start;
    console.info(
      `[RES] id=${requestId} status=${res.statusCode} duration_ms=${duration} method=${req.method} path=${req.originalUrl}`
    );
  });

  next();
}
