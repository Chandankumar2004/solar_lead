import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();
const resolvedPort = Number(process.env.PORT) || 10000;

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.number().default(resolvedPort),
  DATABASE_URL: z.string().url(),
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
  SMS_PROVIDER: z.enum(["console", "msg91"]).default("console"),
  MSG91_AUTH_KEY: z.string().min(8).optional(),
  MSG91_SENDER_ID: z.string().min(2).optional(),
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
  PAYMENT_REGISTERED_NAME: z.string().min(2).default("Razorpay Payments Private Limited"),
  PAYMENT_CIN: z.string().min(5).default(""),
  PAYMENT_PAN: z.string().min(5).default(""),
  PAYMENT_TAN: z.string().min(5).default(""),
  PAYMENT_GST: z.string().min(5).default("")
});

export const env = envSchema.parse({
  ...process.env,
  PORT: resolvedPort
});
