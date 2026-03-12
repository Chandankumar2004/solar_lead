# Deployment Ready Checklist

Last Updated: 2026-03-12

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

2. Provision external services:
- Supabase project + `documents` bucket
- Redis instance
- Firebase service account
- Razorpay keys

3. Run DB migrations:
```bash
pnpm exec prisma migrate deploy --schema=./apps/api/prisma/schema.prisma
```

4. Deploy services:
- API service (`pnpm start`)
- Worker service (`pnpm worker`)
- Web service (`pnpm start`)

## Render Quick Deploy

1. Push repo with `render.yaml`.
2. Create Blueprint deploy in Render dashboard.
3. Fill all `sync: false` env vars.
4. Deploy and check:
- API health: `/health`
- Login flow (`/api/auth/login` then `/api/auth/me`)
- Worker logs for queue startup

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
