# Mobile Audit: Sections 6.1, 6.2, 6.3

## 1) Current mobile authentication implementation found in code
- Mobile login uses `email + password` against shared backend endpoint `POST /api/auth/login`.
- Auth state is managed in Zustand (`useAuthStore`) with bootstrap flow:
  - `GET /api/auth/me`
  - fallback refresh via `POST /api/auth/refresh`
- Session handling is cookie-based through Axios (`withCredentials: true`) and automatic refresh retry interceptor.
- Mobile role gate exists:
  - app-side guard allows only `FIELD_EXECUTIVE`.
  - non-field roles are force-logged-out with a clear message.
- Biometric secondary unlock is implemented with `expo-local-authentication`:
  - prompted after first successful login (if available/enrolled),
  - lock/unlock flow implemented (`BiometricUnlockScreen`).
- Suspended/deactivated account handling exists in backend and mobile:
  - backend returns `ACCOUNT_PENDING | ACCOUNT_SUSPENDED | ACCOUNT_DEACTIVATED`
  - mobile interceptor/store clears session and persists informative notice.

## 2) Current home/dashboard implementation found in code
- Home screen calls `GET /api/dashboard/mobile-summary`.
- UI shows:
  - active leads summary,
  - grouped status counts,
  - urgency (overdue/normal),
  - today tasks/visits,
  - pending actions counts,
  - recent notifications.
- Includes loading/error/refresh states and periodic refresh.
- Backend `/dashboard/mobile-summary` is restricted to `FIELD_EXECUTIVE` and scoped via assigned-lead logic.

## 3) Current mobile lead management implementation found in code
- Lead list:
  - scrollable list with `name, district, status, updatedAt`.
  - status filter and date sort chips.
  - offline cache fallback.
- Lead detail:
  - customer contact + tap-to-call (`tel:`),
  - maps navigation (Google/Apple/geo URL fallback),
  - allowed next statuses from backend (`/:id/allowed-next-statuses`),
  - status transition UI with confirm dialog, note/doc prompts,
  - document upload section,
  - payment collection section,
  - internal notes section,
  - status timeline.
- Backend transition endpoint validates:
  - scoped lead access,
  - allowed workflow transitions,
  - terminal-state restrictions,
  - required note/document rules.

## 4) Which required features are already present
- Email/password login using shared backend.
- Biometric secondary unlock after initial login.
- Session bootstrap + refresh flow.
- Suspended/deactivated handling with informative message.
- Mobile dashboard summary with active leads/status/urgency/tasks/pending/recent notifications.
- Lead list with filter/sort and required row fields.
- Lead detail with call + maps + current status + allowed next statuses.
- Status update confirm + required note/document prompts in mobile UI.
- Backend workflow enforcement for required note/document and allowed transitions.
- Assigned-lead backend scoping via `scopeLeadWhere`.

## 5) Which required features are partially implemented
- “All assigned leads” list:
  - pre-fix fetched only first page (`page=1,pageSize=100`).
  - now fixed to aggregate all available pages.
- Session invalidation:
  - pre-fix revoke functions were no-op (logout/status-change revocation not executed).
  - now fixed with Supabase session revocation logic and marker handling.
- Notes visibility rule:
  - pre-fix backend allowed manager role for internal notes.
  - now fixed to admin/super-admin/executive only.
- “Today’s tasks/visits scheduled”:
  - currently derived from overdue/recent updates/status naming, not a dedicated visit scheduler model.

## 6) Which required features are missing
- No critical missing feature remains for 6.1/6.2/6.3 after this fix pass.
- Optional gap: dedicated scheduled-visit model integration is not explicit in this module.

## 7) Which required features are broken or insecure
- **Pre-fix (Critical):** refresh-session revocation methods were no-op:
  - `revokeRefreshToken` and `revokeAllUserRefreshSessions` did nothing.
- **Pre-fix (High):** internal note visibility over-permissive (`MANAGER` included).
- **Pre-fix (High):** lead list could omit assigned leads beyond first 100.

## 8) Which backend/schema changes are required
- No schema changes required for the critical/high fixes implemented.
- Backend code changes required (implemented):
  - Supabase refresh/session revocation handling.
  - Internal-note role visibility restriction.

## 9) Which frontend/mobile UI changes are required
- Lead list data-loading logic needed full-page aggregation (implemented).
- No business-logic flow changes needed for auth/dashboard/lead-detail UI.

## 10) Which env/config changes are required
- No new environment variable is required for implemented critical/high fixes.
- Existing Supabase auth env keys must remain correctly configured.

## 11) Security and authorization issues found
- Found and fixed:
  - no-op session revocation path for logout/status changes.
  - over-broad internal notes visibility role check.
- Verified existing protections:
  - role mapping and guards,
  - assigned-lead scope enforcement in backend,
  - transition validation in backend.

## 12) Session invalidation issues found
- Found and fixed:
  - revocation functions were stubbed; now perform real Supabase-side revocation logic.
  - revocation marker is applied and cleared on fresh successful login.

## 13) Workflow/status enforcement issues found
- Backend enforces:
  - transition validity from config,
  - note-required/document-required constraints,
  - terminal-state movement restrictions.
- Mobile UI also prompts before transition and confirms action.

## 14) Priority of fixes
- **Critical**
  - Implement backend refresh/session revocation (`revokeRefreshToken`, `revokeAllUserRefreshSessions`).
- **High**
  - Restrict internal notes access to required roles.
  - Ensure lead list loads all assigned leads across paginated API.
- **Medium**
  - Replace task/visit heuristic with explicit scheduled-visit model if available.
- **Low**
  - Additional UX polish for partial page-load warning display.

---

## Verification table

| Feature | Required behavior | Current implementation | Status (Correct / Partial / Missing / Broken) | Files involved | Fix required |
|---|---|---|---|---|---|
| Mobile login | Email/password using same backend credential system | Uses `POST /api/auth/login` and shared auth stack | Correct | `apps/mobile/src/screens/LoginScreen.tsx`, `apps/mobile/src/store/auth-store.ts`, `apps/api/src/routes/auth.ts` | No |
| Mobile role restriction | Only field executive allowed in mobile app | App-side role assertion blocks non-FE users | Correct | `apps/mobile/src/store/auth-store.ts` | No |
| Session bootstrap | Restore session on app boot with refresh fallback | `/auth/me` then `/auth/refresh` fallback | Correct | `apps/mobile/src/store/auth-store.ts`, `apps/mobile/src/services/api.ts` | No |
| Refresh retry | Auto retry 401 by refresh token | Axios interceptor refresh+replay | Correct | `apps/mobile/src/services/api.ts` | No |
| Biometric auth | Secondary fingerprint/face unlock after first login | Implemented with expo-local-authentication | Correct | `apps/mobile/src/screens/LoginScreen.tsx`, `apps/mobile/src/screens/BiometricUnlockScreen.tsx`, `apps/mobile/src/store/auth-store.ts` | No |
| Suspended/deactivated handling | Block and terminate session with message | Backend returns account codes; mobile clears session and stores notice | Correct | `apps/api/src/middleware/auth.ts`, `apps/mobile/src/store/auth-store.ts`, `apps/mobile/src/services/api.ts` | No |
| Revocation on logout | Revoke session token on logout | Implemented (was no-op pre-fix) | Correct | `apps/api/src/services/supabase-auth.service.ts`, `apps/api/src/routes/auth.ts` | Implemented |
| Revocation on suspend/deactivate | Invalidate existing refresh sessions | Implemented with Supabase logout flow + revocation marker (was no-op pre-fix) | Correct | `apps/api/src/services/supabase-auth.service.ts`, `apps/api/src/routes/users.ts` | Implemented |
| Home summary endpoint access | FE-only endpoint with scoped data | `allowRoles("FIELD_EXECUTIVE")` + `scopeLeadWhere` | Correct | `apps/api/src/routes/dashboard.ts`, `apps/api/src/services/lead-access.service.ts` | No |
| Active leads summary | Show active lead totals and grouped status | Implemented in backend + rendered in home cards | Correct | `apps/api/src/routes/dashboard.ts`, `apps/mobile/src/screens/HomeScreen.tsx` | No |
| Today tasks/visits | Show today tasks/visits | Implemented via overdue/recent/status heuristic | Partial | `apps/api/src/routes/dashboard.ts`, `apps/mobile/src/screens/HomeScreen.tsx` | Optional model-based enhancement |
| Pending actions | Docs/payments/forms counts | Implemented and shown | Correct | `apps/api/src/routes/dashboard.ts`, `apps/mobile/src/screens/HomeScreen.tsx` | No |
| Recent notifications | Show recent system notifications | Implemented from `notification_logs` recipient entries | Correct | `apps/api/src/routes/dashboard.ts`, `apps/mobile/src/screens/HomeScreen.tsx` | No |
| Assigned lead list | Scrollable list of assigned leads | Implemented UI; now aggregates all pages | Correct | `apps/mobile/src/screens/LeadListScreen.tsx`, `apps/api/src/routes/leads.ts` | Implemented |
| Lead list row data | Name/district/status/updated date | Implemented | Correct | `apps/mobile/src/screens/LeadListScreen.tsx` | No |
| Lead filtering | Filter by status | Implemented | Correct | `apps/mobile/src/screens/LeadListScreen.tsx` | No |
| Lead sorting | Sort by updated date | Implemented (newest/oldest) | Correct | `apps/mobile/src/screens/LeadListScreen.tsx` | No |
| Lead detail fetch scope | Only assigned/scoped lead accessible | Scoped by `scopeLeadWhere` | Correct | `apps/api/src/routes/leads.ts`, `apps/api/src/services/lead-access.service.ts` | No |
| Tap-to-call | Contact action from lead detail | Implemented via `tel:` URL | Correct | `apps/mobile/src/screens/LeadDetailScreen.tsx` | No |
| Maps navigation | Open navigation from customer address | Implemented for iOS/Android URL schemes | Correct | `apps/mobile/src/screens/LeadDetailScreen.tsx` | No |
| Allowed next statuses | Show backend-configured next statuses only | `/:id/allowed-next-statuses` implemented and consumed | Correct | `apps/api/src/routes/leads.ts`, `apps/mobile/src/screens/LeadDetailScreen.tsx` | No |
| Status update confirm | Confirm before status update | Alert confirmation implemented | Correct | `apps/mobile/src/screens/LeadDetailScreen.tsx` | No |
| Note-required prompt | Prompt + enforce required notes | UI prompt + backend enforcement | Correct | `apps/mobile/src/screens/LeadDetailScreen.tsx`, `apps/api/src/routes/leads.ts` | No |
| Document-required prompt | Prompt + enforce required documents | UI prompt + backend enforcement | Correct | `apps/mobile/src/screens/LeadDetailScreen.tsx`, `apps/api/src/routes/leads.ts` | No |
| Notes visibility | Internal notes visible only executive + admin | Pre-fix manager also allowed; now restricted | Correct | `apps/api/src/routes/leads.ts` | Implemented |
| Internal notes storage | Persist internal notes with auditability | Stored via audit log action and returned via notes endpoint | Correct | `apps/api/src/routes/leads.ts`, `apps/api/src/services/audit-log.service.ts` | No |
| Lead detail sections | Document upload + payment collection sections present | Implemented in lead detail screen | Correct | `apps/mobile/src/screens/LeadDetailScreen.tsx` | No |

