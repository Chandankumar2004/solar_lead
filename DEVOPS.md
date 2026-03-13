# DevOps Blueprint

Last Updated: 2026-03-12

## Target Deployment Topology

- `web`: Next.js service (`apps/web`) on Render or Vercel
- `api`: Node/Express service (`apps/api`) on Render, ECS, or Docker host
- `worker`: separate background process (`apps/api` -> `pnpm worker`) for Bull queue jobs
- `db`: PostgreSQL on Supabase
- `files`: Supabase Storage (`documents` bucket)
- `cache/queue`: Redis (Redis Cloud/Upstash/ElastiCache)
- `push`: Firebase (Admin SDK on backend)

## Production Build and Start Commands

From repo root:

- API build: `pnpm --filter @solar/api build`
- API start: `pnpm --filter @solar/api start`
- API worker start: `pnpm --filter @solar/api worker`
- Web build: `pnpm --filter @solar/web build`
- Web start: `pnpm --filter @solar/web start`

Convenience scripts at root:

- `pnpm build:api`
- `pnpm build:web`
- `pnpm build:all`
- `pnpm start:api`
- `pnpm start:api:worker`
- `pnpm start:web`

## Environment Requirements

### API required
- `NODE_ENV=production`
- `PORT` (usually `10000` on Render)
- `DATABASE_URL`  
  `postgresql://postgres.onblngbhnigulspucvwg:<PASSWORD>@aws-1-ap-south-1.pooler.supabase.com:6543/postgres?pgbouncer=true&sslmode=require`
- `DIRECT_URL`  
  `postgresql://postgres:<PASSWORD>@db.onblngbhnigulspucvwg.supabase.co:5432/postgres?sslmode=require`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`
- `REDIS_URL`
- `BULL_NOTIFICATION_QUEUE`
- `WEB_ORIGIN` and/or `CORS_ORIGIN`
- `RAZORPAY_KEY_ID`
- `RAZORPAY_KEY_SECRET`

### API optional / recommended
- `REDIS_MAX_RETRIES`
- `RAZORPAY_API_BASE_URL`
- notification provider credentials (MSG91/SendGrid/Twilio/etc) as needed

### Web required
- `NEXT_PUBLIC_API_BASE_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- Firebase public keys:
  - `NEXT_PUBLIC_FIREBASE_API_KEY`
  - `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
  - `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
  - `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`
  - `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
  - `NEXT_PUBLIC_FIREBASE_APP_ID`
- `NEXT_PUBLIC_RECAPTCHA_SITE_KEY`

## Render Deployment

This repo now includes `render.yaml` with:
- API web service
- notification worker service
- web frontend service

Steps:
1. Push this repo with `render.yaml`.
2. Create Blueprint deploy in Render.
3. Fill all `sync: false` env vars in Render dashboard.
4. Run Prisma migrations (one-time per release):  
   `pnpm --filter @solar/api exec prisma migrate deploy --schema ./prisma/schema.prisma`
5. Keep Render pre-deploy/release command empty unless explicitly needed; do not run Supabase CLI migration-status/list commands from deployment hooks.

## Docker Deployment

Included:
- `apps/api/Dockerfile`
- `apps/web/Dockerfile`

Example build commands:
- `docker build -f apps/api/Dockerfile -t solar-api .`
- `docker build -f apps/web/Dockerfile -t solar-web .`

## Runtime and Security Notes

- API sets auth cookies (HTTP-only) and enforces RBAC server-side.
- File uploads use Supabase signed URLs; no client-side cloud credentials.
- Queue jobs run through Bull + Redis; keep worker deployed separately in production.
- Keep `SUPABASE_SERVICE_ROLE_KEY` backend-only.
- Rotate exposed secrets immediately if leaked.
