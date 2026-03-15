# Web Admin Auth + Dashboard Audit

## Scope
- Audited modules only:
  - `5.1 Authentication`
  - `5.2 Dashboard`

## 1. Current Authentication Implementation
- Backend auth endpoints exist in `apps/api/src/routes/auth.ts`:
  - `POST /auth/login`
  - `POST /auth/refresh`
  - `POST /auth/logout`
  - `GET /auth/me`
  - `POST /auth/change-password`
- Backend sets `httpOnly` cookies for access/refresh tokens (15m / 7d).
- Backend enforces account status at login (`PENDING` and `SUSPENDED` blocked) and in `requireAuth` (`ACTIVE` only).
- User management is admin-only (`apps/api/src/routes/users.ts`) and creates new users in `PENDING`.
- Audit logs for auth and user actions are written via `apps/api/src/services/audit-log.service.ts`.
- Frontend login currently uses Supabase browser auth directly (`apps/web/src/components/LoginForm.tsx`) and sends Bearer token from JS (`apps/web/src/lib/api.ts`) instead of relying on backend cookie session.

## 2. Current Dashboard Implementation
- Dashboard API exists in `apps/api/src/routes/dashboard.ts`.
- Dashboard UI exists in `apps/web/src/app/(portal)/dashboard/page.tsx` + `apps/web/src/components/DashboardCharts.tsx`.
- Implemented:
  - totals (today/week/month)
  - leads by status
  - leads by district
  - leads by installation type
  - pending verifications
  - field executive summary (partial metrics)
  - filters (date range, district, executive)
  - auto-refresh (60s) and manual refresh
  - role gating + lead scoping for dashboard endpoint.

## 3. Required Features Already Present
- Email/password login route exists.
- No self-registration route exists.
- User creation restricted to `SUPER_ADMIN`/`ADMIN`.
- Pending approval default for newly created users.
- Suspended users blocked from login.
- JWT-like token session flow through backend + cookie support exists.
- Access/refresh expiry values implemented as required.
- Audit logging for login success/failure and user actions exists.
- Dashboard default route and major core widgets exist.
- Dashboard filtering + refresh behavior exists.

## 4. Partially Implemented
- Session management:
  - Backend cookie flow exists, but frontend bypasses it with Supabase browser tokens.
- Account lifecycle:
  - `deactivate` action exists but maps to `SUSPENDED`; distinct `DEACTIVATED` status missing.
- Password policy:
  - Length checks exist, but required complexity rules are not fully enforced.
- Dashboard field executive performance:
  - Shows assigned/active/terminal/pending docs/payments, but required `visits completed` and `token amount collected` are missing.

## 5. Missing
- One-time setup-password invite flow for newly created users.
- MFA (email OTP) configurable flow for admin roles.
- Dashboard recent activity feed.
- Dashboard loan application pipeline summary.

## 6. Broken / Insecure
- Frontend auth path (`apps/web/src/components/LoginForm.tsx`, `apps/web/src/lib/api.ts`, `apps/web/src/app/login/page.tsx`) stores/uses auth token in browser JS flow instead of backend cookie-only flow for admin portal.

## 7. Backend / Schema Changes Required
- Add distinct `DEACTIVATED` user status handling end-to-end.
- Enforce password complexity server-side for create/change/setup password flows.
- Add secure one-time setup token storage and consumption.
- Add dashboard query outputs:
  - recent activity
  - loan pipeline
  - visits completed
  - token amount collected

## 8. Frontend / UI Changes Required
- Login page must authenticate through backend `/api/auth/login` and cookie session only.
- Remove Supabase browser-token auth dependency from admin portal auth flow.
- Add setup-password page/flow.
- Extend dashboard UI with:
  - recent activity feed
  - loan pipeline cards
  - updated executive metrics table.

## 9. Env / Config Changes Required
- Add setup-password URL env(s) used in invite mail generation.
- Keep existing auth cookie names/origin settings.
- Keep dashboard refresh interval configurable (already defaults to 60s).

## 10. Security Issues Found
- Admin web auth currently depends on JS-managed bearer token path (higher XSS exposure than cookie-only model).
- Password policy lacks required complexity checks.

## 11. Role / Scoping Issues Found
- Dashboard scoping is mostly correct, but new widgets must use same scoped `LeadWhere` constraints.
- User deactivation semantics are ambiguous because it currently aliases to suspension.

## 12. Priority
- Critical:
  - Switch admin frontend auth to backend cookie session flow.
  - Remove JS bearer-token dependency from admin auth flow.
- High:
  - Implement one-time setup-password invite flow.
  - Enforce full password complexity policy backend + portal forms.
  - Add distinct `DEACTIVATED` status handling.
  - Add dashboard recent activity + loan pipeline + required executive metrics.
- Medium:
  - MFA email OTP configurable flow.
- Low:
  - Additional UX polish and richer chart interactions.

## Verification Table
| Feature | Required behavior | Current implementation | Status | Files involved | Fix required |
|---|---|---|---|---|---|
| Login mechanism | Email/password only, no social | Backend supports email/password; frontend uses Supabase browser sign-in | Partial | `apps/api/src/routes/auth.ts`, `apps/web/src/components/LoginForm.tsx` | Use backend login endpoint from web |
| Session storage | JWT in HTTP-only cookies | Backend sets cookies; frontend uses JS bearer tokens | Broken | `apps/api/src/routes/auth.ts`, `apps/web/src/lib/api.ts` | Remove bearer path, use cookie + refresh endpoint |
| Refresh flow | 15m access + 7d refresh | Implemented in backend | Correct | `apps/api/src/routes/auth.ts` | Keep |
| No self-registration | Only admin-created users | No register route found | Correct | `apps/api/src/routes/*` | Keep |
| Pending approval | New users pending by default | Implemented | Correct | `apps/api/src/routes/users.ts` | Keep |
| Suspend/deactivate blocking | Pending/suspended/deactivated cannot login | Pending/suspended blocked; deactivated aliased to suspended | Partial | `apps/api/src/routes/users.ts`, `apps/api/src/services/supabase-auth.service.ts`, `apps/api/prisma/schema.prisma` | Add `DEACTIVATED` status |
| Password policy | Min 8 + upper/lower/number/special | Only min length checks | Missing | `apps/api/src/routes/users.ts`, `apps/api/src/routes/auth.ts`, `packages/shared/src/schemas.ts` | Add complexity validators |
| bcrypt work factor | >=12 | 12 used | Correct | `apps/api/src/routes/users.ts`, `apps/api/src/lib/bootstrap-super-admin.ts` | Keep |
| Setup-password invite | One-time setup email | Not implemented | Missing | `apps/api/src/routes/users.ts`, `apps/api/src/services/email.service.ts`, web login routes | Add token model + setup endpoints/page |
| MFA | Configurable email OTP | Not present | Missing | auth routes/services + web login | Add configurable structure (next phase) |
| Auth audit logs | login success/failure, password changes, user actions with timestamp/ip/actor | Implemented | Correct | `apps/api/src/routes/auth.ts`, `apps/api/src/routes/users.ts`, `apps/api/src/services/audit-log.service.ts` | Keep |
| Dashboard totals | today/week/month | Implemented | Correct | `apps/api/src/routes/dashboard.ts`, dashboard page | Keep |
| Leads by status | Visual breakdown | Implemented | Correct | dashboard route/charts | Keep |
| Leads by district | Distribution | Implemented | Correct | dashboard route/charts | Keep |
| Leads by installation type | Distribution | Implemented | Correct | dashboard route/charts | Keep |
| Exec performance | assigned, visits completed, token collected | Assigned only; no visits/token metrics | Partial | `apps/api/src/routes/dashboard.ts`, dashboard page | Add required metrics |
| Pending verifications | UTR/document pending | Implemented | Correct | dashboard route/page | Keep |
| Recent activity feed | Latest lead updates | Missing | Missing | dashboard route/page | Add widget and API payload |
| Loan pipeline summary | Pending/approved/rejected counts | Missing | Missing | dashboard route/page | Add widget and API payload |
| Filters | date, district, executive | Implemented | Correct | dashboard route/page | Keep |
| Auto/manual refresh | 60s default + manual | Implemented | Correct | dashboard page | Keep |

