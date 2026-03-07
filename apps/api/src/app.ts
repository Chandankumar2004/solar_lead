import "express-async-errors";
import express from "express";
import cors from "cors";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import { env } from "./config/env.js";
import { healthRouter } from "./routes/health.js";
import { authRouter } from "./routes/auth.js";
import { leadsRouter } from "./routes/leads.js";
import { uploadsRouter } from "./routes/uploads.js";
import { notificationsRouter } from "./routes/notifications.js";
import { errorHandler } from "./middleware/error.js";
import { ok } from "./lib/http.js";
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

export const app = express();

const allowedOrigins = env.WEB_ORIGIN.split(",")
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }

      if (allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`Origin ${origin} not allowed by CORS`));
    },
    credentials: true
  })
);
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());
app.use(morgan("dev"));
app.use(requestLogger);

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
