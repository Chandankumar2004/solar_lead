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
import { fail, ok } from "./lib/http.js";

export const app = express();

if (env.NODE_ENV === "production" || process.env.RENDER === "true" || process.env.RENDER_EXTERNAL_URL) {
  app.set("trust proxy", 1);
}

function normalizeOrigin(origin: string) {
  return origin.trim().replace(/\/+$/, "");
}

function parseOriginList(raw: string | undefined) {
  if (!raw) {
    return [] as string[];
  }
  return raw
    .split(",")
    .map((origin) => normalizeOrigin(origin))
    .filter((origin) => origin.length > 0);
}

const configuredOrigins = [
  ...parseOriginList(env.WEB_ORIGIN),
  ...parseOriginList(env.CORS_ORIGIN),
  ...parseOriginList(env.FRONTEND_URL),
  ...parseOriginList(process.env.WEB_ORIGIN),
  ...parseOriginList(process.env.CORS_ORIGIN),
  ...parseOriginList(process.env.FRONTEND_URL)
];

const defaultProductionOrigins = ["https://solar-lead-1.onrender.com"];
const productionOrigins =
  configuredOrigins.length > 0
    ? configuredOrigins
    : env.NODE_ENV === "production"
      ? defaultProductionOrigins
      : [];

const devOrigins =
  env.NODE_ENV === "production"
    ? []
    : [
        "http://localhost:3000",
        "http://localhost:3200",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:3200"
      ];

const allowedOrigins = new Set([...productionOrigins, ...devOrigins]);

function isAllowedOrigin(origin: string | undefined) {
  if (!origin) {
    return true;
  }
  return allowedOrigins.has(normalizeOrigin(origin));
}

const corsOptions: CorsOptions = {
  origin: (
    origin: string | undefined,
    callback: (err: Error | null, allow?: boolean) => void
  ) => {
    if (isAllowedOrigin(origin)) {
      callback(null, true);
      return;
    }
    console.error("CORS_ERROR", {
      reason: "ORIGIN_NOT_ALLOWED",
      origin,
      allowedOrigins: [...allowedOrigins]
    });
    callback(null, false);
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  optionsSuccessStatus: 204
};

console.info("CORS_CONFIG", {
  allowedOrigins: [...allowedOrigins]
});

app.use(requestLogger);
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
app.use((req, res, next) => {
  const requestOrigin = req.headers.origin;
  if (!requestOrigin) {
    return next();
  }

  if (!isAllowedOrigin(requestOrigin)) {
    console.error("CORS_ERROR", {
      reason: "ORIGIN_REJECTED",
      origin: requestOrigin,
      requestId: req.requestId ?? null
    });
    return fail(res, 403, "CORS_ERROR", "Origin is not allowed");
  }

  res.header("Access-Control-Allow-Origin", normalizeOrigin(requestOrigin));
  res.header("Access-Control-Allow-Credentials", "true");
  res.header("Vary", "Origin");
  return next();
});

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
