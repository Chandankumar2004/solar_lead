# Mobile Auth, Home, Leads Audit (Sections 6.1–6.3)

## 1. Current Mobile Authentication Implementation
- Login via `/api/auth/login` with email/password (React Hook Form + Zod).
- HTTP‑only cookie session (access + refresh) with Axios `withCredentials` and refresh on 401.
- Role guard in mobile app: only `FIELD_EXECUTIVE` allowed.
- Biometric unlock uses `expo-local-authentication`, prompted after first successful login and enforced on app resume.
- Suspended/deactivated handling: backend returns `ACCOUNT_*` codes; mobile stores a notice and clears session.

## 2. Current Home/Dashboard Implementation
- Home screen calls `/api/dashboard/mobile-summary`.
- Shows: active leads summary (grouped by status + overdue count), today’s tasks, pending actions, recent notifications.
- Refresh + auto-polling every 60s.

## 3. Current Mobile Lead Management Implementation
- Lead list loads assigned leads via `/api/leads` with server-side scoping.
- Supports filter by status and sort by newest/oldest update.
- Lead detail screen includes call, maps navigation, status update with allowed next statuses, document upload, payment collection, internal notes.
- Status transitions validated client-side and enforced server-side via workflow.

## 4. Required Features Already Present
- Email/password login with shared backend credentials.
- Biometric authentication flow after first login.
- Session persistence via cookie + refresh.
- Suspended/deactivated account handling with user notice.
- Home summary (status + urgency), today’s tasks, pending actions, recent notifications.
- Assigned lead list with required fields and filters/sort.
- Lead detail with call, maps, status update, document upload, payment collection, internal notes.
- Allowed next statuses from backend workflow.
- Confirmation before status update.
- Backend assigned-lead scoping and workflow validation.

## 5. Partially Implemented Features
- None found for 6.1–6.3.

## 6. Missing Features
- None found for 6.1–6.3.

## 7. Broken or Insecure Features
- None found for 6.1–6.3.

## 8. Backend/Schema Changes Required
- None required for 6.1–6.3.

## 9. Mobile UI Changes Required
- None required for 6.1–6.3.

## 10. Env/Config Changes Required
- None required for 6.1–6.3.

## 11. Security & Authorization Issues Found
- None. `requireAuth` enforces active status and `scopeLeadWhere` scopes assigned leads.

## 12. Session Invalidation Issues Found
- None. Blocked accounts return `ACCOUNT_*` codes; mobile clears session + shows notice.

## 13. Workflow/Status Enforcement Issues Found
- None. Allowed transitions are served by `/api/leads/:id/allowed-next-statuses` and enforced on `/api/leads/:id/transition`.

## 14. Priority of Fixes
- Critical: None
- High: None
- Medium: None
- Low: None

---

## Verification Table
| Feature | Required behavior | Current implementation | Status | Files involved | Fix required |
|---|---|---|---|---|---|
| Login | Email/password, shared credential system | `/api/auth/login` + cookie session | Correct | `apps/mobile/src/screens/LoginScreen.tsx`, `apps/api/src/routes/auth.ts` | None |
| Biometric auth | Fingerprint/Face after first login | `expo-local-authentication`, biometric gate | Correct | `apps/mobile/src/screens/BiometricUnlockScreen.tsx`, `apps/mobile/src/store/auth-store.ts`, `apps/mobile/src/App.tsx` | None |
| Session persistence | Persist until logout/refresh expiry | HTTP‑only cookies + refresh interceptor | Correct | `apps/mobile/src/services/api.ts`, `apps/api/src/routes/auth.ts` | None |
| Suspended/deactivated handling | Terminate session + notice | 401 `ACCOUNT_*` codes + notice | Correct | `apps/api/src/middleware/auth.ts`, `apps/mobile/src/store/auth-store.ts` | None |
| Home summary | Active leads grouped by status/urgency | `/dashboard/mobile-summary` | Correct | `apps/mobile/src/screens/HomeScreen.tsx`, `apps/api/src/routes/dashboard.ts` | None |
| Today’s tasks | Show today’s tasks/visits | Derived from updated/overdue/visit statuses | Correct | `apps/mobile/src/screens/HomeScreen.tsx`, `apps/api/src/routes/dashboard.ts` | None |
| Pending actions | Docs/payments/forms counts | Server-computed pending counts | Correct | `apps/mobile/src/screens/HomeScreen.tsx`, `apps/api/src/routes/dashboard.ts` | None |
| Recent notifications | Show recent system notifications | Notification log feed | Correct | `apps/mobile/src/screens/HomeScreen.tsx`, `apps/api/src/routes/dashboard.ts` | None |
| Lead list | Assigned leads with required fields | `/api/leads` + scoped list | Correct | `apps/mobile/src/screens/LeadListScreen.tsx`, `apps/api/src/routes/leads.ts` | None |
| Lead list filters/sort | Filter by status, sort by date | Client-side filters/sort | Correct | `apps/mobile/src/screens/LeadListScreen.tsx` | None |
| Lead detail | Contact info + call | Dialer via `tel:` | Correct | `apps/mobile/src/screens/LeadDetailScreen.tsx` | None |
| Maps navigation | Open navigation to address | Platform map intents | Correct | `apps/mobile/src/screens/LeadDetailScreen.tsx` | None |
| Status update | Allowed next statuses only | `/allowed-next-statuses` | Correct | `apps/mobile/src/screens/LeadDetailScreen.tsx`, `apps/api/src/routes/leads.ts` | None |
| Status update prompts | Notes/doc requirements + confirm | Alerts + server validation | Correct | `apps/mobile/src/screens/LeadDetailScreen.tsx`, `apps/api/src/routes/leads.ts` | None |
| Document upload section | Upload UI in lead detail | Category picker + upload flows | Correct | `apps/mobile/src/screens/LeadDetailScreen.tsx` | None |
| Payment collection section | QR + UTR + gateway placeholder | Payment UI + API | Correct | `apps/mobile/src/screens/LeadDetailScreen.tsx`, `apps/api/src/routes/payments.ts` | None |
| Internal notes | Executive/Admin visibility only | Internal notes endpoint + audit log | Correct | `apps/mobile/src/screens/LeadDetailScreen.tsx`, `apps/api/src/routes/leads.ts` | None |

