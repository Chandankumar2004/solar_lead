# Supabase Auth + Runtime Stabilization Notes

## What Changed
- Removed Prisma startup hooks from API boot path:
  - `runPrismaStartupChecks()` no longer called at server start.
  - `bootstrapSeedSuperAdmin()` no longer called at server start.
- Lazy-loaded route modules in `apps/api/src/app.ts` so Prisma-backed route files are not imported during process boot.
- Added non-blocking Supabase startup probe:
  - `apps/api/src/lib/startup-health.ts`
  - Called from `apps/api/src/index.ts`.
- Removed Prisma generate execution from API scripts:
  - `apps/api/package.json` no longer runs `prisma:generate` in `build` or `postinstall`.
- Added auth profile auto-provision fallback:
  - `apps/api/src/services/supabase-auth.service.ts`
  - If a Supabase-authenticated user has no mapped app profile, backend now attempts safe `public.users` upsert.
- Frontend auth retry hardening:
  - `apps/web/src/lib/api.ts`
  - On failed Supabase refresh, browser session is signed out to avoid stale refresh token loops.
- Replaced Prisma usage in super admin password reset script:
  - `apps/api/src/scripts/reset-super-admin-password.ts` now uses Supabase admin APIs and `public.users`.
- Updated backend error middleware to avoid direct Prisma error class dependency:
  - `apps/api/src/middleware/error.ts`.
- Added SQL helper for profile backfill:
  - `apps/api/sql/001_supabase_auth_backfill.sql`.

## Prisma Pieces Removed From Startup/Build
- Removed from startup:
  - `apps/api/src/index.ts` Prisma startup check import/use.
  - `apps/api/src/index.ts` Prisma-based super admin bootstrap import/use.
- Removed from build/install hooks:
  - `apps/api/package.json` `postinstall` Prisma generate hook.
  - `apps/api/package.json` `build` Prisma generate step.
  - root `package.json` Prisma schema metadata block.

## Supabase Auth Flow (Current)
1. Frontend signs in with Supabase (`signInWithPassword`).
2. Frontend calls backend `/api/auth/me` with bearer access token.
3. Backend validates token via Supabase admin `auth.getUser`.
4. Backend maps Supabase user to `public.users` profile by:
   - `app_user_id` metadata, then
   - email match, then
   - seed super-admin auto-create/update, then
   - generic auto-provision fallback.
5. `requireAuth` enforces active app user status and returns:
   - `401` for missing/invalid session.
   - `403` for mapped-auth/account profile restrictions.

## Required Environment Variables

### Backend (`apps/api`)
- `PORT`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`
- Optional seed/admin:
  - `SEED_SUPER_ADMIN_EMAIL`
  - `SEED_SUPER_ADMIN_PASSWORD`
  - `SEED_SUPER_ADMIN_NAME`
  - `SEED_SUPER_ADMIN_PHONE`
  - `SEED_SUPER_ADMIN_EMPLOYEE_ID`

### Frontend (`apps/web`)
- `NEXT_PUBLIC_API_BASE_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## Manual SQL Setup (If Needed)
- Run `apps/api/sql/001_supabase_auth_backfill.sql` in Supabase SQL Editor.
- This backfills missing `public.users` rows for existing `auth.users` entries.

## Local Run
1. `pnpm install`
2. `pnpm --filter @solar/api build`
3. `pnpm --filter @solar/web build`
4. Start API: `pnpm --filter @solar/api start`
5. Start web: `pnpm --filter @solar/web start`

## Login / Protected API Test
1. Open `/login` in web app.
2. Login with a valid Supabase Auth user.
3. Verify `/api/auth/me` returns `200` with app user object.
4. Verify protected endpoints (e.g. `/api/dashboard`) return data with bearer token/cookies.

## Remaining Work (Targeted, Not Startup-Critical)
- Legacy business routes still include Prisma data access internals.
- Startup is now Supabase-first and non-blocking, but full route-layer Prisma removal requires incremental per-route replacement to Supabase queries/RPC.
