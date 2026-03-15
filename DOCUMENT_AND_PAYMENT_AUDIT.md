# Document & Payment Audit (Sections 5.8 and 5.9)

## 1) Current document review implementation found in code
- Dedicated admin page exists: `apps/web/src/app/(portal)/documents-review/page.tsx`
- Backend review queue endpoint exists: `GET /api/documents/review` in `apps/api/src/routes/documents.ts`
- In-browser preview + secure download URL flow exists via signed URLs:
  - `GET /api/documents/:id/download-url` (`apps/api/src/routes/documents.ts`)
  - signed URL generation in `apps/api/src/services/storage/supabaseStorage.ts`
- Verify/reject review action exists:
  - `POST /api/documents/:id/review` (`apps/api/src/routes/documents.ts`)
- Lead-document upload completion flow exists:
  - `POST /api/leads/:leadId/documents/presign`
  - `POST /api/leads/:leadId/documents/complete`
  - in `apps/api/src/routes/lead-documents.ts`

## 2) Current payment verification implementation found in code
- Dedicated queue page exists: `apps/web/src/app/(portal)/payments-verification/page.tsx`
- Queue endpoint exists: `GET /api/payments/verification-queue` (`apps/api/src/routes/payments.ts`)
- Verify/reject endpoint exists: `POST /api/payments/:id/review` (`apps/api/src/routes/payments.ts`)
- Verification can transition lead to configured `Token Payment Verified` status using workflow checks.
- Rejection triggers internal notification to assigned executive.

## 3) Required features already present
- Dedicated document review section/page
- Dedicated payment verification queue section/page
- Signed URL-based document access (no public raw bucket URL exposed)
- Document verify action persists status/reviewer/time
- Re-upload rejection reason persisted in document review notes
- Payment queue pagination/filtering/search exists
- Payment verify/reject actions are auditable
- Payment review stores actor and timestamp
- Lead workflow integration on payment verify exists

## 4) Required features partially implemented (before fixes)
- Document re-upload flow existed as generic reject action (semantics not explicit as “request re-upload”)
- Per-document note capability existed only as part of review action, not as dedicated note action
- District Manager scoping used shared lead scope logic; not strict district-only enforcement for document/payment review actions
- Payment queue row did not clearly show field executive/submitting executive in the table

## 5) Required features missing (before fixes)
- Explicit “request re-upload” action naming in API/UI
- Dedicated per-document note save action endpoint

## 6) Required features broken or insecure (before fixes)
- District Manager could access review actions via broader manager scope logic (not strictly district mapping only) in document/payment review paths.

## 7) Backend/schema changes required
- No Prisma schema migration required for critical/high fixes.
- Backend route updates required:
  - `apps/api/src/routes/documents.ts`
  - `apps/api/src/routes/payments.ts`
- Added strict district-manager scoping logic in document/payment review paths.
- Added dedicated document note endpoint.

## 8) Frontend/UI changes required
- `apps/web/src/app/(portal)/documents-review/page.tsx`
  - Add explicit “Request Re-upload”
  - Add “Save Note” action for per-document notes
- `apps/web/src/app/(portal)/payments-verification/page.tsx`
  - Show field executive in queue rows
  - Align note requirements with backend review validation

## 9) Env/config changes required
- No new environment variables required for these fixes.
- Existing required envs remain:
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - existing auth/db vars already in `apps/api/src/config/env.ts`.

## 10) Security and authorization issues found
- District manager review scope needed stricter district-only checks for:
  - document queue/action/download
  - payment queue/action
- Fixed in backend route logic by enforcing district assignment checks for `MANAGER`.

## 11) Storage/file access issues found
- Signed URLs are already used and generated server-side.
- Access checks are enforced before generating signed URLs.
- No public unrestricted storage URL exposure found in reviewed code paths.

## 12) Workflow/status transition issues found
- Payment verify transition correctly checks workflow transition validity before moving to `Token Payment Verified`.
- If workflow config misses that transition, verify action fails by design (consistent with configured workflow engine).

## 13) Notification trigger issues found
- Document rejection/re-upload and payment rejection notifications exist.
- Improvement applied: payment rejection now includes reason text in notification body.

## 14) Priority of fixes
- Critical:
  - Enforce strict district scope for District Manager on document/payment review actions.
- High:
  - Add explicit request re-upload flow semantics.
  - Add dedicated per-document note action.
  - Show field executive in payment verification queue rows.
- Medium:
  - Stronger document category standardization (currently free-form category).
- Low:
  - Additional category grouping UX enhancements in document review page.

## Verification Table
| Feature | Required behavior | Current implementation | Status | Files involved | Fix required |
|---|---|---|---|---|---|
| Document review page | Dedicated review section | Present | Correct | `apps/web/src/app/(portal)/documents-review/page.tsx` | No |
| Document preview | PDF/JPEG/PNG in-browser | Signed URL + iframe/image preview | Correct | `apps/web/src/app/(portal)/documents-review/page.tsx`, `apps/api/src/routes/documents.ts`, `apps/api/src/services/storage/supabaseStorage.ts` | No |
| Document download | Secure download for authorized roles | Signed URL with access checks | Correct | `apps/api/src/routes/documents.ts` | No |
| Document verify | Mark document verified and persist | Implemented | Correct | `apps/api/src/routes/documents.ts` | No |
| Re-upload request | Explicit request re-upload with reason | Previously reject-only semantics; now explicit `request_reupload` action | Correct | `apps/api/src/routes/documents.ts`, `apps/web/src/app/(portal)/documents-review/page.tsx` | Done |
| Per-document notes | Add note per document | Previously only review notes through review action; now dedicated notes endpoint + UI action | Correct | `apps/api/src/routes/documents.ts`, `apps/web/src/app/(portal)/documents-review/page.tsx` | Done |
| Document category visibility | Categorized by type | Category column/filter exists | Partial | `apps/web/src/app/(portal)/documents-review/page.tsx` | Medium |
| Document RBAC/scoping | Admin/DM scoped access | RBAC present; DM scope hardened to district mapping | Correct | `apps/api/src/routes/documents.ts`, `apps/api/src/services/lead-access.service.ts` | Done |
| Payment queue page | Dedicated UTR verification queue | Present | Correct | `apps/web/src/app/(portal)/payments-verification/page.tsx` | No |
| Queue row fields | Lead ID, customer, amount, UTR, submitted time, field executive | Field executive was not clearly shown in row; now added | Correct | `apps/web/src/app/(portal)/payments-verification/page.tsx` | Done |
| Payment verify/reject | Admin/DM can verify/reject with note | Implemented; note validation tightened | Correct | `apps/api/src/routes/payments.ts`, `apps/web/src/app/(portal)/payments-verification/page.tsx` | Done |
| Payment verify transition | Auto transition to Token Payment Verified | Implemented with workflow validation | Correct | `apps/api/src/routes/payments.ts`, `apps/api/src/services/lead-status.service.ts` | No |
| Payment rejection notification | Notify field executive to retry | Implemented; reason included in message now | Correct | `apps/api/src/routes/payments.ts`, `apps/api/src/services/notification.service.ts` | Done |
| Payment audit trail | Actor/timestamp/note auditable | Implemented | Correct | `apps/api/src/routes/payments.ts`, `apps/api/prisma/schema.prisma` | No |
| DM district scope for payment | DM limited to own district scope | Hardened with district assignment scope | Correct | `apps/api/src/routes/payments.ts` | Done |

## Critical/High fixes implemented in this pass
- `apps/api/src/routes/documents.ts`
  - Added `request_reupload` review action with required reason.
  - Added `POST /api/documents/:id/notes` to save per-document notes.
  - Added strict district-scoped checks for District Manager in queue/review/download paths.
- `apps/api/src/routes/payments.ts`
  - Added strict district-scoped checks for District Manager in queue/review paths.
  - Tightened review note validation.
  - Included rejection reason in executive notification text.
- `apps/web/src/app/(portal)/documents-review/page.tsx`
  - Added explicit “Request Re-upload” action.
  - Added “Save Note” action.
- `apps/web/src/app/(portal)/payments-verification/page.tsx`
  - Added field executive column in queue rows.
  - Updated note validation UX alignment.
