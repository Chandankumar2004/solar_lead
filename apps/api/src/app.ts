import "express-async-errors";
import express from "express";
import cors, { CorsOptions } from "cors";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import { env } from "./config/env.js";
import { healthRouter } from "./routes/health.js";
import { authRouter } from "./routes/auth.js";
import { leadsRouter } from "./routes/leads.js";
import { uploadsRouter } from "./routes/uploads.js";
import { notificationsRouter } from "./routes/notifications.js";
import { errorHandler } from "./middleware/error.js";
import { requestLogger } from "./middleware/request-logger.js";
import { requireAuth } from "./middleware/auth.js";
import { publicRouter } from "./routes/public.js";
import { districtsRouter } from "./routes/districts.js";
import { leadStatusesRouter } from "./routes/lead-statuses.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { usersRouter } from "./routes/users.js";
import { paymentsRouter } from "./routes/payments.js";
import { leadDocumentsRouter } from "./routes/lead-documents.js";
import { documentsRouter } from "./routes/documents.js";
import { ok } from "./lib/http.js";

export const app = express();

if (
  env.NODE_ENV === "production" ||
  process.env.RENDER === "true" ||
  process.env.RENDER_EXTERNAL_URL
) {
  app.set("trust proxy", 1);
}

const corsOptions: CorsOptions = {
  // Reflect request Origin to avoid deploy-time allowlist mismatches.
  origin: true,
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  optionsSuccessStatus: 204
};

console.info("CORS_CONFIG", {
  mode: "permissive",
  credentials: true
});

app.use(requestLogger);
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());
app.use(morgan("dev"));

app.get("/", (_req, res) => {
  return ok(res, { service: "Solar Lead API" });
});
app.get("/health", (_req, res) => {
  return res.status(200).json({ status: "ok" });
});
app.use("/health", healthRouter);
app.use("/api/health", healthRouter);
app.use("/public", publicRouter);
app.use("/api/public", publicRouter);
app.use("/auth", authRouter);
app.use("/api/auth", authRouter);
app.use("/api/districts", requireAuth, districtsRouter);
app.use("/users", requireAuth, usersRouter);
app.use("/api/users", requireAuth, usersRouter);
app.use("/dashboard", requireAuth, dashboardRouter);
app.use("/api/dashboard", requireAuth, dashboardRouter);
app.use("/lead-statuses", requireAuth, leadStatusesRouter);
app.use("/api/lead-statuses", requireAuth, leadStatusesRouter);
app.use("/leads/:leadId/documents", requireAuth, leadDocumentsRouter);
app.use("/api/leads/:leadId/documents", requireAuth, leadDocumentsRouter);
app.use("/leads", requireAuth, leadsRouter);
app.use("/api/leads", requireAuth, leadsRouter);
app.use("/documents", requireAuth, documentsRouter);
app.use("/api/documents", requireAuth, documentsRouter);
app.use("/api/payments", requireAuth, paymentsRouter);
app.use("/api/uploads", requireAuth, uploadsRouter);
app.use("/api/notifications", requireAuth, notificationsRouter);
app.use(errorHandler);
