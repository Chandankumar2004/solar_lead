# Mobile Document Upload & Offline Functionality Audit (Sections 6.5 / 6.6)

Date: 2026-03-16

## 1. Current Mobile Document Upload Implementation
- Mobile UI: [`apps/mobile/src/screens/LeadDetailScreen.tsx`](d:/Solar_Lead/apps/mobile/src/screens/LeadDetailScreen.tsx)
  - Category chips for required document types (Aadhaar front/back, PAN, electricity bill, cancelled cheque/passbook, site photos, roof assessment).
  - Camera/gallery/file picker via `expo-image-picker` and `expo-document-picker`.
  - Client-side validation: type (JPEG/PNG/PDF) and max size 10 MB.
  - Upload progress + retry UI for failed uploads.
  - Offline queue support for uploads with retry on reconnect.
  - Download + cache documents for offline access.
- Upload service: [`apps/mobile/src/services/document-upload.ts`](d:/Solar_Lead/apps/mobile/src/services/document-upload.ts)
  - Presigned upload flow -> Supabase Storage signed upload URL.
  - Uploads with progress via XHR.
  - Backend completion call to store metadata.
- Offline queue store: [`apps/mobile/src/store/queue-store.ts`](d:/Solar_Lead/apps/mobile/src/store/queue-store.ts)
  - AsyncStorage persistence and retry.

## 2. Current Offline Functionality Implementation
- Offline indicator + auto-queue flush: [`apps/mobile/src/App.tsx`](d:/Solar_Lead/apps/mobile/src/App.tsx)
- Local cache (AsyncStorage): [`apps/mobile/src/services/offline-cache.ts`](d:/Solar_Lead/apps/mobile/src/services/offline-cache.ts)
- Offline lead list cache: [`apps/mobile/src/screens/LeadListScreen.tsx`](d:/Solar_Lead/apps/mobile/src/screens/LeadListScreen.tsx)
- Offline lead detail cache + offline notice: [`apps/mobile/src/screens/LeadDetailScreen.tsx`](d:/Solar_Lead/apps/mobile/src/screens/LeadDetailScreen.tsx)
- Offline customer details cache + draft: [`apps/mobile/src/screens/CustomerDetailsScreen.tsx`](d:/Solar_Lead/apps/mobile/src/screens/CustomerDetailsScreen.tsx)
- Offline document cache: [`apps/mobile/src/services/document-cache.ts`](d:/Solar_Lead/apps/mobile/src/services/document-cache.ts)
- Queue persistence / retry: [`apps/mobile/src/store/queue-store.ts`](d:/Solar_Lead/apps/mobile/src/store/queue-store.ts)

## 3. Required Features Already Present
### Document Upload
- Camera/gallery/file pickers.
- JPEG/PNG/PDF validation.
- 10 MB max file size validation (mobile + backend).
- Upload progress in UI.
- Retry for failed uploads (Lead Detail UI).
- Supabase Storage signed upload flow (no client credentials).
- Uploaded documents stored in DB and visible to admin portal.
- Offline upload queue + auto-sync on reconnect.

### Offline Functionality
- Assigned leads cached locally.
- Lead detail cache with offline fallback.
- Customer details form local draft + offline cache.
- Status updates queued while offline.
- Form submissions queued while offline.
- Document uploads queued while offline.
- Offline indicator banner.
- Queue persistence across restarts.

## 4. Partially Implemented Features
- **Site photographs (multiple):** Document upload UI previously used a single `site_photo` category, which would overwrite the latest version when `latestOnly` is used in listing. Multiple unique site photos were not reliably visible. Fixed by generating indexed categories (`site_photo_1`, `site_photo_2`, ...).
- **Sync failure visibility:** Queue failures were stored but not visible in UI. Added queue summary + failed item display in Profile.

## 5. Missing Features
- None after fixes in this pass.

## 6. Broken or Insecure Features
- None found in the inspected scope.

## 7. Backend / Schema Changes Required
- None required. Supabase Storage is already used via signed URLs.

## 8. Mobile UI Changes Required
- Add visibility for queued/failed offline sync actions and allow manual retry.
- Ensure site photo uploads create unique categories and enforce max 10 on the client.

## 9. Env / Config Changes Required
- None.

## 10. Security & Authorization Issues
- No new issues found. Backend lead scoping enforced via `scopeLeadWhere` in document routes.

## 11. Storage / Upload Flow Issues
- None. Supabase signed upload flow is in use; no client credentials exposed.

## 12. Offline Cache & Queue Issues
- Queue failures were not visible to users; now surfaced in Profile with retry.

## 13. Sync / Retry / Idempotency Issues
- Upload dedupe keys exist; status transition and customer details already dedupe by lead.
- Manual retry added via Profile screen for recoverability.

## 14. Visibility Issues (Mobile -> Web Admin)
- Document metadata is stored on completion and visible in admin routes. No issues found.

## 15. Priority of Fixes
- **Critical:** None.
- **High:** Site photo categories for multiple uploads; offline sync failure visibility.
- **Medium:** Optional per-lead pending/failed queue details.
- **Low:** Optional UX polish for queue error history.

---

## Verification Table

| Feature | Required behavior | Current implementation | Status | Files involved | Fix required |
|---|---|---|---|---|---|
| Document categories | Must include Aadhaar front/back, PAN, etc. | Category chips in Lead Detail | Correct | apps/mobile/src/screens/LeadDetailScreen.tsx | No |
| Camera/gallery/file upload | Must support camera + file system | Expo ImagePicker + DocumentPicker | Correct | LeadDetailScreen.tsx | No |
| File type validation | JPEG/PNG/PDF only | Client + backend validation | Correct | document-upload.ts, lead-documents.ts | No |
| File size limit | 10 MB max | Client + backend validation | Correct | document-upload.ts, lead-documents.ts | No |
| Upload progress | Show progress | Upload progress UI per item | Correct | LeadDetailScreen.tsx | No |
| Retry without reselect | Retry failed uploads | Retry button per failed item | Correct | LeadDetailScreen.tsx | No |
| Site photos multiple | Allow multiple photos | Indexed categories + max enforced | Correct (fixed) | LeadDetailScreen.tsx | Fixed |
| Offline upload queue | Queue when offline | Queue store + NetInfo | Correct | queue-store.ts, LeadDetailScreen.tsx | No |
| Auto sync on reconnect | Sync queued items | NetInfo + flush on reconnect | Correct | App.tsx, queue-store.ts | No |
| Offline lead cache | Leads available offline | Lead list cached | Correct | LeadListScreen.tsx, offline-cache.ts | No |
| Offline lead detail | Detail cached | Lead detail cached | Correct | LeadDetailScreen.tsx, offline-cache.ts | No |
| Offline docs | Downloaded docs available | Document cache + open offline | Correct | document-cache.ts, LeadDetailScreen.tsx | No |
| Offline indicator | Clear offline banner | Banner in App root | Correct | App.tsx | No |
| Queue failure visibility | Show failed sync + recovery | Profile queue summary + retry | Correct (fixed) | ProfileScreen.tsx | Fixed |

