# System Architecture Audit

Date: 2026-03-12  
Repository: `d:\Solar_Lead`

## 1. Current architecture discovered in codebase

### Presentation layer
- Public landing page: Next.js + Tailwind + React Hook Form + Zod + Axios.
  - Lead capture form posts to backend public REST APIs.
  - Files: `apps/web/src/app/page.tsx`, `apps/web/src/components/PublicLeadForm.tsx`
- Web admin portal: Next.js + Tailwind + Zustand + Axios/SWR + Recharts.
  - Auth state from `/api/auth/me` using cookie/bearer session.
  - Files: `apps/web/src/app/(portal)/**`, `apps/web/src/lib/auth-store.ts`, `apps/web/src/components/DashboardCharts.tsx`
- Mobile app: Expo React Native + React Navigation + Zustand + React Hook Form + AsyncStorage + document/image pickers + biometric unlock.
  - Files: `apps/mobile/src/App.tsx`, `apps/mobile/src/store/*.ts`, `apps/mobile/src/services/document-upload.ts`

### Application layer (backend)
- Runtime/framework: Node.js + Express.
- ORM/data access: Prisma.
- Auth: Supabase Auth tokens validated server-side (JWT-based tokens, not local jsonwebtoken signing pipeline).
- API pattern: REST endpoints with envelope responses and route-level validation/middleware.
- Core domains present:
  - leads/status transitions
  - assignment engine
  - notifications
  - payments
  - documents/storage
  - RBAC and auditing
  - public lead intake
- Files: `apps/api/src/app.ts`, `apps/api/src/routes/**`, `apps/api/src/services/**`, `apps/api/src/middleware/**`

### Data layer
- PostgreSQL via Prisma datasource (`provider = postgresql`), intended Supabase connection strings.
- Supabase Storage used for document upload/download signed URL flow.
- Firebase Admin used for push delivery + Firestore internal notifications.
- Prisma models include users, leads, statuses, transitions, docs, payments, notifications, audit logs.
- Files: `apps/api/prisma/schema.prisma`, `apps/api/src/services/storage/supabaseStorage.ts`, `apps/api/src/lib/firebase.ts`

## 2. Components correctly implemented
- Landing page lead capture exists and sends to backend public APIs.
- Backend exposes structured REST endpoints by domain.
- Prisma schema supports required core entities (users/leads/statuses/payments/documents/audit/notification logs).
- Supabase PostgreSQL usage is configured and active in env/docs.
- Supabase Storage integration exists (signed upload/download URL generation).
- Firebase integration exists on backend (`firebase-admin`) and web realtime listener (Firestore).
- Redis + Bull queue wiring now exists for async notification jobs.
- Razorpay order API is integrated using provider HTTP API and persists payment records.
- Lead assignment engine exists with district-aware assignment/fallback logic.
- RBAC middleware exists and is enforced across protected API surfaces.
- Mobile lead listing and detail flows consume REST API only.
- Sensitive-field masking exists for customer details in lead APIs.
- Protected APIs are mounted behind auth middleware where required.

## 3. Missing components (architecture gaps)

### Critical
1. None remaining in this pass.
   - Redis and Bull wiring is now implemented.
   - Notification async dispatch is now queue-backed via Bull worker.
   - Razorpay order API now creates real provider orders and persists payment rows.

### Non-critical / partial
1. Queue runtime is dependency-sensitive:
   - Bull/Redis is implemented with runtime loading; queue falls back to direct processing if Redis URL or Bull/Redis packages are unavailable.
2. Mobile push token lifecycle is partial:
   - Backend supports device token APIs and FCM send.
   - Mobile app currently does not register device tokens automatically.
3. Provider adapters for SendGrid/SES/Twilio/Interakt/WATI are scaffolded but include placeholder branches.

## 4. Incorrect implementations
- Queue architecture fallback caveat:
  - Required: Bull (Redis-backed) for async jobs.
  - Current: implemented with fallback to inline processing when queue dependency/runtime is unavailable.
- Payment gateway:
  - Razorpay order creation mismatch is fixed.
- Legacy AWS naming remains in several places (`s3Key`, `uploadBlobToS3`, user-facing “S3 upload failed”) despite Supabase storage backend.

## 5. AWS dependencies that should be replaced with Supabase
- No active AWS S3 SDK usage detected in storage flows.
- Remaining AWS-style artifacts are naming only:
  - Prisma field: `documents.s3Key`
  - API/mobile variable names and error strings referencing S3
- Recommendation:
  - Preserve DB field for backward compatibility.
  - Normalize code/docs wording to “storage object key / Supabase Storage”.

## 6. Required fixes

### Implemented in this pass
1. Implemented Redis client wiring (`apps/api/src/lib/redis.ts`).
2. Implemented Bull queue connection (`apps/api/src/lib/bull-connection.ts`).
3. Implemented queue-backed notification workers and enqueue flow (`apps/api/src/workers/notification.worker.ts`, `apps/api/src/services/notification.service.ts`).
4. Implemented live Razorpay order creation + payment persistence (`apps/api/src/routes/payments.ts`).

### Should fix next
1. Add automatic mobile push-token registration/unregistration flow.
2. Convert remaining AWS/S3 naming in client-visible text to Supabase-neutral wording.
3. Add Redis-backed rate-limit store (optional fallback to memory if Redis unavailable).

## 7. Architecture improvement suggestions
- Split worker runtime from API process (dedicated worker deployment) while keeping same codebase.
- Add provider health checks for SMS/email/WhatsApp adapters with startup diagnostics.
- Add integration tests for:
  - queue enqueue/dequeue + retry semantics
  - Razorpay order creation response mapping
  - end-to-end public lead -> assignment -> notification path
- Add architecture docs for “degraded mode” behavior when Redis or provider credentials are unavailable.

---

## Files inspected (key)
- Backend:
  - `apps/api/prisma/schema.prisma`
  - `apps/api/src/app.ts`
  - `apps/api/src/config/env.ts`
  - `apps/api/src/lib/{supabase.ts,firebase.ts,redis.ts,bull-connection.ts}`
  - `apps/api/src/routes/{public.ts,auth.ts,leads.ts,payments.ts,documents.ts,lead-documents.ts,notifications.ts}`
  - `apps/api/src/services/{lead-assignment.service.ts,lead-status.service.ts,notification.service.ts,customer-notification-delivery.service.ts}`
  - `apps/api/src/workers/notification.worker.ts`
- Web:
  - `apps/web/src/app/page.tsx`
  - `apps/web/src/components/PublicLeadForm.tsx`
  - `apps/web/src/components/DashboardCharts.tsx`
  - `apps/web/src/lib/api.ts`
- Mobile:
  - `apps/mobile/src/App.tsx`
  - `apps/mobile/src/services/{api.ts,document-upload.ts,firebase.ts}`
  - `apps/mobile/src/screens/{LeadListScreen.tsx,LeadDetailScreen.tsx,NotificationsScreen.tsx}`
  - `apps/mobile/src/store/{auth-store.ts,queue-store.ts}`
