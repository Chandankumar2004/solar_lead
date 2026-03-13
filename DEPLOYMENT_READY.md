# Deployment Ready Checklist

Last Updated: 2026-03-13

## What Is Ready

- API production build/start scripts
- Dedicated notification worker process
- Render blueprint config (`render.yaml`)
- Dockerfiles for API and Web
- Supabase Postgres + Supabase Storage integration
- Redis + Bull queue wiring
- Razorpay order creation integration
- CI workflow for build validation (`.github/workflows/ci.yml`)

## Required Before Going Live

1. Set all production environment variables in hosting platform:
- API env from `apps/api/.env.example`
- Web env from `apps/web/.env.example`
- API DB URLs must be:
  - `DATABASE_URL=postgresql://postgres.onblngbhnigulspucvwg:<PASSWORD>@aws-1-ap-south-1.pooler.supabase.com:6543/postgres?pgbouncer=true&sslmode=require`
  - `DIRECT_URL=postgresql://postgres:<PASSWORD>@db.onblngbhnigulspucvwg.supabase.co:5432/postgres?sslmode=require`

2. Provision external services:
- Supabase project + `documents` bucket
- Redis instance
- Firebase service account
- Razorpay keys

3. Run DB migrations:
```bash
pnpm --filter @solar/api exec prisma migrate deploy --schema ./prisma/schema.prisma
```

4. Deploy services:
- API service (`NODE_ENV=production pnpm --filter @solar/api start`)
- Worker service (`NODE_ENV=production pnpm --filter @solar/api worker`)
- Web service (`NODE_ENV=production pnpm --filter @solar/web start`)

## Render Quick Deploy

1. Push repo with `render.yaml`.
2. Create Blueprint deploy in Render dashboard.
3. Fill all `sync: false` env vars (paste raw values, no wrapping quotes).
4. Deploy and check:
- API health: `/health`
- Login flow (`/api/auth/login` then `/api/auth/me`)
- Worker logs for queue startup

### API Render Fields (exact)
- `Root Directory`: `apps/api`
- `Build Command`: `pnpm install --frozen-lockfile --prod=false && pnpm --filter @solar/api build`
- `Pre-Deploy Command`: `pnpm --filter @solar/api exec prisma migrate deploy --schema ./prisma/schema.prisma`
- `Start Command`: `NODE_ENV=production pnpm --filter @solar/api start`

### Worker Render Fields (exact)
- `Root Directory`: `apps/api`
- `Build Command`: `pnpm install --frozen-lockfile --prod=false && pnpm --filter @solar/api build`
- `Start Command`: `NODE_ENV=production pnpm --filter @solar/api worker`

### Required DB Env (exact format)
- `DATABASE_URL=postgresql://postgres.onblngbhnigulspucvwg:<PASSWORD>@aws-1-ap-south-1.pooler.supabase.com:6543/postgres?pgbouncer=true&sslmode=require`
- `DIRECT_URL=postgresql://postgres:<PASSWORD>@db.onblngbhnigulspucvwg.supabase.co:5432/postgres?sslmode=require`

### Important
- Do not use Supabase CLI migration-status hooks in Render (that is where `supabase_migrations.schema_migrations` errors come from).
- Use Prisma-only migration flow (`prisma migrate deploy`) in pre-deploy.

## Docker Quick Deploy

Build images from repo root:
```bash
docker build -f apps/api/Dockerfile -t solar-api .
docker build -f apps/web/Dockerfile -t solar-web .
```

Run containers with required env vars and managed Supabase/Redis endpoints.

## Post-Deploy Smoke Tests

- Public lead form submits successfully
- Admin login works
- Lead list/detail loads with correct role scope
- Super Admin/Admin document upload works
- Documents review verify/reject works
- QR-UTR payment review works
- Razorpay order endpoint returns live order payload
- Notification queue jobs are consumed by worker
