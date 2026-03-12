# Solar Lead Platform Audit Report
Date: 2026-03-12

## Scope
- Audited monorepo modules: `apps/api`, `apps/web`, `apps/mobile`, `packages/shared`, env/config and deployment docs.
- Method: static code inspection plus bounded builds.
- Build checks run:
  - `pnpm --filter @solar/api build` (pass; Prisma generate used retry fallback due Windows file lock)
  - `pnpm --filter @solar/web build` (pass)

## Implemented Correctly
- Public lead capture form, validation, UTM capture, duplicate check, backend submission.
- Lead CRUD, status transition graph, timeline storage.
- District/user management flows in admin.
- Document upload via signed URLs to Supabase Storage (mobile/web flow present).
- Payment verification queue and review workflow for QR-UTR payments.
- Audit logging for sensitive actions across auth/leads/users/payments/documents.
- Mobile offline queue for lead/doc retries.
- Mobile biometric lock/unlock flow.

## Implemented Partially
- Auth model consistency:
  - API supports HTTP-only cookie sessions, but web login primarily uses Supabase bearer flow.
- RBAC data scoping:
  - Base role checks existed; data-level scoping had holes in several routes (fixed in this implementation pass).
- Automated assignment:
  - Auto-assign logic exists; assignment history is only in audit logs (no dedicated assignment-history API/table).
- Notifications:
  - Template/trigger/logging exists.
  - SMS MSG91 has real HTTP integration.
  - Email SendGrid/SES and WhatsApp providers are placeholder adapters.
  - Retry is in-process, not durable queue.
- Real-time tracking:
  - Polling and Firestore snapshot exist for selected views.
  - No end-to-end realtime stream for lead list/status updates.
- Payments:
  - QR-UTR flow is functional.
  - Gateway order endpoints are explicit placeholders; no webhook verification flow.

## Missing Completely
- Durable queue worker implementation with Redis/Bull in production path (code stubs only).
- Payment webhook verification endpoint(s) and signature validation flow.
- Dedicated assignment history endpoint for operational review.
- Document archive/delete policy and corresponding API/UI actions.

## Broken or Inconsistent
- Queue infra mismatch:
  - `apps/api/src/lib/redis.ts`, `apps/api/src/lib/bull-connection.ts`, and `apps/api/src/workers/notification.worker.ts` are stubs.
  - README/DevOps messaging implies queue infra not currently wired in runtime.
- Deployment/docs mismatch:
  - README references `docs/database-er-diagram.mmd`, but file is absent.
- Legacy route inconsistency:
  - `/api/uploads/presign` exists but client usage is on `/api/leads/:leadId/documents/*` paths.

## Security Issues
- CORS is permissive in API runtime (`origin: true`) and does not enforce explicit allowlist in production (`apps/api/src/app.ts`).
- Sensitive environment files in local workspace contain real values (not reported here verbatim). Rotation is recommended if any were ever shared.
- Data-scoping leaks existed for manager/executive visibility in leads/documents/payments/dashboard/notifications/uploads routes; fixed in this pass.

## Data Model Gaps
- No durable queue state model for notification jobs.
- No dedicated payment webhook event table (raw payload + verification status).
- No explicit document lifecycle flags (archived/deleted/retention policy).

## API Gaps
- Missing payment webhook APIs for gateway callback verification.
- No assignment-history read endpoint.
- No admin-facing audit-log listing endpoint for investigation workflows.

## UI/UX Gaps
- Mobile push registration flow missing (no device token registration call from app lifecycle).
- Mobile `Home` screen does not show live KPIs from backend dashboard.
- Some admin table views are heavy on horizontal scrolling and have limited sort/filter depth.

## Mobile Gaps
- No FCM token registration/unregistration flow wired from app startup/profile.
- Gateway payment in mobile is labeled placeholder and does not complete provider verification path.

## Deployment/Config Gaps
- `apps/web/.env.example` previously missed required Supabase public vars used in code (fixed in this pass).
- `apps/api/.env.example` previously documented AWS S3 vars while runtime uses Supabase Storage (fixed in this pass).
- `DATABASE_URL_SESSION_FALLBACK` used in runtime logic but previously not validated in env schema (fixed in this pass).

## Feature Checklist
| Feature | Status | Evidence |
|---|---|---|
| A. Public lead capture landing page | Implemented | `apps/web/src/app/page.tsx`, `apps/web/src/components/PublicLeadForm.tsx`, `apps/api/src/routes/public.ts`, `apps/api/src/middleware/rate-limit.ts` |
| B. Web admin portal | Mostly implemented | `apps/web/src/app/(portal)/*`, `apps/api/src/routes/auth.ts`, `apps/api/src/routes/leads.ts`, `users.ts`, `districts.ts`, `dashboard.ts`, `documents.ts`, `payments.ts`, `notifications.ts` |
| C. Mobile field app | Implemented with gaps | `apps/mobile/src/screens/*`, `apps/mobile/src/services/document-upload.ts`, `apps/mobile/src/store/queue-store.ts` |
| D. Automated assignment engine | Partial | `apps/api/src/services/lead-assignment.service.ts`, lead create/reassign logic in `apps/api/src/routes/leads.ts` |
| E. Multi-channel notifications | Partial | `apps/api/src/services/notification.service.ts`, `customer-notification-delivery.service.ts`, `routes/notifications.ts` |
| F. Document storage/management | Mostly implemented | `apps/api/src/routes/lead-documents.ts`, `documents.ts`, `services/storage/supabaseStorage.ts`, web/mobile document views |
| G. UPI/QR payment collection | Partial | `apps/api/src/routes/payments.ts`, mobile payment UI in `apps/mobile/src/screens/LeadDetailScreen.tsx` |
| H. Real-time lead tracking/status mgmt | Partial | lead status APIs + timelines in `apps/api/src/routes/leads.ts`; polling/snapshot in web/mobile pages |

## Missing Features List
- Durable notification queue worker with Redis/Bull (persistent retries).
- Payment gateway webhook verification and signature check.
- Assignment history query API and UI surface.
- Document archive/delete lifecycle operations.
- Mobile push token registration flow.

## Broken Flows List
- Gateway order APIs are placeholders and do not complete provider-verified settlement.
- Notification retry logic is process-memory based; pending retries are lost on restart/deploy.
- README advertises artifacts/infrastructure not fully present in code runtime.

## Recommended Fixes (Priority)
### Critical
1. Implement durable notification queue and worker process.
   - Files: `apps/api/src/lib/redis.ts`, `apps/api/src/lib/bull-connection.ts`, `apps/api/src/workers/notification.worker.ts`, `apps/api/src/services/notification.service.ts`
   - DB changes: No (optional queue metadata table if desired).
   - Env changes: Yes (`REDIS_URL`, queue tuning vars).
2. Implement payment webhook verification and settlement update path.
   - Files: `apps/api/src/routes/payments.ts` (+ new webhook route/service), mobile/web payment status consumers.
   - DB changes: Recommended (webhook events table for idempotency/audit).
   - Env changes: Yes (gateway webhook secret keys).
3. Enforce explicit production CORS allowlist.
   - Files: `apps/api/src/app.ts`, `apps/api/src/config/env.ts`
   - DB changes: No.
   - Env changes: Yes (`WEB_ORIGIN`/`CORS_ORIGIN` mandatory in prod).

### High
1. Add mobile push token registration/unregistration lifecycle.
   - Files: `apps/mobile/src/App.tsx`, new push permission/token service, `apps/api/src/routes/notifications.ts` endpoints already available.
   - DB changes: No.
   - Env changes: Possibly (FCM client config checks).
2. Add dedicated assignment history endpoint and admin view.
   - Files: new route/service, web UI.
   - DB changes: Optional (if moving beyond audit log parsing).
   - Env changes: No.

### Medium
1. Add document archival/delete policy and UI actions.
   - Files: documents routes + web/mobile document pages.
   - DB changes: Yes (archive flags/columns if soft-delete).
   - Env changes: No.
2. Normalize auth UX between web and mobile (single session strategy).
   - Files: `apps/web/src/components/LoginForm.tsx`, `apps/mobile/src/store/auth-store.ts`, auth routes.
   - DB changes: No.
   - Env changes: Potentially (`AUTH_ENFORCE_RECAPTCHA_*` style toggles).

### Low
1. Align README/DEVOPS with actual runtime architecture and assets.
   - Files: `README.md`, `DEVOPS.md`, `docs/*`
   - DB changes: No.
   - Env changes: No.

## Fixes Implemented In This Pass
- Hardened lead data scoping across leads, dashboard, documents, payments, lead-documents, uploads, notifications logs/render.
- Added central lead access service for consistent role-based scoping.
- Started SLA overdue monitor at API startup.
- Synced env templates with runtime requirements (`apps/web/.env.example`, `apps/api/.env.example`, `apps/api/src/config/env.ts`).

## Database Changes Required?
- Not required for this implementation pass.
- Recommended for next phase:
  - webhook event idempotency/audit table
  - optional document lifecycle columns
  - optional assignment history table

## Environment Changes Required?
- Added/updated documented envs:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `DATABASE_URL_SESSION_FALLBACK` (optional but now validated)
- Existing envs still required for current architecture:
  - `DATABASE_URL`, `DIRECT_URL`, Supabase keys, Firebase keys, notification provider keys as applicable.
