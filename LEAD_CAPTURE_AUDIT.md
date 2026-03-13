# Lead Capture Landing Page Audit

Date: 2026-03-13  
Audit baseline: Pre-fix snapshot before implementation phase  
Repo: `solar_lead`  
Scope: Landing page + public lead form + public lead backend API + Prisma schema + district mapping flow

## 1. Current Landing Page Implementation Found In Code
- Route: `apps/web/src/app/page.tsx`
- Rendering: ISR (`export const revalidate = 3600`) with server-side read of `public/districts.mapping.json`
- Form component: `apps/web/src/components/PublicLeadForm.tsx`
- Validation stack: React Hook Form + Zod
- Submission: Axios POST to `/public/leads`
- Duplicate check: Axios GET `/public/leads/duplicate-check`
- Backend API: `apps/api/src/routes/public.ts` and `apps/api/src/services/public-lead-submission.service.ts`
- Data model: Prisma `Lead` model stores UTM, recaptcha score, consent flags; `District` model exists.

## 2. Required Features Already Present
- Public landing page exists and does not require auth.
- Next.js + Tailwind + RHF + Zod + Axios are in use.
- District search input is present.
- District/state mapping is locally bundled and state auto-fills without API call.
- State input is read-only.
- Backend district model exists (`District`) and public district mapping API exists.
- UTM params are captured from URL and sent to backend.
- UTM fields are stored in lead mirror (`Lead.utm*`) and public submission table payload.
- reCAPTCHA v3 script/token integration exists.
- Duplicate check warning is non-blocking.

## 3. Partially Implemented Features
- SEO metadata exists (title/description/keywords), but richer SEO metadata is missing.
- Success state exists, but form is not replaced; only inline success text is shown.
- Error handling exists, but UI may show backend-derived messages (not fully generic).
- Trust indicators are minimal and do not clearly include required certification/testimonial/contact framing.

## 4. Missing Features
- Clear company contact information section on landing page.
- Strong official branding section and explicit trust block (certification style indicators, installation count, testimonial content).
- Required field policy mismatch (email + monthly bill currently optional in form/API).
- Required installation type values mismatch with spec.
- Configurable minimum monthly bill not implemented as a dedicated config.

## 5. Broken / Inconsistent Features
- Validation rules do not match requirement:
  - Name is not restricted to alphabets-only.
  - Phone is not strict 10-digit Indian mobile.
  - Message max is 1000 (required 500).
  - Installation types include non-required values.
- Real-time validation mode is not explicitly configured for blur + submit.
- Duplicate logic checks all leads/submissions by phone instead of active leads only.

## 6. Backend / Data Model Changes Required
- Tighten `/public/leads` schema validation to required constraints:
  - `name` alpha-only and min length.
  - `phone` strict 10-digit Indian format.
  - `email` required valid format.
  - `monthlyBill` required positive integer with configurable min.
  - `districtId`, `state`, `installationType`, `consentGiven` required.
  - `message` max 500.
- Restrict installation type to enum-like allowlist:
  - Residential, Industrial, Agricultural, Other
- Update duplicate check to count only active leads (`Lead.currentStatus.isTerminal = false`).

## 7. Frontend / UI Changes Required
- Update `PublicLeadForm` schema and defaults to align with required fields and values.
- Configure RHF validation mode for blur and submit behavior.
- Replace form with success message after successful submit.
- Show generic submit failure message only.
- Add required landing page sections:
  - service types
  - company contact
  - branding + trust indicators

## 8. Env / Config Changes Required
- Add configurable minimum bill values:
  - API: `PUBLIC_LEAD_MIN_MONTHLY_BILL_INR`
  - Web: `NEXT_PUBLIC_MIN_MONTHLY_BILL_INR`
- Keep existing reCAPTCHA env usage; no auth required for public landing.

## 9. Performance / SEO Issues Found
- Metadata is basic; OpenGraph/Twitter/canonical metadata not defined for landing page.
- Page structure is lightweight already; no major blocking heavy assets observed.
- ISR is acceptable for SEO; still needs richer metadata for stronger compliance.

## 10. Priority Of Fixes
- Critical
  - Validation mismatch between requirements and current frontend/backend behavior.
  - Required fields currently optional (email, monthly bill).
  - Duplicate detection not aligned to active leads.
  - Success/failure UX behavior mismatch.
- High
  - Missing contact/branding/trust sections.
  - Installation type mismatch.
  - Missing configurable monthly bill minimum.
  - Metadata completeness for SEO.
- Medium
  - Mapping data quality cleanup (e.g., inconsistent state labels in bundled mapping).
- Low
  - Additional CWV tuning after functional fixes.

## Verification Table
| Feature | Required behavior | Current implementation | Status | Files involved | Fix required |
|---|---|---|---|---|---|
| Public landing route | Public standalone Next page | Route exists at `/` | Correct | `apps/web/src/app/page.tsx` | No |
| Headline/value proposition | Clear compelling headline | Present | Correct | `apps/web/src/app/page.tsx` | No |
| Installation service mention | Residential/Industrial/Agricultural visible | Not explicitly aligned in content | Partial | `apps/web/src/app/page.tsx` | Yes |
| Lead form prominence | Prominent lead form | Present (right-column card) | Correct | `apps/web/src/app/page.tsx`, `PublicLeadForm.tsx` | No |
| Company contact info | Visible contact details | Not present | Missing | `apps/web/src/app/page.tsx` | Yes |
| Official branding | Clear brand section | Minimal | Partial | `apps/web/src/app/page.tsx`, `layout.tsx` | Yes |
| Trust indicators | Certification/install count/testimonials | Minimal | Partial | `apps/web/src/app/page.tsx` | Yes |
| Full Name validation | min 2, alphabets only | min 2 but no alpha-only regex | Partial | `apps/web/src/lib/landing.ts`, `apps/api/src/routes/public.ts` | Yes |
| Phone validation | 10-digit Indian mobile | 8-20 broad phone regex | Broken | `apps/web/src/lib/landing.ts`, `apps/api/src/routes/public.ts` | Yes |
| Email required | Required valid email | Optional | Broken | `apps/web/src/lib/landing.ts`, `apps/api/src/routes/public.ts` | Yes |
| Monthly bill required | Required positive integer + configurable min | Optional number/decimal | Broken | `apps/web/src/lib/landing.ts`, `apps/api/src/routes/public.ts`, `env` | Yes |
| District selection | Searchable dropdown from predefined list | Implemented | Correct | `PublicLeadForm.tsx`, `landing.ts` | No |
| State read-only | Auto-populated from district | Implemented local mapping | Correct | `PublicLeadForm.tsx` | No |
| Installation type values | Residential/Industrial/Agricultural/Other | Wider custom list | Broken | `landing.ts`, `PublicLeadForm.tsx`, `public.ts` | Yes |
| Message validation | Optional max 500 | Optional max 1000 | Broken | `landing.ts`, `public.ts` | Yes |
| Consent required | Must be checked | Implemented | Correct | `landing.ts`, `PublicLeadForm.tsx`, `public.ts` | No |
| Validation timing | On blur + submit | Submit-focused defaults | Partial | `PublicLeadForm.tsx` | Yes |
| Duplicate check behavior | Soft warning for active lead dupes only | Soft warning exists, but count scope too broad | Partial | `public.ts`, `public-lead-submission.service.ts` | Yes |
| Success behavior | Replace form with success block | Inline message only | Partial | `PublicLeadForm.tsx` | Yes |
| Failure behavior | Generic error only | Can surface backend-derived messages | Partial | `PublicLeadForm.tsx`, `lib/api.ts` | Yes |
| reCAPTCHA v3 | Protected form | Implemented | Correct | `PublicLeadForm.tsx`, `public.ts`, `recaptcha.service.ts` | No |
| UTM capture/store | Capture URL params and persist | Implemented | Correct | `PublicLeadForm.tsx`, `public.ts`, `public-lead-submission.service.ts`, `schema.prisma` | No |
| SEO metadata | SEO optimized metadata | Basic only | Partial | `apps/web/src/app/page.tsx`, `layout.tsx` | Yes |
| /health/deps prisma truth | Reflect real prisma connectivity | Implemented | Correct | `apps/api/src/routes/health.ts`, `apps/api/src/lib/prisma.ts` | No |
