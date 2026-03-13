import { Router } from "express";
import { ok } from "../lib/http.js";
import { getPrismaConnectionState } from "../lib/prisma.js";

export const healthRouter = Router();

healthRouter.get("/", (_req, res) => {
  return ok(res, { service: "api", status: "up" });
});

healthRouter.get("/deps", (_req, res) => {
  const prisma = getPrismaConnectionState();
  return ok(res, {
    service: "api",
    status: prisma.connected ? "up" : "degraded",
    dependencies: {
      prisma
    }
  });
});
