# Mobile Audit: Section 6.4 Customer Data Collection Form

## Scope
- Audited and fixed scope target:
  - `6.4 Customer Data Collection Form`
- Out of scope:
  - Other mobile modules unless directly required for this form.

## Current Implementation Found

### Mobile form screen
- Screen exists: `apps/mobile/src/screens/CustomerDetailsScreen.tsx`.
- Uses `react-hook-form` with `Controller` + `useWatch`.
- Draft autosave to `AsyncStorage` is present (`customer_details_draft:<leadId>`), with restore on reopen.
- Aadhaar input masking exists in UI (masked unless focused) and masked value from backend is displayed post-save.
- PAN uppercase transform exists.
- IFSC lookup exists and auto-fills bank name from Razorpay IFSC API response.
- Terminal edit lock handling exists (`isEditable` from backend blocks edits and submit button).
- Major gaps:
  - Many required fields are not enforced before submit.
  - District/state prefill display is missing.
  - Installation type display in this form is missing.
  - Site photographs section (min 3 / max 10 enforcement) is missing in this screen.
  - Date field is plain text input (no picker UI).
  - Several required single-select fields are implemented as free-text fields.

### Backend customer-details API
- Endpoint exists: `GET /api/leads/:id/customer-details`, `PUT /api/leads/:id/customer-details`.
- Lead access is scoped through `scopeLeadWhere(req.user!, { id })`.
- Terminal lock is enforced backend-side via `canEditCustomerDetails`.
- Sensitive response masking exists for Aadhaar/bank account; PAN unmasked only for admin/super admin.
- Validation exists for formats (aadhaar/pan/pincode/ifsc) but fields are largely optional.
- Major gaps:
  - Comprehensive required-field enforcement missing.
  - Conditional requirement `loanAmountRequired` when `loanRequired=true` is not strictly enforced against effective final state.
  - Site-photo minimum count requirement is not enforced backend-side.
  - GET response does not include prefill metadata needed by form (`district`, `state`, `installationType`).

### Database/schema alignment
- `CustomerDetail` model exists with most required personal/property/bank fields.
- `Lead` model already holds `district`, `state`, `installationType`.
- No dedicated site-photo counter column; documents are tracked in `documents` table (category-based).
- No schema blocker for implementing critical/high fixes in this section.

## Feature Coverage

### Already present
- Lead association and assigned-lead scope checks.
- Terminal status edit block (backend + mobile UI behavior).
- Draft autosave and draft restore.
- Aadhaar masking in display after entry.
- PAN uppercase transform.
- IFSC lookup + bank auto-fill (partial metadata display).
- Backend format-level validation for aadhaar/pan/pincode/ifsc.

### Partially implemented
- Field validation before submit (some format checks only; requiredness incomplete).
- IFSC integration (bank auto-fill exists; branch metadata is only informational).
- Sensitive data protection (masking present; still relies on optional-field saves with no completeness checks).

### Missing
- Required-field completeness validation (mobile + backend).
- District/state prefilled display from lead in customer form.
- Installation type display/prefill in customer form.
- Site photograph upload section in customer form with min 3 / max 10 validation.
- Backend enforcement for minimum required site photos.
- Strict conditional validation for loan amount (effective final state).
- Standardized required-select UX for constrained fields.

### Broken/Insecure risk points
- Backend accepts incomplete customer detail payloads, enabling partial records where full form is required.
- Mobile submit allows many required fields to remain empty.
- Site photo requirement is not enforced in this form flow.

## Backend/Schema Changes Required

### Required backend changes (Critical/High)
- Extend customer-details payload to support `installationType` updates (lead field) within this form flow.
- Return lead prefill metadata in GET customer-details response:
  - district name/state
  - lead state
  - lead installation type
- Enforce required-field completeness server-side on PUT (against merged current+incoming values).
- Enforce conditional rule:
  - if loan required, loan amount required must be present and positive.
- Enforce site photograph minimum count (>=3) before accepting final customer-details save.
- Enforce constrained values for required select-like fields.

### Schema changes
- No mandatory schema migration for critical/high fixes.

## Mobile UI Changes Required

### Required mobile changes (Critical/High)
- Add district/state/installation type prefill display (read-only).
- Add explicit required-field validation and user-facing error checks before submit.
- Add site photo upload section in this screen (camera/gallery/files via existing upload pipeline).
- Enforce min 3 / max 10 site photos before submit.
- Use constrained selection controls for required select fields to avoid invalid free-text.
- Keep autosave/restore behavior intact.

## Env/Config Changes Required
- No new mandatory env vars required for critical/high fixes.
- IFSC lookup currently uses public endpoint; failure handling already present and should remain graceful.

## Security and Authorization Findings
- Positive:
  - Assigned-lead scoping present (`scopeLeadWhere`).
  - Terminal edit restriction enforced backend-side.
  - Sensitive masking for Aadhaar/bank account in responses.
- Issues to fix:
  - Incomplete form acceptance by backend (requiredness not enforced).
  - Missing site-photo requirement enforcement in this form path.

## Draft/Autosave Findings
- Draft save on change and restore on reopen are implemented.
- Draft clearing on successful submit is implemented.
- No critical draft issue found.

## Validation and Masking Findings
- Aadhaar masking in display: implemented.
- PAN uppercase: implemented.
- Required field validation: incomplete.
- Conditional loan amount validation: incomplete.

## Terminal-Status Restriction Findings
- Backend restriction exists and is authoritative.
- Mobile respects `isEditable` flag.
- No critical issue found.

## IFSC Lookup Integration Findings
- IFSC lookup implemented client-side using Razorpay API.
- Bank name auto-populates.
- Branch/city/state metadata displayed as helper text.
- Failure handling exists.

## Priority of Fixes
- **Critical**
  - Backend required-field completeness enforcement for customer form save.
  - Mobile required-field submit validation.
  - Site photo upload + min/max enforcement in customer form flow.
  - Backend minimum site-photo enforcement before save.
- **High**
  - Prefilled district/state/installation type in form response and UI.
  - Constrained select controls + backend value constraints for required categorical fields.
  - Strict conditional `loanAmountRequired` enforcement when `loanRequired=true`.
- **Medium**
  - Date picker component upgrade (currently text date with format validation).
- **Low**
  - Additional UX polish and helper copy enhancements.

## Verification Table

| Feature | Required behavior | Current implementation | Status | Files involved | Fix required |
|---|---|---|---|---|---|
| Lead association and scope | Form tied to lead + assigned FE scope | Scoped via `scopeLeadWhere` | Correct | `apps/api/src/routes/leads.ts`, `apps/api/src/services/lead-access.service.ts` | No |
| Terminal edit lock | Block edits once terminal | Implemented backend + mobile `isEditable` | Correct | `apps/api/src/routes/leads.ts`, `apps/mobile/src/screens/CustomerDetailsScreen.tsx` | No |
| Draft autosave | Save on field changes | Implemented with `useWatch` + AsyncStorage | Correct | `apps/mobile/src/screens/CustomerDetailsScreen.tsx` | No |
| Draft restore | Restore on reopen/resume | Implemented merge of server + local draft | Correct | `apps/mobile/src/screens/CustomerDetailsScreen.tsx` | No |
| Aadhaar masking | Mask display after entry/save | Implemented | Correct | `apps/mobile/src/screens/CustomerDetailsScreen.tsx`, `apps/api/src/routes/leads.ts` | No |
| PAN uppercase | Auto-uppercase | Implemented | Correct | `apps/mobile/src/screens/CustomerDetailsScreen.tsx`, `apps/api/src/routes/leads.ts` | No |
| IFSC lookup | Lookup + bank/branch metadata | Bank auto-fill + metadata helper present | Partial | `apps/mobile/src/screens/CustomerDetailsScreen.tsx` | High |
| Required fields (mobile) | Must validate before submit | Only partial checks | Missing | `apps/mobile/src/screens/CustomerDetailsScreen.tsx` | Critical |
| Required fields (backend) | Must enforce server-side too | Mostly optional payload allowed | Missing | `apps/api/src/routes/leads.ts` | Critical |
| Loan amount conditional | Required if loan required | Not fully enforced on effective state | Partial | `apps/api/src/routes/leads.ts`, `apps/mobile/src/screens/CustomerDetailsScreen.tsx` | High |
| District/state prefill | Pre-filled from lead | Not returned/displayed in form | Missing | `apps/api/src/routes/leads.ts`, `apps/mobile/src/screens/CustomerDetailsScreen.tsx` | High |
| Installation type in form | Required section value | Not shown in customer form | Missing | `apps/api/src/routes/leads.ts`, `apps/mobile/src/screens/CustomerDetailsScreen.tsx` | High |
| Site photos min/max | 3-10 photos required | Not implemented in customer form | Missing | `apps/mobile/src/screens/CustomerDetailsScreen.tsx`, `apps/api/src/routes/leads.ts` | Critical |
| Backend photo requirement | Enforce min photos on save | Not enforced | Missing | `apps/api/src/routes/leads.ts` | Critical |

## Implementation Update (Critical/High Fixes Applied)

Implemented after the audit:

- Backend (`apps/api/src/routes/leads.ts`)
  - Added strict categorical validation for:
    - `gender`
    - `propertyOwnership`
    - `installationType`
    - `roofType`
    - `connectionType`
  - Added `leadPrefill` and `sitePhotographs` metadata in `GET /:id/customer-details`.
  - Enforced required field completeness on `PUT /:id/customer-details` using effective final state.
  - Enforced conditional `loanAmountRequired` when `loanRequired=true`.
  - Enforced site photo minimum (`>=3`) and maximum (`<=10`) before save.
  - Persisted lead `installationType` update through this form flow.

- Backend upload guard (`apps/api/src/routes/lead-documents.ts`)
  - Added site-photo category detection by prefix (`site_photo*`, `site_photograph*`).
  - Added max-site-photo enforcement (`10`) in `/complete`, while still allowing same-category replacement.

- Mobile (`apps/mobile/src/screens/CustomerDetailsScreen.tsx`)
  - Consumed `leadPrefill` and `sitePhotographs` metadata.
  - Added read-only district/state prefilled display.
  - Added installation type field in the form.
  - Converted categorical fields to single-select controls:
    - gender
    - installation type
    - property ownership
    - shadow-free area
    - roof type
    - connection type
  - Added strict required-field checks before submit.
  - Added categorical value validation for required select-like fields.
  - Added conditional loan amount check.
  - Added site photo upload section (camera/gallery/file) using existing upload service.
  - Enforced photo upload min/max before submit.
  - Preserved draft autosave/restore behavior.

Remaining non-critical gap:
- Date picker UI is still text-based (`YYYY-MM-DD`) instead of a dedicated picker component (Medium).
- IFSC branch is shown in helper metadata but not persisted as a dedicated DB field (Medium).
