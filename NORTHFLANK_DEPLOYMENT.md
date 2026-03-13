# Northflank Deployment (Monorepo, API Only)

This repo is a pnpm monorepo. Deploy the backend from repo root using filter commands.

## Service Setup

- Service type: `Combined service`
- Repository: `Chandankumar2004/solar_lead`
- Branch: `main`
- Working directory: repo root (leave empty)
- Node version: `20`

## Northflank Commands

- Build command:

```bash
pnpm install --frozen-lockfile --prod=false && pnpm --filter @solar/api build
```

- Start command:

```bash
pnpm --filter @solar/api start
```

- Pre-deploy / release command:
  - Leave empty (no Supabase CLI migration-status/list hooks)

## Prisma / DB Notes

- `apps/api/prisma/schema.prisma` uses:
  - `url = env("DATABASE_URL")`
  - `directUrl = env("DIRECT_URL")`
- Runtime API uses `DATABASE_URL` via Prisma client.
- Keep `DIRECT_URL` set for Prisma migrate/introspection operations.

## Required Runtime Env Vars (API)

Set these in Northflank service variables:

- `NODE_ENV=production`
- `PORT=3000`
- `DATABASE_URL=postgresql://postgres.onblngbhnigulspucvwg:<PASSWORD>@aws-1-ap-south-1.pooler.supabase.com:5432/postgres?sslmode=require`
- `DIRECT_URL=postgresql://postgres:<PASSWORD>@db.onblngbhnigulspucvwg.supabase.co:5432/postgres?sslmode=require`
- `SUPABASE_URL=https://onblngbhnigulspucvwg.supabase.co`
- `SUPABASE_ANON_KEY=<SUPABASE_ANON_KEY>`
- `SUPABASE_SERVICE_ROLE_KEY=<SUPABASE_SERVICE_ROLE_KEY>`
- `FIREBASE_PROJECT_ID=<FIREBASE_PROJECT_ID>`
- `FIREBASE_CLIENT_EMAIL=<FIREBASE_CLIENT_EMAIL>`
- `FIREBASE_PRIVATE_KEY=<FIREBASE_PRIVATE_KEY_WITH_LITERAL_\\n>`

## Feature Env Vars (Optional/Conditional)

- Login reCAPTCHA in production:
  - `RECAPTCHA_SECRET_KEY=<GOOGLE_RECAPTCHA_V3_SECRET>`
  - or `GOOGLE_RECAPTCHA_SECRET_KEY=<GOOGLE_RECAPTCHA_V3_SECRET>`
- Redis/Bull queue:
  - `REDIS_URL=<REDIS_URL>`
  - `REDIS_MAX_RETRIES=3`
  - `BULL_NOTIFICATION_QUEUE=notification-queue`
- Razorpay:
  - `RAZORPAY_KEY_ID=<KEY_ID>`
  - `RAZORPAY_KEY_SECRET=<KEY_SECRET>`
  - `RAZORPAY_API_BASE_URL=https://api.razorpay.com`
- Optional payment/legal display:
  - `PAYMENT_REGISTERED_NAME`
  - `PAYMENT_CIN`
  - `PAYMENT_PAN`
  - `PAYMENT_TAN`
  - `PAYMENT_GST`
- Optional provider keys:
  - `SMS_PROVIDER`, `MSG91_*`
  - `EMAIL_PROVIDER`, `EMAIL_FROM`, `SENDGRID_API_KEY`, `SES_REGION`
  - `WHATSAPP_PROVIDER`, `TWILIO_*`, `INTERAKT_API_KEY`, `WATI_API_KEY`

## Migration Command (Run only when needed)

Use Prisma-only flow:

```bash
pnpm --filter @solar/api exec prisma migrate deploy --schema ./prisma/schema.prisma
```

If your workflow intentionally uses db push instead of migrations:

```bash
pnpm --filter @solar/api exec prisma db push --schema ./prisma/schema.prisma
```

## Verification

After deploy:

1. `GET /` returns service payload
2. `GET /health` returns `{"status":"ok"}`
3. `GET /health/deps` reports Prisma status
4. `POST /api/auth/login` works with configured reCAPTCHA secret
