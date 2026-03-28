# SECURITY_AUDIT.md

## Scope
Audit and enforcement completed for:

- 14.1 Authentication and Authorization
- 14.2 API Security
- 14.3 Data Privacy
- 14.4 Secret Management

## 1) Current Implementation (Post-fix)

### 14.1 Authentication and Authorization
- API authentication is enforced centrally in `app.ts` for protected route groups using `requireAuth`.
- JWT session model is cookie-based (`accessToken` and `refreshToken`) with access/refresh rotation in `auth.ts`.
- Role enforcement exists through `allowRoles(...)` middleware and is applied across admin/internal routes.
- District/lead scope enforcement exists via:
  - `scopeLeadWhere(...)`
  - `assertDistrictAccessForLeadCreation(...)`
  - lead-scoped checks in chat/document/payment flows.
- Public route access is now explicitly restricted to:
  - district mapping (`GET /public/districts`, `GET /public/district-mapping`)
  - lead submission (`POST /public/leads`, `POST /public/lead-submission`)
- Other `/public/*` endpoints now require authentication.

### 14.2 API Security
- CORS is allowlist-based (no `*`) and credentials-enabled.
- `helmet()` secure headers are enabled.
- Cookie-auth CSRF origin guard added for unsafe methods (`POST/PUT/PATCH/DELETE`) to block untrusted origins.
- Lead form rate limiting updated to **5 req/min per IP**.
- Input validation is broadly enforced with Zod (`validateBody/validateQuery/validateParams`).
- Error handler returns sanitized API errors and avoids stack trace leakage to clients.

### 14.3 Data Privacy
- AES-256-GCM encryption-at-rest utilities already existed and are used when writing sensitive customer fields.
- Sensitive response masking has been strengthened:
  - Aadhaar: `XXXX XXXX 1234`
  - PAN: `ABC****XYZ`
  - Bank account: `XXXX1234`
  - IFSC: masked for non-privileged roles
- Full sensitive values are exposed only to privileged roles (Super Admin/Admin).

### 14.4 Secret Management
- Runtime env schema already validates key backend secrets.
- Added production-time security assertions to fail fast if critical security env vars are missing:
  - JWT access/refresh secrets
  - customer encryption key
  - at least one allowed web origin
- Sanitized env example files to remove real-looking Firebase/reCAPTCHA values and keep placeholders only.
- `.env*` remains ignored by git except `*.env.example`.

## 2) Missing Features (Found During Audit)
- Missing security headers middleware (`helmet`) before this fix.
- No CSRF mitigation for cookie-auth unsafe methods before this fix.
- Lead submission rate limit was too permissive (`20/15m`) before this fix.
- `/public` had additional unauthenticated endpoints outside the required exceptions before this fix.
- Sensitive data masking format did not match required patterns before this fix.
- Production startup did not enforce all critical security env requirements before this fix.

## 3) Broken Implementations (Found During Audit)
- Public API exposure broader than required policy in 14.1.
- Weak anti-abuse config for lead form endpoint versus stated requirement.
- IFSC and some sensitive fields were not role-gated/masked strongly enough.

## 4) Security Risks

### Unauthorized access risks
- Extra unauthenticated public endpoints enabled data discovery paths.
- Role-sensitive data fields were not consistently minimized for non-admin roles.

### Data leakage risks
- PAN/Aadhaar/bank masks were generic and less policy-aligned.
- IFSC was returned directly to non-privileged roles.

### API exposure risks
- Missing secure headers and missing CSRF origin checks increased attack surface for browser-based cookie sessions.

### Secrets exposure risks
- Env examples contained concrete service values; now replaced with placeholders.
- Production env completeness checks for critical security secrets were incomplete; now enforced.

## 5) Feature Matrix

| Feature | Required | Current | Status | Files | Fix | Priority |
|---|---|---|---|---|---|---|
| Protected API access | Auth required except lead submission + district mapping | Enforced via app-level `requireAuth` + public route gate | Correct | `apps/api/src/app.ts`, `apps/api/src/routes/public.ts` | Added allowlisted unauthenticated gate in public router | Critical |
| RBAC enforcement | Backend role checks | `allowRoles` used across internal routes | Correct | `apps/api/src/middleware/rbac.ts`, route files | Verified and retained | Critical |
| District/assigned scope | District + assigned-lead scoping | Present in lead/chat/doc/payment queries | Correct | `apps/api/src/services/lead-access.service.ts`, route files | Verified and retained | Critical |
| Lead rate limit | 5 req/min per IP | Previously 20 per 15 min | Fixed | `apps/api/src/middleware/rate-limit.ts` | Updated window/limit/keying | High |
| CORS policy | Strict allowlist, credentials true | Allowlist + credentials true | Correct | `apps/api/src/app.ts` | Verified | High |
| Secure headers | Helmet required | Missing before | Fixed | `apps/api/src/app.ts`, `apps/api/package.json`, `pnpm-lock.yaml` | Added `helmet()` | High |
| CSRF mitigation | Protect cookie-auth unsafe methods | Missing before | Fixed | `apps/api/src/app.ts` | Added trusted-origin check for cookie-auth writes | High |
| Input validation | Zod validation | Broadly present | Correct | route files + `middleware/validate.ts` | Verified and retained | High |
| SQL injection prevention | Prisma safe query usage | Prisma ORM patterns used | Correct | route/service files | Verified and retained | High |
| Sensitive encryption | Encrypt Aadhaar/PAN/Bank at rest | Already present | Correct | `apps/api/src/services/sensitive-data.service.ts`, `routes/leads.ts` | Verified and retained | Critical |
| Sensitive masking | Required mask format + role gating | Generic mask before | Fixed | `apps/api/src/routes/leads.ts` | Added policy-specific masking + role-gated full fields | Critical |
| Secret mgmt startup checks | Fail startup if critical secrets missing | Partial before | Fixed | `apps/api/src/config/env.ts` | Added production security assertions | Critical |
| Secret values in examples | No real secrets in repo examples | Concrete values existed in examples | Fixed | `apps/api/.env.example`, `apps/web/.env.example`, `apps/mobile/.env.example` | Replaced with placeholders | Critical |

## 6) Implemented Fixes Summary

1. Added `helmet()` in API bootstrap.
2. Added CSRF trusted-origin guard for cookie-auth unsafe methods.
3. Tightened public lead rate limit to 5/min per IP.
4. Restricted `/public` unauthenticated access to required exceptions only.
5. Implemented policy-specific masking + strict role-gated full sensitive data fields.
6. Added production startup env security assertions.
7. Sanitized env examples to avoid storing concrete secret-like values.
8. Removed hardcoded personal fallback email from auth service/script defaults (`admin@example.com` placeholder now used).
9. Removed hardcoded production frontend origin from CORS allowlist; production CORS is now env-driven only.

## 7) Verification Checklist

- [x] API builds successfully (`pnpm --filter @solar/api build`)
- [x] Web builds successfully (`pnpm --filter @solar/web build`)
- [x] Public unauthenticated access limited to required exceptions in router gate
- [x] Lead form endpoint rate-limited to 5/min/IP
- [x] Secure headers enabled via `helmet`
- [x] Cookie-auth unsafe methods protected by trusted-origin CSRF guard
- [x] Sensitive fields masked per policy and full values role-gated
- [x] Production startup fails fast when critical security env vars are missing
- [x] Env example files use placeholder values for secret-like fields

## 8) Residual Notes

- Browser-cookie CSRF protection is implemented via trusted-origin enforcement; this is strong for cross-site attacks, but token-based CSRF defense could be added later as a defense-in-depth enhancement.
- Some compliance/public webhook endpoints were previously open by design; under this security policy they are now behind authentication unless explicitly whitelisted.
