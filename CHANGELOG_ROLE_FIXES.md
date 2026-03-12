# Changelog: Role & Permission Fixes

Date: 2026-03-12  
Scope: RBAC, route guards, data scoping, sensitive data masking, web/mobile role access

## Summary of implemented fixes

## 1) Backend RBAC hardening
- Restricted lead status configuration to Super Admin only.
  - File: `apps/api/src/routes/lead-statuses.ts`
- Restricted district assignment-rule mapping endpoints to Super Admin only while keeping district read APIs for Admin/Super Admin.
  - File: `apps/api/src/routes/districts.ts`
- Restricted notification management endpoints to Super Admin/Admin only:
  - `/api/notifications/internal`
  - `/api/notifications/templates*`
  - `/api/notifications/logs*`
  - File: `apps/api/src/routes/notifications.ts`
- Enforced reassignment/update restrictions on `PATCH /api/leads/:id`:
  - Field Executive blocked from generic lead patch endpoint.
  - District Manager prevented from cross-district lead moves.
  - District Manager prevented from reassigning manager ownership.
  - District Manager reassignment allowed only to active executives mapped to the same district.
  - Active status validation added for assigned manager/executive IDs.
  - File: `apps/api/src/routes/leads.ts`

## 2) Sensitive data masking
- Added role-aware sensitive response handling for lead/customer details.
- Lead detail and lead create/update responses now sanitize `customerDetail` payload using masked values by default; unmasked PAN returned only for allowed roles (Super Admin/Admin).
- Customer detail GET/PUT responses now use role-aware sensitive field handling.
- File: `apps/api/src/routes/leads.ts`

## 3) Web admin portal restrictions
- Removed Field Executive from portal-wide allowed role set.
- Restricted workflow/config page access to Super Admin only.
- Restricted notifications management page access to Super Admin/Admin only.
- Added explicit portal-shell protection to reject Field Executive access and redirect to login.
- Added login-time portal rejection for Field Executive users.
- Files:
  - `apps/web/src/lib/rbac.ts`
  - `apps/web/src/components/admin/PortalShell.tsx`
  - `apps/web/src/components/LoginForm.tsx`
  - `apps/web/src/app/(portal)/notifications/page.tsx`
  - `apps/web/src/app/(portal)/leads/page.tsx`

## 4) Mobile role restrictions
- Enforced mobile access to Field Executive role only at:
  - session bootstrap (`/api/auth/me`)
  - login response handling
- Non-Field Executive mobile sessions are rejected and logged out from API session.
- File: `apps/mobile/src/store/auth-store.ts`

## Validation run
- API build: passed (`pnpm --filter @solar/api build`)
  - Prisma generate hit Windows file-lock fallback (`EPERM rename ...query_engine...`) and used existing generated client; TypeScript build completed.
- Web build: passed (`pnpm --filter @solar/web build`)

## Files updated in this fix set
- `ROLE_PERMISSION_AUDIT.md` (new)
- `CHANGELOG_ROLE_FIXES.md` (new)
- `apps/api/src/routes/lead-statuses.ts`
- `apps/api/src/routes/districts.ts`
- `apps/api/src/routes/notifications.ts`
- `apps/api/src/routes/leads.ts`
- `apps/web/src/lib/rbac.ts`
- `apps/web/src/components/admin/PortalShell.tsx`
- `apps/web/src/components/LoginForm.tsx`
- `apps/web/src/app/(portal)/notifications/page.tsx`
- `apps/web/src/app/(portal)/leads/page.tsx`
- `apps/mobile/src/store/auth-store.ts`

## Schema / migration changes
- None added in this patch set.

## Environment changes
- None required for this RBAC fix set.

## Tech stack alignment corrections made
- No stack replacement performed.
- Existing Supabase-based storage/auth usage retained.
- RBAC fixes were implemented within existing Express/Prisma/Next/React-Native patterns.

## Manual test checklist by role

### Super Admin
- [ ] Can access web portal pages: dashboard, leads, users, districts, workflow, notifications, documents review, payments verification.
- [ ] Can create/update lead statuses and transitions.
- [ ] Can update district mappings.
- [ ] Can manage users globally (including Admins).
- [ ] Can view full reports/dashboard.
- [ ] Can verify/reject UTR.
- [ ] Can manage notification templates/logs/internal send.
- [ ] Sees sensitive lead customer fields per allowed role behavior.

### Admin
- [ ] Can access web portal dashboard/leads/users/notifications/documents review/payments verification.
- [ ] Cannot access workflow config (lead-status configuration route/page guarded).
- [ ] Cannot update district assignment-rule mappings.
- [ ] Can manage users only within partial scope (manager/executive).
- [ ] Can verify/reject UTR.
- [ ] Can manage notifications/templates/logs.
- [ ] Reassignment works where allowed.

### District Manager
- [ ] Can access web dashboard/leads/documents review/payments verification.
- [ ] Cannot access users, workflow, notifications management pages.
- [ ] Can only see district-scoped leads/payments/documents.
- [ ] Can reassign lead only to active executives mapped to same district.
- [ ] Cannot move lead district via patch route.
- [ ] Cannot change assigned manager ownership on leads.
- [ ] Can verify/reject UTR within scoped leads.

### Field Executive
- [ ] Cannot access web admin portal (login and portal shell both blocked).
- [ ] Mobile login works only for Field Executive account.
- [ ] Mobile login is rejected for non-field roles.
- [ ] Can list only assigned leads.
- [ ] Can update lead status on assigned leads.
- [ ] Can upload lead documents on assigned leads.
- [ ] Can create token payment/QR-UTR entries on assigned leads.
- [ ] Cannot call lead patch reassignment endpoint.
- [ ] Cannot access notification template/log management APIs.

### Customer (public)
- [ ] Can submit lead via `/public/leads` (or `/public/lead-submission`) without auth.
- [ ] Public flow does not expose admin endpoints.
- [ ] Duplicate check and district mapping public endpoints behave as expected.

## Remaining gaps requiring business clarification
- Field Executive lead creation capability currently exists (`POST /api/leads`). Matrix does not explicitly include/exclude this; if FE lead creation must be disallowed, that needs a policy decision.
- Redis/Bull queue wiring remains placeholder-level in repository; notification retries are not fully queue-worker backed.
- Razorpay/PayU gateway order endpoints are placeholder-style and not full production verification callbacks yet.
