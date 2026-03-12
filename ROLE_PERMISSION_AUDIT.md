# Role Permission Audit Report

Date: 2026-03-12  
Repository: `d:\Solar_Lead`

## Scope inspected
- Prisma schema and enums
- API auth/RBAC middleware and route handlers
- Lead access scoping service
- Web portal route/nav guards and page-level permission gates
- Mobile auth bootstrap/login restrictions
- Notification, payment verification, document review/upload, workflow/config, and public lead flows
- Supabase/Firebase/Redis/Bull integration points

## 1) Current roles found in code
- DB roles (`UserRole`): `SUPER_ADMIN`, `ADMIN`, `MANAGER`, `EXECUTIVE`
- RBAC mapping:
  - `MANAGER -> DISTRICT_MANAGER`
  - `EXECUTIVE -> FIELD_EXECUTIVE`
- Customer is modeled as public submitter data (`PublicLeadSubmission` / lead capture), not as system-auth user.

## 2) Current permission enforcement found in code
- Backend uses `requireAuth` + `allowRoles(...)`.
- Lead data scope is applied with `scopeLeadWhere(...)`:
  - Super Admin/Admin: global
  - District Manager: district/assigned-manager scoped
  - Field Executive: assigned leads only
- User management is partially scoped for Admins (cannot manage Admin/Super Admin).
- Documents/payments review routes enforce role and lead scope.
- Public lead submit routes are unauthenticated and separate.

## 3) Missing roles or incorrect role mapping
- No missing system roles in DB/RBAC mapping.
- Naming mismatch is intentional and handled (`MANAGER`/`EXECUTIVE` -> matrix labels).

## 4) Missing backend authorization checks (found)
1. Lead status configuration routes allowed Admin, but matrix requires Super Admin only.
2. District mapping/config endpoints allowed Admin for full mapping updates (assignment-rule-like capability), but matrix requires Super Admin only for assignment-rule configuration.
3. Notification management endpoints allowed District Manager for templates/logs/render and allowed any authenticated role for `/internal` trigger; matrix requires Super Admin/Admin only.
4. Generic lead patch endpoint allowed Field Executive to mutate lead-level fields/reassignment path due router-level role allow; matrix says FE cannot reassign and should not have broad admin mutations.
5. District Manager reassignment path did not fully validate assignee district constraints.
6. Lead detail endpoint returned raw `customerDetail` object (including sensitive encrypted fields), violating sensitive field masking rule.

## 5) Missing frontend route guards (found)
1. Web `ALL_ADMIN_ROLES` included `FIELD_EXECUTIVE`, allowing FE portal access.
2. Workflow/config route allowed Admin (`/workflow`) though config should be Super Admin only.
3. Notifications portal route allowed District Manager and FE, but notification management should be Super Admin/Admin only.

## 6) Missing mobile restrictions (found)
- Mobile auth accepted any authenticated role at bootstrap/login.
- Requirement says mobile app is for Field Executive access; role restriction absent.

## 7) Incorrect data scoping issues (found)
- Lead patch reassignment lacked strict district-level assignee validation for District Manager actions.

## 8) Unsafe endpoints accessible by wrong roles (found)
- `GET/POST/PATCH /api/lead-statuses*` (config surface) exposed to Admin.
- District mapping update/list endpoints exposed broad mapping to Admin.
- `POST /api/notifications/internal`, `GET /api/notifications/templates`, `POST /api/notifications/templates/:id/render`, `GET /api/notifications/logs*` exposed to non-matrix roles.
- `PATCH /api/leads/:id` reachable by Field Executive via router-level role allowance.

## 9) UI items visible to unauthorized roles (found)
- Web sidebar/nav and route guards exposed Dashboard/Leads/Notifications to Field Executive within admin portal shell.
- Notifications admin data tabs visible to District Manager.
- Workflow tab visible to Admin.

## 10) Recommended fixes by priority
### Critical
1. Remove Field Executive web portal access (frontend guard + backend admin-only endpoints).
2. Restrict lead-status and assignment-rule configuration to Super Admin.
3. Lock down notification management to Super Admin/Admin.
4. Block FE from broad lead patch/reassignment endpoint.
5. Mask sensitive customer fields in lead detail responses.

### High
1. Enforce District Manager reassignment only within manager’s district scope.
2. Enforce mobile FE-only role access at bootstrap/login.

### Medium
1. Standardize sensitive-field response contracts across lead detail and customer-detail APIs.
2. Add explicit tests for role matrix coverage per endpoint/page.

## 11) Technology stack mismatches vs required stack
- Core stack alignment is mostly correct:
  - Next.js + Tailwind (web), Express + Prisma + PostgreSQL (API), React Native Expo (mobile), Supabase storage/auth integration present.
- Gaps:
  - Redis/Bull integration is placeholder/null connection in code (`lib/redis.ts`, `lib/bull-connection.ts`) rather than active queue backend.
  - Notification retry uses in-process fallback rather than queue-backed Bull worker.

## 12) AWS-dependent implementations to align to Supabase
- Storage paths still use legacy naming (`s3Key`) in DB/DTOs, but implementation uses Supabase storage service (`supabaseStorage.ts`).
- No direct AWS S3 SDK dependency observed for document upload/download in current route paths.
- Recommendation: keep field name for backward compatibility, but document that `s3Key` now points to Supabase object path.

## 13) Missing integration points for required services
- Firebase push pipeline exists for notification dispatch and token management.
- Supabase auth/storage integration exists.
- Redis/Bull operational queue wiring is incomplete/placeholder.
- Razorpay/PayU order endpoints are currently placeholder-style (not full provider signature/verification flow).

---

## Verification Table

| Feature | Required access | Current access in code | Status | Files involved | Fix required |
|---|---|---|---|---|---|
| Create/Manage Users | SA yes, Admin partial, DM/FE no | SA/Admin only; Admin restricted to MANAGER/EXECUTIVE | Correct | `apps/api/src/routes/users.ts` | No |
| Configure Lead Statuses | SA only | SA + Admin | Partial | `apps/api/src/routes/lead-statuses.ts` | Restrict to SA-only for config endpoints |
| Configure Assignment Rules | SA only | District mapping exposed to Admin | Partial | `apps/api/src/routes/districts.ts` | Restrict mapping config endpoints to SA-only |
| View All Leads | SA/Admin yes, DM district, FE assigned | Scoped via `scopeLeadWhere` | Correct | `apps/api/src/routes/leads.ts`, `apps/api/src/services/lead-access.service.ts` | No |
| Reassign Leads | SA/Admin yes, DM district only, FE no | `PATCH /api/leads/:id` reachable by FE; DM assignee scope incomplete | Broken | `apps/api/src/routes/leads.ts` | Block FE + enforce DM district assignee constraints |
| Approve/Reject Users | SA/Admin yes | SA/Admin only | Correct | `apps/api/src/routes/users.ts` | No |
| View Reports | SA/Admin yes, DM partial, FE no | Dashboard SA/Admin/DM | Correct | `apps/api/src/routes/dashboard.ts` | No |
| Upload Documents | SA/Admin/DM/FE yes | Allowed + scoped to lead access | Correct | `apps/api/src/routes/lead-documents.ts`, `uploads.ts` | No |
| Verify UTR | SA/Admin/DM yes, FE no | Verification queue/review SA/Admin/DM | Correct | `apps/api/src/routes/payments.ts` | No |
| Manage Notifications | SA/Admin yes, DM/FE no | DM had templates/logs/render; internal trigger broad | Broken | `apps/api/src/routes/notifications.ts` | Restrict to SA/Admin management endpoints |
| FE blocked from web admin portal | Must be blocked | FE included in web admin role lists/route guards | Broken | `apps/web/src/lib/rbac.ts`, `PortalShell.tsx` | Remove FE portal access + hard guard |
| District Manager district-only data | District scope only | Mostly scoped; reassignment assignee constraints incomplete | Partial | `apps/api/src/services/lead-access.service.ts`, `apps/api/src/routes/leads.ts` | Enforce district-constrained assignee validation |
| Sensitive field masking | Mask unless allowed | Lead detail returned raw `customerDetail` sensitive fields | Broken | `apps/api/src/routes/leads.ts` | Sanitize detail response with role-based masking |
| Mobile role restrictions | FE mobile access only | Mobile accepts any role | Broken | `apps/mobile/src/store/auth-store.ts` | Enforce FE-only login/bootstrap |
| Public customer flow isolation | Public submit only | Public routes separated under `/public`; no admin exposure seen | Correct | `apps/api/src/routes/public.ts` | No |

---

## Files inspected (primary)
- API:
  - `apps/api/prisma/schema.prisma`
  - `apps/api/src/middleware/{auth.ts,rbac.ts}`
  - `apps/api/src/services/lead-access.service.ts`
  - `apps/api/src/routes/{auth.ts,users.ts,dashboard.ts,leads.ts,lead-statuses.ts,districts.ts,documents.ts,lead-documents.ts,payments.ts,uploads.ts,notifications.ts,public.ts}`
  - `apps/api/src/services/{notification.service.ts,lead-assignment.service.ts,lead-status.service.ts,public-lead-submission.service.ts}`
  - `apps/api/src/services/storage/supabaseStorage.ts`
  - `apps/api/src/lib/{supabase.ts,redis.ts,bull-connection.ts}`
- Web:
  - `apps/web/src/lib/{auth-store.ts,rbac.ts}`
  - `apps/web/src/components/{LoginForm.tsx,admin/PortalShell.tsx}`
  - `apps/web/src/app/(portal)/**` (dashboard, leads list/detail, users, districts, workflow, notifications, documents-review, payments-verification)
- Mobile:
  - `apps/mobile/src/{App.tsx,services/api.ts,store/auth-store.ts}`
  - `apps/mobile/src/screens/{LoginScreen.tsx,LeadListScreen.tsx,LeadDetailScreen.tsx,CustomerDetailsScreen.tsx,NotificationsScreen.tsx}`
