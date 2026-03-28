import "express-async-errors";
import express from "express";
import cors, { CorsOptions } from "cors";
import helmet from "helmet";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import { env } from "./config/env.js";
import { healthRouter } from "./routes/health.js";
import { authRouter } from "./routes/auth.js";
import { errorHandler } from "./middleware/error.js";
import { requestLogger } from "./middleware/request-logger.js";
import { requireAuth } from "./middleware/auth.js";
import { fail, ok } from "./lib/http.js";

export const app = express();

type RouterModule = Record<string, unknown>;
type RouterHandler = (req: express.Request, res: express.Response, next: express.NextFunction) => void;

function lazyRouter(loader: () => Promise<RouterModule>, exportName: string) {
  let cached: RouterHandler | null = null;
  let pending: Promise<RouterHandler> | null = null;

  async function resolveRouter() {
    if (cached) {
      return cached;
    }
    if (!pending) {
      pending = loader().then((mod) => {
        const router = mod[exportName];
        if (typeof router !== "function") {
          throw new Error(`Lazy router export not found: ${exportName}`);
        }
        cached = router as RouterHandler;
        return cached;
      });
    }
    return pending;
  }

  return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    try {
      const router = await resolveRouter();
      return router(req, res, next);
    } catch (error) {
      return next(error);
    }
  };
}

if (env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}

const originEnv = [env.WEB_ORIGIN, env.CORS_ORIGIN, env.FRONTEND_URL]
  .filter(Boolean)
  .join(",");
const configuredOrigins = originEnv
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const defaultOrigins = env.NODE_ENV === "production" ? [] : ["http://localhost:3000"];
const allowedOrigins = Array.from(new Set([...defaultOrigins, ...configuredOrigins]));
const allowedOriginSet = new Set(allowedOrigins);
const csrfSafeMethods = new Set(["GET", "HEAD", "OPTIONS"]);
const accessCookieName = (env.ACCESS_COOKIE_NAME ?? "accessToken").trim() || "accessToken";
const refreshCookieName = (env.REFRESH_COOKIE_NAME ?? "refreshToken").trim() || "refreshToken";

function isAllowedOrigin(origin: string) {
  return allowedOriginSet.has(origin);
}

function resolveRequestOrigin(req: express.Request) {
  const explicitOrigin = req.header("origin")?.trim();
  if (explicitOrigin) {
    return explicitOrigin;
  }

  const referer = req.header("referer")?.trim();
  if (!referer) {
    return null;
  }

  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

function hasBearerAuthorization(req: express.Request) {
  const raw = req.header("authorization");
  return typeof raw === "string" && raw.trim().toLowerCase().startsWith("bearer ");
}

const corsOptions: CorsOptions = {
  origin: (origin, callback) => {
    if (!origin || isAllowedOrigin(origin)) {
      return callback(null, true);
    }
    return callback(new Error("CORS not allowed"));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  optionsSuccessStatus: 204
};

console.info("CORS_CONFIG", {
  mode: "allowlist",
  credentials: true,
  origins: allowedOrigins
});

app.use(requestLogger);
app.use(
  helmet({
    crossOriginResourcePolicy: false
  })
);
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

app.use(
  "/payments/webhook/razorpay",
  express.raw({ type: "*/*", limit: "2mb" }),
  lazyRouter(() => import("./routes/payment-webhooks.js"), "paymentWebhooksRouter")
);
app.use(
  "/api/payments/webhook/razorpay",
  express.raw({ type: "*/*", limit: "2mb" }),
  lazyRouter(() => import("./routes/payment-webhooks.js"), "paymentWebhooksRouter")
);

app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());
app.use(morgan("dev"));

app.use((req, res, next) => {
  if (csrfSafeMethods.has(req.method.toUpperCase())) {
    return next();
  }

  if (hasBearerAuthorization(req)) {
    return next();
  }

  const hasSessionCookie = Boolean(
    req.cookies?.[accessCookieName] || req.cookies?.[refreshCookieName]
  );
  if (!hasSessionCookie) {
    return next();
  }

  const requestOrigin = resolveRequestOrigin(req);
  if (!requestOrigin || !isAllowedOrigin(requestOrigin)) {
    console.warn("CSRF_ORIGIN_BLOCKED", {
      method: req.method,
      path: req.originalUrl,
      origin: requestOrigin ?? null,
      requestId: req.requestId ?? null
    });
    return fail(res, 403, "CSRF_BLOCKED", "Untrusted request origin", {
      requestId: req.requestId ?? null
    });
  }

  return next();
});

app.get("/", (_req, res) => {
  return ok(res, { service: "Solar Lead API" });
});
app.get("/health", (_req, res) => {
  return res.status(200).json({ status: "ok" });
});
app.use("/health", healthRouter);
app.use("/api/health", healthRouter);
app.use("/public", lazyRouter(() => import("./routes/public.js"), "publicRouter"));
app.use("/api/public", lazyRouter(() => import("./routes/public.js"), "publicRouter"));
app.use("/auth", authRouter);
app.use("/api/auth", authRouter);
app.use(
  "/api/districts",
  requireAuth,
  lazyRouter(() => import("./routes/districts.js"), "districtsRouter")
);
app.use(
  "/users",
  requireAuth,
  lazyRouter(() => import("./routes/users.js"), "usersRouter")
);
app.use(
  "/api/users",
  requireAuth,
  lazyRouter(() => import("./routes/users.js"), "usersRouter")
);
app.use(
  "/dashboard",
  requireAuth,
  lazyRouter(() => import("./routes/dashboard.js"), "dashboardRouter")
);
app.use(
  "/api/dashboard",
  requireAuth,
  lazyRouter(() => import("./routes/dashboard.js"), "dashboardRouter")
);
app.use(
  "/lead-statuses",
  requireAuth,
  lazyRouter(() => import("./routes/lead-statuses.js"), "leadStatusesRouter")
);
app.use(
  "/api/lead-statuses",
  requireAuth,
  lazyRouter(() => import("./routes/lead-statuses.js"), "leadStatusesRouter")
);
app.use(
  "/leads/:leadId/documents",
  requireAuth,
  lazyRouter(() => import("./routes/lead-documents.js"), "leadDocumentsRouter")
);
app.use(
  "/api/leads/:leadId/documents",
  requireAuth,
  lazyRouter(() => import("./routes/lead-documents.js"), "leadDocumentsRouter")
);
app.use(
  "/leads",
  requireAuth,
  lazyRouter(() => import("./routes/leads.js"), "leadsRouter")
);
app.use(
  "/api/leads",
  requireAuth,
  lazyRouter(() => import("./routes/leads.js"), "leadsRouter")
);
app.use(
  "/documents",
  requireAuth,
  lazyRouter(() => import("./routes/documents.js"), "documentsRouter")
);
app.use(
  "/api/documents",
  requireAuth,
  lazyRouter(() => import("./routes/documents.js"), "documentsRouter")
);
app.use(
  "/api/payments",
  requireAuth,
  lazyRouter(() => import("./routes/payments.js"), "paymentsRouter")
);
app.use(
  "/api/uploads",
  requireAuth,
  lazyRouter(() => import("./routes/uploads.js"), "uploadsRouter")
);
app.use(
  "/api/notifications",
  requireAuth,
  lazyRouter(() => import("./routes/notifications.js"), "notificationsRouter")
);
app.use(
  "/api/chat",
  requireAuth,
  lazyRouter(() => import("./routes/chat.js"), "chatRouter")
);
app.use(
  "/reports",
  requireAuth,
  lazyRouter(() => import("./routes/reports.js"), "reportsRouter")
);
app.use(
  "/api/reports",
  requireAuth,
  lazyRouter(() => import("./routes/reports.js"), "reportsRouter")
);
app.use(errorHandler);
