# User And Geography Audit (Sections 5.5 and 5.7)

## 1) Current User Management Implementation
- Backend routes exist at `apps/api/src/routes/users.ts`.
- Access is RBAC-protected (`SUPER_ADMIN`, `ADMIN` only).
- User list supports pagination (`page`, `pageSize`, default `10`), search, and filters (`role`, `status`, `districtId`).
- User creation supports:
  - `fullName`, `email`, `role`, `districtIds`, `phone`, `employeeId`
  - default status `PENDING`
  - setup token generation and secure setup link email (`user_setup_password_tokens` with hash + expiry)
  - audit logging
- User edit supports details, role, district assignments, role-change warnings, and audit logging.
- Status actions exist (`approve`, `suspend`, `deactivate`) with backend checks and audit logging.
- Current user detail endpoint returns basic user + workload counts (active executive/manager leads).

## 2) Current District/Geography Management Implementation
- Backend routes exist at `apps/api/src/routes/districts.ts`.
- District CRUD exists:
  - list
  - create
  - edit (including `isActive` deactivation path)
  - delete (blocked if leads exist)
- District mappings exist:
  - manager mapping
  - executive mapping
  - many-to-many via `user_district_assignments`
- Frontend page exists at `apps/web/src/app/(portal)/districts/page.tsx` with:
  - district table
  - create/edit/delete actions
  - multi-select manager/executive mapping save flow

## 3) Already Correct
- Paginated user list with default page size `10`
- User search/filter support (role, status, district)
- User create form fields include required set (employeeId optional)
- Secure setup-password token flow and expiry storage
- User status lifecycle endpoints (approve/suspend/deactivate)
- RBAC for user and district management routes
- District master list and mapping interfaces (manager/executive)
- Executive can be mapped to multiple districts (schema supports many-to-many)
- Auditing is present for core user/district actions

## 4) Partial
- Role downgrade warning exists, but explicit downgrade confirmation was not enforced on backend.
- Approve/suspend/deactivate had action flows, but frontend confirmation UX was minimal (`prompt` only, inconsistent explicit confirmation).
- Field executive profile existed only as basic workload counts, not full required profile section.
- District manager prerequisite for auto-assignment was implicit/partial, not strictly enforced as a rule.

## 5) Missing / Broken / Insecure
- **Critical:** Deactivation safety was incomplete: backend allowed deactivation even if active leads were still assigned to that user.
- **High:** No dedicated field-executive profile payload with:
  - all assigned leads
  - completion rate
  - token collection summary
  - document submission summary
- **High:** District mapping allowed zero managers, while business rule requires manager presence before auto-assignment readiness.
- **High:** Explicit role-downgrade confirmation was not enforced at backend contract level.

## 6) Backend/Schema Changes Required
- No schema migration required for this scope.
- Backend route/service updates required:
  - enforce downgrade confirmation in user update API
  - block deactivation when active assignments exist
  - include executive profile metrics/list in user detail API
  - enforce at least one district manager in active district mapping workflow
  - enforce manager prerequisite in auto-assignment resolution path

## 7) Frontend/UI Changes Required
- Add explicit confirmation dialogs for approve/suspend/deactivate actions.
- Add downgrade confirmation flow in user edit page before save.
- Show backend assignment-impact message when deactivation is blocked.
- Add field executive profile section to user detail:
  - assigned leads table
  - active/completed/completion-rate metrics
  - token collection stats
  - document submission stats

## 8) Env/Config Changes Required
- No new env vars required for these fixes.

## 9) Security/Authorization Issues Found
- Backend RBAC is present and mostly correct.
- Main safety issue was deactivation without reassignment safeguard (now treated as Critical).

## 10) Deactivation/Reassignment Safety Issues Found
- Active lead assignments were only surfaced as warnings in some flows, not enforced in deactivation endpoint.
- This can create orphaned operational ownership and broken assignment accountability.

## 11) District Mapping / Auto-assignment Dependency Issues Found
- Manager mapping rule was not strictly enforced in configuration and assignment readiness.
- Auto-assignment behavior could proceed without explicitly ensuring district manager presence as required by policy.

## 12) Priority
- **Critical**
  - Enforce deactivation safety against active lead assignments.
- **High**
  - Enforce role-downgrade confirmation at backend level.
  - Add full field executive profile output and UI.
  - Enforce district manager prerequisite in mapping + auto-assignment path.
- **Medium**
  - Improve district/user action UX beyond prompt/confirm patterns.
- **Low**
  - Additional convenience filters/exports in user/district screens.

## Verification Table
| Feature | Required behavior | Current implementation | Status | Files involved | Fix required |
|---|---|---|---|---|---|
| User list pagination | Default page size 10, paginated | Implemented in API + UI | Correct | `apps/api/src/routes/users.ts`, `apps/web/src/app/(portal)/users/page.tsx` | No |
| User search/filter | Search + role/status/district filters | Implemented | Correct | Same as above | No |
| Create user + setup email | Create user, send setup link | Implemented (secure token hash + expiry) | Correct | `apps/api/src/routes/users.ts`, `apps/api/src/services/setup-password.service.ts`, `apps/api/src/services/email.service.ts` | No |
| Edit user role/district | Update details/role/districts | Implemented | Correct | `apps/api/src/routes/users.ts`, `apps/web/src/app/(portal)/users/[id]/page.tsx` | No |
| Role downgrade confirmation | Downgrade must warn + require confirmation | Warning existed, confirmation not enforced in API | Partial | `apps/api/src/routes/users.ts`, `apps/web/src/app/(portal)/users/[id]/page.tsx` | Yes (High) |
| Approve/suspend/deactivate confirmation | Explicit confirmations + backend enforcement | Backend status checks exist, UI confirmation inconsistent | Partial | `apps/web/src/app/(portal)/users/page.tsx`, `apps/web/src/app/(portal)/users/[id]/page.tsx` | Yes (High) |
| Deactivate with active leads | Prompt + require reassignment before deactivation | Not enforced in backend deactivation | Broken | `apps/api/src/routes/users.ts` | Yes (Critical) |
| Field executive profile | Assigned leads + active + completion + token + docs | Only basic workload counts | Missing | `apps/api/src/routes/users.ts`, `apps/web/src/app/(portal)/users/[id]/page.tsx` | Yes (High) |
| District CRUD | Add/edit/deactivate districts | Implemented | Correct | `apps/api/src/routes/districts.ts`, `apps/web/src/app/(portal)/districts/page.tsx` | No |
| District-manager mapping | Map one or more managers per district | Mapping exists, no strict manager-required rule | Partial | `apps/api/src/routes/districts.ts`, `apps/api/src/services/districts.service.ts` | Yes (High) |
| District-executive mapping | Map one or more executives, multi-district support | Implemented | Correct | `apps/api/src/routes/districts.ts`, `apps/api/src/services/districts.service.ts`, Prisma schema | No |
| Auto-assignment dependency | District must have manager before auto-assign | Not strictly enforced in assignment resolver | Partial | `apps/api/src/services/lead-assignment.service.ts`, `apps/api/src/routes/leads.ts` | Yes (High) |
