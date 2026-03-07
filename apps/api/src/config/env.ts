import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();
const resolvedPort = Number(process.env.PORT) || 10000;

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.number().default(resolvedPort),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  WEB_ORIGIN: z.string().min(1),
  AWS_REGION: z.string().min(2),
  AWS_S3_BUCKET: z.string().min(3),
  AWS_ACCESS_KEY_ID: z.string().min(4),
  AWS_SECRET_ACCESS_KEY: z.string().min(8),
  FIREBASE_PROJECT_ID: z.string().min(3),
  FIREBASE_CLIENT_EMAIL: z.string().email(),
  FIREBASE_PRIVATE_KEY: z.string().min(20),
  SMS_PROVIDER: z.enum(["console", "msg91"]).default("console"),
  MSG91_AUTH_KEY: z.string().min(8).optional(),
  MSG91_SENDER_ID: z.string().min(2).optional(),
  EMAIL_PROVIDER: z.enum(["console", "sendgrid", "ses"]).default("console"),
  EMAIL_FROM: z.string().email().default("no-reply@solar.local"),
  SENDGRID_API_KEY: z.string().min(20).optional(),
  AWS_SES_REGION: z.string().min(2).optional(),
  WHATSAPP_PROVIDER: z.enum(["console", "twilio", "interakt", "wati"]).default("console"),
  TWILIO_ACCOUNT_SID: z.string().min(10).optional(),
  TWILIO_AUTH_TOKEN: z.string().min(10).optional(),
  TWILIO_WHATSAPP_FROM: z.string().min(5).optional(),
  INTERAKT_API_KEY: z.string().min(8).optional(),
  WATI_API_KEY: z.string().min(8).optional()
  ,
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
