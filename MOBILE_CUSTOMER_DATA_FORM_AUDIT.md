# MOBILE_CUSTOMER_DATA_FORM_AUDIT

## 1. Current customer data collection form implementation found in code
- Mobile screen exists: `apps/mobile/src/screens/CustomerDetailsScreen.tsx`.
- Uses `react-hook-form` + controlled inputs, local draft autosave in `AsyncStorage`, and draft restore on reopen.
- Uses same backend API as web: `GET/PUT /api/leads/:id/customer-details` in `apps/api/src/routes/leads.ts`.
- Backend enforces assigned-lead scoping with `scopeLeadWhere(req.user!, { id })`.
- Backend enforces terminal-status edit lock via `canEditCustomerDetails`.
- Site photo upload uses existing secure upload pipeline (`uploadLeadDocument`) and queue fallback (`UPSERT_CUSTOMER_DETAILS`, `UPLOAD_LEAD_DOCUMENT`).

## 2. Which required features are already present
- Lead-linked form submission and update flow.
- Edit-until-terminal behavior (backend authoritative + mobile disabled state).
- Required field checks (mobile and backend).
- Aadhaar masking in display contexts.
- PAN uppercase transformation.
- IFSC lookup and bank name autofill.
- Site photo count guard (min/max) in form submit flow.
- Offline draft autosave and restore.
- Assigned lead scoping on backend.

## 3. Which required features are partially implemented
- Date of Birth uses validated text format (`YYYY-MM-DD`), not a native date-picker UI.
- IFSC flow auto-populates bank name; branch is only shown as helper metadata (no dedicated persisted branch field).
- Sensitive-field protection is now encrypted for new/updated values; legacy rows can still be plaintext until updated/backfilled.

## 4. Which required features are missing
- Native date-picker UI control for DOB (still text input).
- Dedicated persisted branch field for IFSC branch auto-population.

## 5. Which required features are broken or insecure
- Fixed: PAN re-entry bug for executives (masked PAN existed but mobile still required fresh PAN each submit).
- Fixed: Bank account was not strictly digit-only in validation path.
- Fixed: Sensitive fields (`aadhaar_encrypted`, `pan_encrypted`, `bank_account_encrypted`) were being written as plaintext.

## 6. Which backend/schema changes are required
- Applied backend changes:
  - Added encryption/decryption helper service: `apps/api/src/services/sensitive-data.service.ts`.
  - Applied encryption before storing sensitive fields in customer details upsert.
  - Decryption-aware masking in API response generation.
  - Strict bank account digit validation (`6-34` digits) in zod schema.
- Schema migration not required for these fixes (existing columns reused).
- Optional future schema enhancement:
  - Add explicit `bankBranch` column if branch persistence is required.

## 7. Which mobile UI changes are required
- Applied mobile changes:
  - Added `panMasked` handling from API payload.
  - PAN required check now accepts existing masked PAN (no forced re-entry).
  - Bank account input now sanitizes to digits only.
  - Bank account length guard aligned with backend (`6-34` digits).

## 8. Which env/config changes are required
- Added optional env support:
  - `CUSTOMER_DATA_ENCRYPTION_KEY` in:
    - `apps/api/src/config/env.ts`
    - `apps/api/.env.example`
- Behavior:
  - If provided (recommended: 32-byte base64), used for customer sensitive field encryption.
  - If absent, code falls back to JWT/service-role secret hashing.

## 9. Security and authorization issues found
- Authorization/scoping: correct (assigned-lead scope check exists).
- Terminal edit lock: correct (backend-enforced).
- Sensitive storage: previously insecure, now fixed for new writes via encryption helper.

## 10. Draft/autosave issues found
- No critical issue found.
- Draft save/restore and offline queue integration working in current code path.

## 11. Validation and masking issues found
- Fixed PAN masked fallback handling on mobile required checks.
- Fixed bank-account numeric-only enforcement (mobile + backend).
- Aadhaar masking and PAN uppercase remain correct.

## 12. Terminal-status edit restriction issues found
- No critical issue found.
- Backend still blocks updates for non-admin roles once lead is terminal.

## 13. IFSC lookup integration issues found
- Lookup integration works and auto-fills bank name.
- Branch is not persisted as dedicated field (partial vs requirement wording).

## 14. Priority of fixes
- Critical (fixed):
  - Sensitive value plaintext storage in `*_encrypted` columns.
  - PAN re-entry requirement bug for existing masked records.
- High (fixed):
  - Bank account numeric validation parity between mobile and backend.
- Medium (open):
  - Native DOB date picker UI.
  - Persisted IFSC branch field.
- Low:
  - UX polish for helper messaging and field hints.

## Verification Table

| Feature | Required behavior | Current implementation | Status (Correct / Partial / Missing / Broken) | Files involved | Fix required |
|---|---|---|---|---|---|
| Lead-linked form | Form tied to lead | Uses `/api/leads/:id/customer-details` + leadId route param | Correct | `apps/mobile/src/screens/CustomerDetailsScreen.tsx`, `apps/api/src/routes/leads.ts` | No |
| Assigned scope | Only assigned FE can access/update | `scopeLeadWhere(req.user!, { id })` enforced | Correct | `apps/api/src/routes/leads.ts`, `apps/api/src/services/lead-access.service.ts` | No |
| Terminal lock | Editable until terminal status only | `canEditCustomerDetails` + UI disable state | Correct | `apps/api/src/routes/leads.ts`, `apps/mobile/src/screens/CustomerDetailsScreen.tsx` | No |
| Autosave draft | Save local progress on field change | AsyncStorage draft key with debounce + restore | Correct | `apps/mobile/src/screens/CustomerDetailsScreen.tsx` | No |
| Aadhaar masking | Mask display after entry/save | UI mask + API masked response | Correct | `apps/mobile/src/screens/CustomerDetailsScreen.tsx`, `apps/api/src/routes/leads.ts` | No |
| PAN uppercase | Auto uppercase | `sanitizePan` on input/payload | Correct | `apps/mobile/src/screens/CustomerDetailsScreen.tsx` | No |
| PAN re-entry | Do not force re-entry if already stored/masked | Uses `panMasked` fallback in required checks | Correct | `apps/mobile/src/screens/CustomerDetailsScreen.tsx` | Fixed |
| IFSC lookup | Lookup and auto-populate bank data | Bank name autofill + metadata helper | Partial | `apps/mobile/src/screens/CustomerDetailsScreen.tsx` | Medium |
| Bank account validation | Numeric-only + valid length | Mobile sanitize digits + backend regex `^\\d{6,34}$` | Correct | `apps/mobile/src/screens/CustomerDetailsScreen.tsx`, `apps/api/src/routes/leads.ts` | Fixed |
| Site photos rule | Min 3 / Max 10 enforced | Form and backend count checks present | Correct | `apps/mobile/src/screens/CustomerDetailsScreen.tsx`, `apps/api/src/routes/leads.ts` | No |
| Backend required validation | Backend must enforce required fields | Missing-required + loan conditional checks | Correct | `apps/api/src/routes/leads.ts` | No |
| Sensitive storage | Protect Aadhaar/PAN/bank data at rest | Encrypt on write + decrypt/mask on read | Partial (legacy rows) | `apps/api/src/services/sensitive-data.service.ts`, `apps/api/src/routes/leads.ts` | Backfill optional |
| DOB input control | Date picker UI | Text input with regex validation only | Missing | `apps/mobile/src/screens/CustomerDetailsScreen.tsx` | Medium |
