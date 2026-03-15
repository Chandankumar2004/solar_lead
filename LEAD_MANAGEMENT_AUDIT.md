# Lead Management Audit (Section 5.3)

## 1. Current Lead List Implementation Found
- Lead list page exists at `apps/web/src/app/(portal)/leads/page.tsx`.
- Backend list endpoint exists at `GET /api/leads` in `apps/api/src/routes/leads.ts`.
- Pagination, search, and filtering are implemented.
- Quick actions exist: view, assign/reassign, status change, delete (super admin only).
- Role-scoped access is enforced on backend with `scopeLeadWhere(...)`.

## 2. Current Lead Detail Implementation Found
- Lead detail page exists at `apps/web/src/app/(portal)/leads/[id]/page.tsx`.
- Backend detail endpoint exists at `GET /api/leads/:id` in `apps/api/src/routes/leads.ts`.
- Existing tabs/sections:
  - Overview (includes UTM fields)
  - Status Timeline (with actor, timestamp, notes)
  - Customer Information
  - Documents (preview/download/upload)
  - Payments
  - Loan Details
  - Communications Log
- Sensitive customer fields are masked by role in backend (`sanitizeLeadResponseForRole`, `toCustomerDetailResponse`).

## 3. Current Lead Assignment Implementation Found
- Reassignment available from detail page.
- Reassignment reason is required in backend when executive actually changes.
- District manager reassignment scope checks are implemented.
- Audit entry `LEAD_REASSIGNED` is written.
- Workload data is shown via dashboard summary (`activeLeads`, assigned counts, pending docs/payments).

## 4. Features Already Present (Correct)
- Paginated searchable list endpoint and UI.
- Search across name/phone/email.
- Default sort by `createdAt desc` in backend.
- Status filter (multi-select in UI).
- Date range filter.
- State filter.
- Assigned executive filter.
- Installation type filter.
- Lead detail overview including UTM values.
- Status timeline with who/when/notes.
- Customer info section.
- Documents section with preview/download.
- Payment section with token/UTR/review status data.
- Loan details section.
- Communications log with delivery status.
- Assignment and reassignment with required reason.
- Backend role/district scoping on lead access.

## 5. Partially Implemented Features
- Lead list filter set is partial:
  - District currently single-select in UI/API (required multi-select).
  - Source/UTM source filter missing.
- Lead list table columns partially aligned:
  - `updatedAt` not shown in list table (required).
  - Lead ID/Name/Phone are present but ID and name are combined in one cell.
- Assignment notifications:
  - Notifications exist for new lead creation.
  - Reassignment does not currently notify both previous and newly assigned executive.

## 6. Missing Features
- Internal Notes section/tab in lead detail (with restricted visibility).
- Activity Log section/tab in lead detail (complete audit trail view).

## 7. Broken/Insecure/Inconsistent Areas
- Backend list default page size is `20` (`listLeadsQuerySchema`) while requirement is `10`.
- Reassignment notification requirement is not fulfilled (missing old/new executive notifications).

## 8. Backend/Schema Changes Required
- Backend route updates in `apps/api/src/routes/leads.ts`:
  - list query schema default page size to 10.
  - add district multi-filter query support.
  - add UTM source filter support.
  - add internal notes read/create endpoints.
  - add activity log endpoint and include activity + notes in detail payload.
  - trigger notifications on reassignment for old/new executives.
- No Prisma schema change is strictly required for Critical/High fixes because internal notes can be safely represented via audited note actions in existing `audit_logs`.

## 9. Frontend/UI Changes Required
- Lead list UI (`apps/web/src/app/(portal)/leads/page.tsx`):
  - district multi-select filter.
  - source (UTM source) filter input.
  - show last updated date column.
  - align columns with required row fields.
- Lead detail UI (`apps/web/src/app/(portal)/leads/[id]/page.tsx`):
  - add internal notes tab (role-restricted).
  - add activity log tab.
  - add create-note flow for authorized roles.

## 10. Env/Config Changes Required
- None mandatory for Critical/High fixes in this section.
- Existing Supabase storage env is already used by document flows.

## 11. Security and Scoping Issues Found
- Lead and detail access is correctly scoped using `scopeLeadWhere`.
- Sensitive fields are role-masked.
- Missing internal notes feature currently means no explicit restricted internal-note channel exists (must be added with backend enforcement).

## 12. Priority of Fixes

### Critical
1. Add internal notes feature with backend role restriction (not visible to field executive).
2. Add activity log view from backend audit trail.

### High
1. Fix lead list default backend page size to 10.
2. Add district multi-select filter support (UI + API).
3. Add source/UTM source filter support (UI + API).
4. Add reassignment notifications to both previous and new executive.
5. Show last updated date in lead list.

### Medium
1. Further normalize table column layout to exactly mirror requirement wording.
2. Optional richer activity-log categorization across non-lead entity records.

### Low
1. Additional UX polish (badges/grouping in notes/activity tabs).

---

## Verification Table

| Feature | Required Behavior | Current Implementation | Status | Files Involved | Fix Required |
|---|---|---|---|---|---|
| List pagination | Paginated table, default page size 10 | Pagination present, backend default pageSize 20 | Partial | `apps/web/src/app/(portal)/leads/page.tsx`, `apps/api/src/routes/leads.ts` | Set backend default to 10 |
| List default sort | Creation date desc | `orderBy: { createdAt: "desc" }` | Correct | `apps/api/src/routes/leads.ts` | No |
| Search | Name + phone + email | Implemented in backend OR clause | Correct | `apps/api/src/routes/leads.ts` | No |
| Date range filter | Filter by creation date | Implemented (`dateFrom`, `dateTo`) | Correct | `apps/web/src/app/(portal)/leads/page.tsx`, `apps/api/src/routes/leads.ts` | No |
| Status multi-filter | Multi-select statuses | Implemented | Correct | `apps/web/src/app/(portal)/leads/page.tsx`, `apps/api/src/routes/leads.ts` | No |
| District filter | Multi-select districts | Single-select only | Partial | `apps/web/src/app/(portal)/leads/page.tsx`, `apps/api/src/routes/leads.ts` | Add multi-select + `districtIds` support |
| State filter | Filter by state | Implemented | Correct | same | No |
| Assigned exec filter | Filter by assigned exec | Implemented | Correct | same | No |
| Installation type filter | Filter by installation type | Implemented | Correct | same | No |
| Source filter | Filter by UTM source | Missing | Missing | same | Add source query + UI filter |
| Required list row fields | Lead ID, name, phone, district, status, assigned exec, created, updated, actions | All except updatedAt shown; ID/name combined | Partial | `apps/web/src/app/(portal)/leads/page.tsx` | Add updatedAt column; align columns |
| Detail overview | Include lead + UTM data | Implemented | Correct | `apps/web/src/app/(portal)/leads/[id]/page.tsx` | No |
| Status timeline | Chronological with actor/time/notes | Implemented | Correct | UI + `detailInclude` in `leads.ts` | No |
| Customer info tab | Detailed FE-captured data | Implemented | Correct | UI + `/customer-details` logic | No |
| Documents tab | Categorized docs + preview/download | Implemented (category visible, preview/download) | Correct | detail page + `lead-documents.ts` + `uploads.ts` | No |
| Payment tab | Token payment status + UTR + verification | Implemented | Correct | detail page + `payments.ts` + lead include | No |
| Loan details tab | Loan pipeline fields | Implemented | Correct | detail page + schema include | No |
| Communications tab | SMS/email/WhatsApp logs + delivery | Implemented via `notificationLogs` | Correct | detail page + schema include | No |
| Internal notes tab | Admin/manager internal notes, hidden from FE/customers | Missing | Missing | detail page, `leads.ts` | Add backend + UI notes flow |
| Activity log tab | Complete audit trail for lead | Missing | Missing | detail page, `leads.ts`, `audit_logs` | Add backend + UI activity tab |
| Reassignment reason | Mandatory on reassignment | Implemented | Correct | `leads.ts`, detail page | No |
| Reassignment notifications | Notify newly and previously assigned executive | Not triggered on reassignment | Missing | `leads.ts`, `notification.service.ts` | Add notification trigger on reassignment |
| Assignment workload info | Show available executives with active counts | Implemented | Correct | detail page + dashboard summary | No |
| Backend scoping | Role + district/assignment scoped access | Implemented with `scopeLeadWhere` | Correct | `lead-access.service.ts`, `leads.ts` | No |

