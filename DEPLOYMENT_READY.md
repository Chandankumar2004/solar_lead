# Deployment Ready Checklist

Last Updated: 2026-03-13

## Primary Deployment Target

- Backend/API: Northflank combined service (monorepo root commands)
- Detailed setup: [NORTHFLANK_DEPLOYMENT.md](./NORTHFLANK_DEPLOYMENT.md)

## What Is Ready

- API production build/start scripts
- Prisma generate integrated in API build
- Dockerfile for API
- Supabase Postgres + Supabase Storage integration
- Redis + Bull queue wiring
- CI workflow for build validation (`.github/workflows/ci.yml`)
- Node 20 pinning via `engines` and `.nvmrc`

## Required Before Go-Live

1. Set all required API env vars from `apps/api/.env.example` in your platform.
2. Use Prisma-only migration flow (no Supabase migration-status/list hooks).
3. Provision external services:
   - Supabase project + `documents` bucket
   - Firebase service account
   - Redis (if queue-enabled features are required)
4. Verify runtime endpoints:
   - `GET /`
   - `GET /health`
   - `GET /health/deps`

## Monorepo API Commands

- Build:
```bash
pnpm install --frozen-lockfile --prod=false && pnpm --filter @solar/api build
```

- Start:
```bash
pnpm --filter @solar/api start
```

- Migrations (manual, when required):
```bash
pnpm --filter @solar/api exec prisma migrate deploy --schema ./prisma/schema.prisma
```

## Important Safety Notes

- Do not create fake internal Supabase tables like `supabase_migrations.schema_migrations`.
- Do not run Supabase CLI migration-status hooks in service startup/release commands.
- Keep runtime datasource env values raw (no wrapping quotes).
