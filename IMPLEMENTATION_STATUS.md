# Implementation Status

Last Updated: 2026-03-12

This document tracks how much of the system is implemented across `frontend`, `backend`, and `database/data` layers.

## 1. Frontend Status

### 1.1 Public Landing (Next.js)
Status: `Completed`

Completed:
- Public lead form with validation and submission to backend REST API.
- District mapping integration.
- Duplicate-check and lead-capture flow.

### 1.2 Web Admin Portal (Next.js)
Status: `Mostly Completed`

Completed:
- Login/session-based portal access.
- Role-based navigation visibility.
- Dashboard, leads list/detail, users, districts, workflow pages.
- Lead reassignment and status transition UX.
- Documents review queue.
- Document preview/download.
- Document upload for `SUPER_ADMIN` and `ADMIN`:
  - Lead detail page documents tab.
  - Documents Review page upload panel.
- Payments verification queue and review actions.
- Notifications management UI.

Partial / Pending:
- Additional UX polish and guided upload flow (currently uses lead UUID input in Documents Review upload panel).

### 1.3 Mobile App (Expo React Native)
Status: `Mostly Completed`

Completed:
- Auth/session flow.
- Assigned leads flow for field users.
- Lead details, status updates, document upload service.
- Offline queue and retry behavior.
- QR-UTR payment submission flow.

Partial / Pending:
- Automatic device push token registration lifecycle is not fully wired end-to-end.

## 2. Backend Status

Status: `Mostly Completed`

Completed:
- Express REST API with route validation and error handling.
- Auth middleware and RBAC enforcement.
- District/assigned-lead scoped authorization checks.
- Lead management APIs (list/detail/create/update/reassign/status transitions).
- User and district management APIs.
- Document upload flow:
  - presign endpoint
  - complete endpoint
  - review and download-url endpoints
- Supabase Storage signed URL integration.
- Payments:
  - QR-UTR creation
  - verification queue and review
  - Razorpay order creation (live API call + DB persistence)
- Notifications:
  - internal and customer notifications
  - Firebase push integration
  - queue-backed dispatch with Bull/Redis
- Audit logs for key actions.

Partial / Pending:
- PayU gateway endpoint remains placeholder.
- Some provider adapters are still placeholder-level:
  - WhatsApp providers (Twilio/Interakt/WATI)
  - depends on selected provider and credentials.

## 3. Database and Data Layer Status

Status: `Completed (Core) / Partial (Operational cleanup)`

Completed:
- Prisma schema covers core entities:
  - users, districts, user_district_assignments
  - leads, lead_statuses, lead_status_transitions, lead_status_history
  - customer_details, documents, payments
  - notification_templates, notification_logs
  - loan_details, audit_logs, user_device_tokens
- PostgreSQL (Supabase) is configured and used.
- Supabase Storage is used for file objects.
- Redis is wired for queue/caching support.
- Bull queue connection and worker processing implemented.

Partial / Pending:
- Legacy field naming (`s3Key`) remains in schema/code for compatibility; backend storage is Supabase.
- Migration/seed hygiene depends on deployment environment state.

## 4. Role and Permission Coverage (Current)

Status: `Implemented with enforced backend checks`

Implemented:
- Super Admin: full control, including status/assignment config and global access.
- Admin: broad operational access, restricted from super-admin-only config paths.
- District Manager: district-scoped access and reassignment controls.
- Field Executive: assigned-lead scope and restricted admin/web capabilities.
- Customer: public lead submitter only (not platform admin user).

Reference:
- `ROLE_PERMISSION_AUDIT.md`

## 5. Architecture Alignment Snapshot

Aligned:
- Next.js web + landing, Expo mobile, Express API, Prisma, Supabase Postgres/Storage, Redis/Bull, Firebase.

Still to monitor:
- Provider-specific production integrations (non-console channels) based on business activation.

Reference:
- `SYSTEM_ARCHITECTURE_AUDIT.md`

## 6. Ready-for-UAT Areas

Ready:
- Public lead capture.
- Admin lead lifecycle and reassignment flows.
- Document upload/review/download flows.
- Payment QR-UTR verification flow.
- Razorpay order creation flow.
- Role-based access control and scoped data access.

Needs targeted UAT before production:
- Provider channel delivery paths (SMS/Email/WhatsApp) with real credentials.
- Mobile push token lifecycle and push delivery reliability under real device conditions.

