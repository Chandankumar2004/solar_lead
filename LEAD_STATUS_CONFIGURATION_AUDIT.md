# Lead Status Configuration Audit (Section 5.4)

## 1) Current lead status configuration implementation found in code
- Backend status configuration APIs exist in `apps/api/src/routes/lead-statuses.ts`.
- APIs support:
  - list statuses
  - create status
  - update status
  - reorder via `orderIndex`
  - list transitions
  - create/delete transitions
- Status data model already supports:
  - `name`, `description`, `orderIndex`, `isTerminal`
  - `requiresNote`, `requiresDocument`
  - `notifyCustomer`, `notificationTemplateId`
  - `colorCode`
- Backend route is protected with `allowRoles("SUPER_ADMIN")` for configuration.
- Web workflow page exists at `apps/web/src/app/(portal)/workflow/page.tsx`, but is currently read-only.

## 2) Current workflow/transition implementation found in code
- Transition edge table exists (`LeadStatusTransition`) and is used by lead transition logic.
- Lead transition endpoint (`POST /api/leads/:id/transition`) enforces configured transitions.
- Terminal override exists but was partially implemented (focused on one direction and not all terminal movement cases).
- Customer notification queue is triggered on status transition.

## 3) Required features already present
- Super Admin-only backend configuration route protection.
- Status model fields for description, color, terminal, note/doc requirement, notification settings.
- Transition storage model and transition CRUD endpoint.
- Reorder support in backend through `orderIndex`.
- Audit logging for lead status create/update/transition mutation actions.

## 4) Required features partially implemented
- Status management UI:
  - visual list exists, but no create/edit/reorder controls.
- Allowed-next configuration:
  - backend exists, but no full admin editing UI.
- Terminal restrictions:
  - partially enforced in lead transition flow, but not fully strict for all terminal-state moves.
- Requirement enforcement:
  - `requiresNote` / `requiresDocument` stored but not fully enforced in lead transition endpoint.

## 5) Required features missing
- Full Super Admin workflow configuration UI in portal:
  - add status
  - edit status
  - reorder controls
  - transition editor controls
  - template selector integration for notification-enabled statuses
- Required default 18-step lifecycle was not seeded; project currently seeded a different 9-step workflow.

## 6) Required features broken or insecure
- Business-rule gap: target status `requiresNote` / `requiresDocument` not enforced server-side during transitions.
- Terminal enforcement gap: movement from terminal status was not fully locked in all cases without explicit Super Admin override behavior.

## 7) Backend/schema changes required
- No schema model expansion required (fields already exist).
- Backend logic changes required:
  - enforce `requiresNote` on transition target status.
  - enforce `requiresDocument` on transition target status.
  - hard-lock terminal status movement except Super Admin override with reason.
  - reject transition configuration where `fromStatus` is terminal.
- Seed changes required:
  - provide required default 18-status sequence and transitions as baseline defaults.

## 8) Frontend/UI changes required
- Replace read-only workflow page with full management UI:
  - status list (ordered, color, terminal badge)
  - create/edit status form (all required fields)
  - reorder controls
  - transition management controls per selected source status
  - notification template dropdown

## 9) Env/config changes required
- None mandatory for this module.
- Existing notification template APIs are reused; no new env vars required.

## 10) Security and authorization issues found
- Super Admin enforcement on backend config routes is correct.
- Missing strict runtime enforcement for `requiresNote`/`requiresDocument` was a security/business-control gap.

## 11) Transition enforcement issues found
- Transition edges enforced, but terminal/override behavior and required note/document validation needed tightening.

## 12) Terminal status enforcement issues found
- Terminal lock not fully strict in all movement scenarios before fix.
- Transition-config endpoint allowed creating outgoing transitions from terminal statuses.

## 13) Priority of fixes
- Critical
  - Enforce `requiresNote` and `requiresDocument` in transition endpoint.
  - Enforce strict terminal lock with Super Admin override + reason.
  - Implement functional Super Admin workflow configuration UI.
- High
  - Seed required 18 default statuses and lifecycle transitions.
  - Prevent creation of outgoing transitions from terminal statuses in config API.
- Medium
  - Improve operator UX messages and empty states in workflow UI.
- Low
  - Add richer visual workflow graph (drag-drop graph/sankey style) if desired.

---

## Verification Table

| Feature | Required behavior | Current implementation | Status | Files involved | Fix required |
|---|---|---|---|---|---|
| Super Admin-only config | Only Super Admin can configure workflow | Backend route guarded by `allowRoles("SUPER_ADMIN")` | Correct | `apps/api/src/routes/lead-statuses.ts` | None |
| Visual ordered list | Ordered lifecycle list with clear sequence | Read-only list exists | Partial | `apps/web/src/app/(portal)/workflow/page.tsx` | Add full management UI |
| Add status | Create status with required fields | Backend create exists, UI missing | Partial | `apps/api/src/routes/lead-statuses.ts`, `apps/web/src/app/(portal)/workflow/page.tsx` | Add form + submit flow |
| Edit status | Update status fields | Backend patch exists, UI missing | Partial | same as above | Add edit form |
| Reorder statuses | Reorder lifecycle sequence | Backend supports `orderIndex`, UI missing | Partial | same as above | Add move up/down reorder controls |
| Terminal flag | Mark statuses terminal | Backend supports `isTerminal`, UI missing | Partial | same as above | Add terminal toggle in UI |
| Allowed next transitions | Configure valid next statuses | Backend mutation exists, UI missing | Partial | same as above | Add transitions editor |
| Note required rule | Enforce note when status requires it | Stored but not fully enforced in transition endpoint | Broken | `apps/api/src/routes/leads.ts` | Enforce before update |
| Document required rule | Enforce docs when status requires it | Stored but not fully enforced in transition endpoint | Broken | `apps/api/src/routes/leads.ts` | Enforce before update |
| Terminal movement lock | Terminal status must block further movement unless override | Partially enforced | Partial | `apps/api/src/routes/leads.ts` | Tighten logic |
| Terminal outgoing edges | Terminal statuses should not have normal outgoing transitions | Not blocked in config mutation | Missing | `apps/api/src/routes/lead-statuses.ts` | Reject create edge from terminal status |
| Notification trigger setting | Status transition can trigger customer notification/template | Model + route support exists | Correct | `apps/api/prisma/schema.prisma`, `apps/api/src/routes/lead-statuses.ts` | UI for template selection |
| Default lifecycle seed | Required 18 default statuses, editable | Different 9-status defaults only | Missing | `apps/api/prisma/seed.ts` | Replace/enhance defaults |
| Color coding | Configurable color code per status | Backend supports hex field, UI read-only | Partial | `apps/api/src/routes/lead-statuses.ts`, `apps/web/src/app/(portal)/workflow/page.tsx` | Add editable color input |
| Audit logs for config changes | Track status config actions | Create/update/transition mutation logs exist | Correct | `apps/api/src/routes/lead-statuses.ts` | None |

