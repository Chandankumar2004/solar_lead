import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();
const resolvedPort = Number(process.env.PORT) || 10000;

function unquote(value: string | undefined) {
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function normalizeEnv(input: NodeJS.ProcessEnv) {
  const normalizedEntries = Object.entries(input).map(([key, value]) => [key, unquote(value)]);
  return Object.fromEntries(normalizedEntries);
}

type DatabaseUrlEnvDebug = {
  exists: boolean;
  length: number | null;
  startsWithPostgresql: boolean;
  hasStartQuote: boolean;
  hasEndQuote: boolean;
  hasNewline: boolean;
};

function summarizeDatabaseUrlEnv(rawValue: string | undefined, normalizedValue: string | undefined): DatabaseUrlEnvDebug {
  const trimmedRaw = typeof rawValue === "string" ? rawValue.trim() : "";
  return {
    exists: typeof rawValue === "string",
    length: typeof rawValue === "string" ? rawValue.length : null,
    startsWithPostgresql:
      typeof normalizedValue === "string" &&
      normalizedValue.toLowerCase().startsWith("postgresql://"),
    hasStartQuote: trimmedRaw.startsWith("\"") || trimmedRaw.startsWith("'"),
    hasEndQuote: trimmedRaw.endsWith("\"") || trimmedRaw.endsWith("'"),
    hasNewline: typeof rawValue === "string" && /[\r\n]/.test(rawValue)
  };
}

function logDatabaseEnvDiagnostics(input: NodeJS.ProcessEnv, normalized: Record<string, unknown>) {
  const databaseUrl = typeof normalized.DATABASE_URL === "string" ? normalized.DATABASE_URL : undefined;
  const directUrl = typeof normalized.DIRECT_URL === "string" ? normalized.DIRECT_URL : undefined;
  console.info("ENV_DB_URL_DIAGNOSTIC", {
    DATABASE_URL: summarizeDatabaseUrlEnv(input.DATABASE_URL, databaseUrl),
    DIRECT_URL: summarizeDatabaseUrlEnv(input.DIRECT_URL, directUrl)
  });
}

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.number().default(resolvedPort),
  DATABASE_URL: z.string().url(),
  DIRECT_URL: z.string().url().optional(),
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(20),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  JWT_ACCESS_SECRET: z.string().optional(),
  JWT_REFRESH_SECRET: z.string().optional(),
  RECAPTCHA_SECRET_KEY: z.string().optional(),
  GOOGLE_RECAPTCHA_SECRET_KEY: z.string().optional(),
  WEB_ORIGIN: z.string().default(""),
  CORS_ORIGIN: z.string().optional(),
  FRONTEND_URL: z.string().optional(),
  ACCESS_COOKIE_NAME: z.string().optional(),
  REFRESH_COOKIE_NAME: z.string().optional(),
  FIREBASE_PROJECT_ID: z.string().min(3),
  FIREBASE_CLIENT_EMAIL: z.string().email(),
  FIREBASE_PRIVATE_KEY: z.string().min(20),
  REDIS_URL: z.string().min(1).optional(),
  REDIS_MAX_RETRIES: z.coerce.number().int().min(0).max(20).default(5),
  BULL_NOTIFICATION_QUEUE: z.string().min(3).default("notification-dispatch"),
  SMS_PROVIDER: z.enum(["console", "msg91"]).default("console"),
  MSG91_AUTH_KEY: z.string().min(8).optional(),
  MSG91_SENDER_ID: z.string().min(2).optional(),
  MSG91_TEMPLATE_ID: z.string().min(6).optional(),
  MSG91_ENTITY_ID: z.string().min(6).optional(),
  MSG91_ROUTE: z.string().min(1).default("4"),
  MSG91_COUNTRY: z.string().min(1).default("91"),
  EMAIL_PROVIDER: z.enum(["console", "sendgrid", "ses"]).default("console"),
  EMAIL_FROM: z.string().email().default("no-reply@solar.local"),
  SENDGRID_API_KEY: z.string().min(20).optional(),
  SES_REGION: z.string().min(2).optional(),
  WHATSAPP_PROVIDER: z.enum(["console", "twilio", "interakt", "wati"]).default("console"),
  TWILIO_ACCOUNT_SID: z.string().min(10).optional(),
  TWILIO_AUTH_TOKEN: z.string().min(10).optional(),
  TWILIO_WHATSAPP_FROM: z.string().min(5).optional(),
  INTERAKT_API_KEY: z.string().min(8).optional(),
  WATI_API_KEY: z.string().min(8).optional(),
  RAZORPAY_KEY_ID: z.string().min(8).optional(),
  RAZORPAY_KEY_SECRET: z.string().min(8).optional(),
  RAZORPAY_API_BASE_URL: z.string().url().default("https://api.razorpay.com/v1"),
  PAYMENT_REGISTERED_NAME: z.string().min(2).default("Razorpay Payments Private Limited"),
  PAYMENT_CIN: z.string().min(5).default(""),
  PAYMENT_PAN: z.string().min(5).default(""),
  PAYMENT_TAN: z.string().min(5).default(""),
  PAYMENT_GST: z.string().min(5).default("")
});

const normalizedEnv = normalizeEnv(process.env);
logDatabaseEnvDiagnostics(process.env, normalizedEnv);

export const env = envSchema.parse({
  ...normalizedEnv,
  PORT: resolvedPort
});
