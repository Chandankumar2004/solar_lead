import { Router } from "express";
import { ok } from "../lib/http.js";
import { getPrismaConnectionState, runPrismaStartupChecks } from "../lib/prisma.js";

export const healthRouter = Router();

healthRouter.get("/", (_req, res) => {
  return ok(res, { service: "api", status: "up" });
});

healthRouter.get("/deps", async (_req, res) => {
  await runPrismaStartupChecks({ quiet: true });
  const prisma = getPrismaConnectionState();
  return ok(res, {
    service: "api",
    status: prisma.connected ? "up" : "degraded",
    dependencies: {
      prisma
    }
  });
});
