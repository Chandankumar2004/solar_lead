# Implementation Changelog
Date: 2026-03-12

## Summary
This pass focused on Phase-5 priority `#1` (auth/RBAC/security) and configuration correctness, after completing the full code audit.

## Changes Made

### 1) Centralized Lead Access Scoping
- Added `apps/api/src/services/lead-access.service.ts`
  - New reusable helpers:
    - `buildLeadAccessScope`
    - `scopeLeadWhere`
    - `assertDistrictAccessForLeadCreation`
    - `assertLeadAccess`
  - Role behavior:
    - `SUPER_ADMIN` / `ADMIN`: full scope.
    - `MANAGER`: scoped by assigned manager or mapped district.
    - `EXECUTIVE`: scoped by assigned executive.

### 2) Leads Route Hardening
- Updated `apps/api/src/routes/leads.ts`
  - Applied scoped filtering to list/detail/status/customer-details/patch/transition routes.
  - Restricted lead creation to actor-mapped district for manager/executive roles.

### 3) Dashboard Scope Hardening
- Updated `apps/api/src/routes/dashboard.ts`
  - Applied lead scoping to all aggregate counts.
  - Scoped executive performance list for manager/executive actors.

### 4) Document Access Hardening
- Updated `apps/api/src/routes/documents.ts`
  - Scoped review queue for non-admin roles.
  - Scoped review action access.
  - Scoped document download-url access.

### 5) Lead Document Flow Hardening
- Updated `apps/api/src/routes/lead-documents.ts`
  - Added scoped lead existence/access checks to presign/complete/list endpoints.

### 6) Payments Scope Hardening
- Updated `apps/api/src/routes/payments.ts`
  - Scoped lead access for payment creation and gateway order creation.
  - Scoped verification queue for non-admin roles.
  - Scoped payment review access for district managers.
  - Ensured actor is attached to payment creation and audit.

### 7) Upload Route Hardening
- Updated `apps/api/src/routes/uploads.ts`
  - Added role gate + scoped lead/document access.
  - Added file type and size validation consistent with lead-documents flow.
  - Fixed TypeScript shape issue for selected document fields.

### 8) Notifications Scope Hardening
- Updated `apps/api/src/routes/notifications.ts`
  - Scoped template-render lead lookup for district managers.
  - Scoped logs list/detail visibility for district managers to accessible leads or own recipient logs.

### 9) SLA Monitor Startup
- Updated `apps/api/src/index.ts`
  - Added `startSlaOverdueMonitor()` startup call.

### 10) Environment and Config Correctness
- Updated `apps/web/.env.example`
  - Added missing:
    - `NEXT_PUBLIC_SUPABASE_URL`
    - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- Updated `apps/api/.env.example`
  - Added `DATABASE_URL_SESSION_FALLBACK` docs.
  - Replaced outdated AWS S3 env block with Supabase Storage guidance.
- Updated `apps/api/src/config/env.ts`
  - Added optional validation for `DATABASE_URL_SESSION_FALLBACK`.

## Verification Performed
- `pnpm --filter @solar/api build` ✅
  - Note: Prisma generate reported Windows `EPERM` rename lock and used built-in retry fallback; TypeScript build succeeded.
- `pnpm --filter @solar/web build` ✅

## Not Implemented In This Pass
- Durable Redis/Bull queue wiring.
- Payment webhook verification/signature handling.
- Dedicated assignment history API/UI.
- Mobile push token registration flow.

These are documented in `AUDIT_REPORT.md` under Critical/High priorities.

---

## Architecture Alignment Pass (2026-03-12, later update)

### Critical fixes completed
- Implemented Redis runtime wiring with degraded-mode fallback:
  - `apps/api/src/lib/redis.ts`
- Implemented Bull queue connection:
  - `apps/api/src/lib/bull-connection.ts`
- Implemented notification queue worker + enqueue integration:
  - `apps/api/src/workers/notification.worker.ts`
  - `apps/api/src/services/notification.service.ts`
- Replaced Razorpay placeholder order creation with live provider API flow and payment persistence:
  - `apps/api/src/routes/payments.ts`
- Extended env validation and examples for Redis/Bull and Razorpay:
  - `apps/api/src/config/env.ts`
  - `apps/api/.env.example`

### Verification
- `pnpm --filter @solar/api build` ✅
- `pnpm --filter @solar/web build` ✅
- Note: local environment still reports recurring Prisma Windows `EPERM` rename retries during generate, but build continues with fallback as configured.
