import dotenv from "dotenv";
import { z } from "zod";

const runtimeEnv = process.env.NODE_ENV ?? "development";
if (runtimeEnv !== "production") {
  dotenv.config();
}
const resolvedPort = Number(process.env.PORT) || 4000;

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(resolvedPort),
  DATABASE_URL: z.string().url(),
  DIRECT_URL: z.string().url().optional(),
  PUBLIC_LEAD_MIN_MONTHLY_BILL_INR: z.coerce.number().int().min(1).default(500),
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(20),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  SUPABASE_DOCUMENTS_BUCKET: z.string().min(3).default("documents"),
  DOCUMENT_SIGNED_URL_EXPIRES_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  JWT_ACCESS_SECRET: z.string().optional(),
  JWT_REFRESH_SECRET: z.string().optional(),
  CUSTOMER_DATA_ENCRYPTION_KEY: z.string().optional(),
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
  LEAD_INACTIVITY_REMINDER_DAYS: z.coerce.number().int().min(0).max(365).default(3),
  TOKEN_PAYMENT_AMOUNT_INR: z.coerce.number().positive().default(1000),
  SMS_PROVIDER: z.enum(["console", "msg91"]).default("console"),
  MSG91_AUTH_KEY: z.string().min(8).optional(),
  MSG91_SENDER_ID: z.string().min(2).optional(),
  MSG91_TEMPLATE_ID: z.string().min(6).optional(),
  MSG91_ENTITY_ID: z.string().min(6).optional(),
  MSG91_ROUTE: z.string().min(1).default("4"),
  MSG91_COUNTRY: z.string().min(1).default("91"),
  EMAIL_PROVIDER: z.enum(["console", "sendgrid", "ses", "resend"]).default("console"),
  EMAIL_FROM: z.string().email().default("no-reply@solar.local"),
  SENDGRID_API_KEY: z.string().min(20).optional(),
  RESEND_API_KEY: z.string().min(20).optional(),
  SES_REGION: z.string().min(2).optional(),
  CUSTOMER_NOTIFICATIONS_UNSUBSCRIBE_URL: z.string().url().optional(),
  CUSTOMER_NOTIFICATION_UNSUBSCRIBE_SECRET: z.string().min(16).optional(),
  CUSTOMER_UNSUBSCRIBE_TOKEN_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 365).default(24 * 30),
  CUSTOMER_NOTIFICATION_BRAND_NAME: z.string().min(2).max(80).optional(),
  COMMUNICATION_WEBHOOK_SECRET: z.string().min(16).optional(),
  WHATSAPP_PROVIDER: z.enum(["console", "twilio", "interakt", "wati"]).default("console"),
  TWILIO_ACCOUNT_SID: z.string().min(10).optional(),
  TWILIO_AUTH_TOKEN: z.string().min(10).optional(),
  TWILIO_WHATSAPP_FROM: z.string().min(5).optional(),
  INTERAKT_API_KEY: z.string().min(8).optional(),
  WATI_API_KEY: z.string().min(8).optional(),
  RAZORPAY_KEY_ID: z.string().min(8).optional(),
  RAZORPAY_KEY_SECRET: z.string().min(8).optional(),
  RAZORPAY_API_BASE_URL: z.string().url().default("https://api.razorpay.com/v1"),
  RAZORPAY_WEBHOOK_SECRET: z.string().min(8).optional(),
  RAZORPAY_UPI_COLLECT_ENDPOINT: z.string().default("/payments/create/upi"),
  PAYMENT_REGISTERED_NAME: z.string().min(2).default("Razorpay Payments Private Limited"),
  PAYMENT_UPI_ID: z.string().min(5).optional(),
  PAYMENT_UPI_NAME: z.string().min(2).default("Solar Payments"),
  PAYMENT_QR_IMAGE_URL: z.string().url().optional(),
  PAYMENT_CIN: z.string().min(5).default(""),
  PAYMENT_PAN: z.string().min(5).default(""),
  PAYMENT_TAN: z.string().min(5).default(""),
  PAYMENT_GST: z.string().min(5).default("")
});

const parsedEnv = envSchema.parse(process.env);

function parseOriginList(raw: string | undefined) {
  if (!raw) return [];
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function assertProductionSecurityEnv(values: typeof parsedEnv) {
  if (values.NODE_ENV !== "production") {
    return;
  }

  const issues: string[] = [];
  if (!values.JWT_ACCESS_SECRET?.trim()) {
    issues.push("JWT_ACCESS_SECRET is required in production");
  }
  if (!values.JWT_REFRESH_SECRET?.trim()) {
    issues.push("JWT_REFRESH_SECRET is required in production");
  }
  if (!values.CUSTOMER_DATA_ENCRYPTION_KEY?.trim()) {
    issues.push("CUSTOMER_DATA_ENCRYPTION_KEY is required in production");
  }

  const configuredOrigins = [
    ...parseOriginList(values.WEB_ORIGIN),
    ...parseOriginList(values.CORS_ORIGIN),
    ...parseOriginList(values.FRONTEND_URL)
  ];
  if (configuredOrigins.length === 0) {
    issues.push("At least one allowed web origin is required (WEB_ORIGIN/CORS_ORIGIN/FRONTEND_URL)");
  }

  if (issues.length > 0) {
    throw new Error(`ENV_SECURITY_VALIDATION_FAILED: ${issues.join("; ")}`);
  }
}

assertProductionSecurityEnv(parsedEnv);

export const env = parsedEnv;
