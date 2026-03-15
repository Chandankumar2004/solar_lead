# Mobile Document Upload & Offline Audit (Sections 6.5 and 6.6)

## 1) Current mobile document upload implementation found in code
- Mobile upload entry points exist in:
  - `apps/mobile/src/screens/LeadDetailScreen.tsx`
  - `apps/mobile/src/screens/CustomerDetailsScreen.tsx` (site photos)
  - `apps/mobile/src/screens/LeadCreateScreen.tsx` (attachments)
- Upload transport uses signed upload URL flow:
  - Request presign: `POST /api/leads/:leadId/documents/presign`
  - Upload file bytes to signed URL
  - Complete metadata: `POST /api/leads/:leadId/documents/complete`
- Upload progress exists in `LeadDetailScreen` (`onProgress` + per-item UI state).
- Retry without re-pick exists in `LeadDetailScreen` for failed uploads.
- Offline queue exists for document uploads via `useQueueStore` and reconnect flush in `App.tsx`.

## 2) Current offline functionality implementation found in code
- Queue persistence exists in `apps/mobile/src/store/queue-store.ts` (AsyncStorage key `offline_queue`).
- Reconnect flush exists in `apps/mobile/src/App.tsx` via `NetInfo.addEventListener`.
- Offline create lead queue exists (`CREATE_LEAD_WITH_ATTACHMENTS`).
- Offline document queue exists (`UPLOAD_LEAD_DOCUMENT`).
- Customer details draft autosave/restore exists via AsyncStorage in `CustomerDetailsScreen`.

## 3) Required features already present
- Camera/file picker usage for uploads.
- Upload progress (lead detail uploads).
- Retry failed upload without reselecting file.
- Offline queue persistence across restart (for existing queue item kinds).
- Auto-sync on reconnect (existing queue kinds).
- Backend lead scoping for uploads (`scopeLeadWhere`).
- Supabase storage integration exists server-side (`supabaseStorage.ts`).

## 4) Required features partially implemented
- Supabase-only wording/assumptions:
  - Flow already uses Supabase signed URLs, but naming/messages still use `S3`/`s3Key`.
- Offline functionality:
  - Queue exists, but only for lead creation and document upload.
  - Missing queued status updates and queued customer form submissions.
- Offline viewing:
  - App can work with some in-memory data but lacks durable per-user lead/detail cache fallback.
- Queue scoping:
  - Queue currently uses one global key; not explicitly user-scoped.

## 5) Required features missing
- Global offline indicator UI.
- Queue support for:
  - status updates while offline
  - customer detail form submissions while offline
- Explicit local cache fallback for assigned leads and current lead detail data.
- Full user-scoped queue/cache isolation on account switch/logout.
- Client-side enforcement of required upload constraints:
  - formats exactly JPEG/PNG/PDF
  - max size 10 MB

## 6) Required features broken or insecure
- Upload size limit in backend currently 20 MB (requirement is 10 MB).
- Allowed MIME types include extra formats (`webp/heic/heif`) not in required set.
- Global queue key can leak pending items across user sessions on same device.

## 7) Backend/schema changes required
- Backend route validation update:
  - enforce max 10 MB in upload endpoints
  - enforce MIME set to JPEG/PNG/PDF
- Keep schema unchanged for compatibility (no destructive DB migration required).

## 8) Mobile UI changes required
- Add clear offline banner/indicator.
- Add offline-aware messages when using cached data.
- Ensure queued status/form actions provide user feedback.

## 9) Env/config changes required
- None mandatory for these fixes.
- Existing Supabase env values remain valid.

## 10) Security and authorization issues found
- Backend lead scoping is implemented.
- Client-side local queue/cache scoping by authenticated user is insufficient and needs hardening.

## 11) Storage/upload flow issues found
- Logic is Supabase-based but still semantically labeled with S3 terminology.
- Validation mismatch with product requirement (10 MB + strict file types).

## 12) Offline cache and queue issues found
- No explicit per-user cache partition for lead/detail offline reads.
- Queue does not cover status transitions and customer form submissions.

## 13) Sync/retry/idempotency issues found
- Retry exists for current queue types, but not all required mutation types.
- No dedupe key strategy for queue item replacement where latest-intent should win.

## 14) Visibility issues between mobile upload and web admin portal
- On successful sync, documents are stored in `documents` table and should be visible in admin review.
- No blocker identified in API contract for visibility after successful completion.

## 15) Priority of fixes
- Critical
  - Add offline queue support for status update and customer form submission.
  - Scope offline queue/cache by authenticated user.
  - Add offline read fallback for assigned leads/current lead data.
- High
  - Add clear offline indicator.
  - Enforce 10 MB and JPEG/PNG/PDF in mobile + backend.
  - Replace remaining S3-specific assumptions/messages in mobile upload flow (compatibly).
- Medium
  - Richer sync failure dashboard and per-item manual recovery UI for all queue kinds.
  - Full offline opening of previously downloaded binary documents.
- Low
  - Naming cleanup (`s3Key` field name) in DB schema (not required now; compatibility-sensitive).

## Verification Table
| Feature | Required behavior | Current implementation | Status | Files involved | Fix required |
|---|---|---|---|---|---|
| Upload sources | Camera + file system | Implemented | Correct | `LeadDetailScreen.tsx`, `CustomerDetailsScreen.tsx` | No |
| Upload provider | Supabase storage flow | Implemented (Supabase signed URL) but S3 naming remains | Partial | `document-upload.ts`, `lead-documents.ts`, `supabaseStorage.ts` | Yes |
| File formats | JPEG/PNG/PDF only | `image/*` and backend allows extra formats | Partial | `LeadDetailScreen.tsx`, `CustomerDetailsScreen.tsx`, `lead-documents.ts`, `uploads.ts` | Yes |
| Max file size | 10 MB | Backend 20 MB, no strict mobile precheck | Broken | `lead-documents.ts`, `uploads.ts`, `document-upload.ts` | Yes |
| Progress UI | Show upload progress | Implemented for lead detail | Correct | `LeadDetailScreen.tsx`, `document-upload.ts` | No |
| Retry upload | Retry without reselecting file | Implemented for lead detail | Correct | `LeadDetailScreen.tsx` | No |
| Offline doc upload queue | Queue + auto sync on reconnect | Implemented for lead detail; partial elsewhere | Partial | `queue-store.ts`, `LeadDetailScreen.tsx`, `App.tsx` | Yes |
| Offline status updates | Queue status updates and sync | Missing | Missing | `LeadDetailScreen.tsx`, `queue-store.ts` | Yes |
| Offline form submissions | Queue customer form submit and sync | Missing | Missing | `CustomerDetailsScreen.tsx`, `queue-store.ts` | Yes |
| Offline lead reads | Cached assigned leads/current data | Missing robust local fallback | Missing | `LeadListScreen.tsx`, `LeadDetailScreen.tsx` | Yes |
| Offline indicator | Clear offline indicator | Missing | Missing | `App.tsx` | Yes |
| Queue persistence | Survive app restart | Implemented | Correct | `queue-store.ts` | No |
| User scope isolation | Queue/cache tied to logged-in executive | Not enforced strongly | Broken | `queue-store.ts`, auth flow | Yes |
| Web visibility after sync | Uploaded docs visible in admin portal | Metadata completion flow exists | Correct | `lead-documents.ts`, web docs review pages | No |
