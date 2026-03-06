import { Router } from "express";
import { ok } from "../lib/http.js";

export const healthRouter = Router();

healthRouter.get("/", (_req, res) => {
  return ok(res, { service: "api", status: "up" });
});

