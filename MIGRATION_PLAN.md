# Supabase Native Migration Plan (Prisma Removal)

## Scope
- Target repository: full-stack Solar Lead Management System (`apps/api`, `apps/web`, `apps/mobile`, `packages/shared`).
- Objective: remove Prisma runtime/build dependence, keep Supabase Auth + Supabase-native data access, preserve API/UI behavior where possible.

## Audit Summary (Repo-Wide)

### 1. Prisma files and scripts
- Prisma schema/migrations/seed:
  - `apps/api/prisma/schema.prisma`
  - `apps/api/prisma/seed.ts`
  - `apps/api/prisma/migrations/**`
- Prisma runtime helper:
  - `apps/api/src/lib/prisma.ts`
- Prisma dependencies/scripts:
  - `apps/api/package.json`:
    - `postinstall` runs `prisma generate`
    - `build` runs `prisma:generate`
    - `prisma:*` scripts
    - deps include `@prisma/client`, `prisma`
  - root `package.json` has Prisma schema metadata block

### 2. Prisma usage in runtime code
- Widespread in API routes/services:
  - `apps/api/src/routes/*` (leads, users, dashboard, payments, documents, notifications, districts, etc.)
  - `apps/api/src/services/*` (districts, notification, lead assignment, SLA, audit, auth mapping)
  - `apps/api/src/middleware/error.ts` (Prisma error type branches)
  - `apps/api/src/types.ts` and role helpers import Prisma enums
- Startup/runtime boot path:
  - `apps/api/src/index.ts` imports:
    - `runPrismaStartupChecks` from `lib/prisma.ts`
    - `bootstrapSeedSuperAdmin` (currently Prisma-backed)

### 3. Auth/session flow
- Frontend login:
  - `apps/web/src/components/LoginForm.tsx` uses Supabase `signInWithPassword`, then calls backend `/api/auth/me`.
- Frontend session:
  - `apps/web/src/lib/api.ts` injects bearer token from Supabase browser session and refreshes via Supabase.
  - `apps/web/src/app/login/page.tsx` and `PortalShell.tsx` call `/api/auth/me`.
- Backend auth:
  - `apps/api/src/middleware/auth.ts` validates bearer/cookie token via Supabase admin `getUser`.
  - `apps/api/src/routes/auth.ts` uses Supabase-auth service for login/refresh/me.
- Current gap:
  - auth service still maps to app user/profile via Prisma DB reads/writes.

### 4. Env + config
- Frontend:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `NEXT_PUBLIC_API_BASE_URL`
- Backend:
  - `SUPABASE_URL`
  - `SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `PORT`
  - currently still requires Prisma DB URLs (`DATABASE_URL`, `DIRECT_URL`) via env schema/runtime.

## Migration Phases

### Phase A (stability-first)
1. Stop Prisma from running in install/build/start:
   - remove Prisma generate hooks from scripts.
   - remove startup Prisma checks/bootstrap from `index.ts`.
2. Replace startup check with Supabase health probe.
3. Ensure backend still binds `0.0.0.0` + `PORT`.

### Phase B (auth path de-Prisma)
1. Refactor `supabase-auth.service.ts` to remove Prisma reads/writes for app profile mapping:
   - fetch/resolve profile from Supabase `users` table using service role via PostgREST.
   - sync Supabase user metadata (`app_user_id`, `full_name`).
2. Replace Prisma-backed bootstrap/admin mapping with Supabase-backed equivalent or safe no-op.
3. Replace Prisma-backed audit log writer with Supabase insert.

### Phase C (remaining business data layer)
1. Incrementally replace Prisma usage in routes/services with Supabase-native queries/RPC/SQL functions.
2. Remove Prisma enum imports by introducing local/shared enum/type definitions.
3. Delete `lib/prisma.ts`, prisma scripts, and Prisma dependencies only when zero runtime compile references remain.

## Deliverables Planned
- Code edits for startup + auth + env/script cleanup.
- `MIGRATION_NOTES.md` with run/test/deploy steps and SQL requirements.
- Optional SQL helper scripts for Supabase editor where mapping bootstrap is needed.

