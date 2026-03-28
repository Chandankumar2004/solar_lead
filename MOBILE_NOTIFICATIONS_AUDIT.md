# Mobile Notifications Audit (Section 6.7)

Date: 2026-03-20  
Scope: Mobile notification module only (FCM, token registration, triggers, deep linking, executive scoping).

## 1. Current mobile notification implementation found in code
- Mobile FCM integration exists in `apps/mobile/src/services/push-notifications.ts`:
  - permission request
  - token fetch + refresh listener
  - foreground handler
  - background/open/quit open handlers
  - backend token register/unregister calls
- Deep-link navigation exists in `apps/mobile/src/App.tsx` and navigates to `Leads -> LeadDetail` when payload contains `leadId`.
- Local unread/recent state exists in `apps/mobile/src/store/notification-store.ts` and is shown in `apps/mobile/src/screens/NotificationsScreen.tsx`.
- Backend push dispatch + audit/logging exists in `apps/api/src/services/notification.service.ts` and Prisma `NotificationLog`.

## 2. Required features already present
- FCM token lifecycle from mobile app (register/refresh/unregister).
- Foreground/background/open-app notification handling.
- Tap deep-link routing to lead detail.
- Triggers implemented for:
  - lead status updates from admin/manager to executive
  - UTR rejected
  - document rejected / re-upload requested
  - inactivity reminders with configurable threshold
- Notification logs are persisted in database.

## 3. Required features partially implemented
- Loan-status push currently depends on lead status names containing `"loan"` (`triggerExecutiveLoanStatusUpdatedNotification`), not on dedicated `loan_details.applicationStatus` mutation flow.
- Expo Go cannot receive RN Firebase push; native/dev client build required.

## 4. Required features missing (found during audit)
- New-assignment push coverage for mirrored public leads was missing.

## 5. Required features broken or insecure (found during audit)
- Device token API was not restricted to field executives.
- Reassignment push sent lead deep-link context to previous assignee, who may no longer be authorized.
- Rejection push payloads included avoidable note content in metadata/body.

## 6. Backend/schema changes required
- Schema change: none required.
- Backend changes required and implemented:
  - restrict device-token endpoints to `FIELD_EXECUTIVE`
  - send assignment push to new assignee only during reassignment
  - trigger assignment push for public lead mirroring
  - minimize rejection push payload detail

## 7. Mobile UI/app changes required
- None required for critical/high fixes.

## 8. Env/config changes required
- None required.
- Existing `LEAD_INACTIVITY_REMINDER_DAYS` config is valid and already present.

## 9. Security and authorization issues found
- Fixed: backend now enforces field-executive-only access for device token endpoints.
- Fixed: reassignment notification no longer deep-links old assignee to non-authorized lead context.
- Improved: push rejection payload now avoids unnecessary note detail.

## 10. FCM token registration issues found
- Fixed: token endpoints were previously available to all authenticated roles.

## 11. Trigger/event coverage issues found
- Fixed: mirrored public lead creation now triggers new-lead-assigned notification flow.
- Remaining partial: loan update coverage is workflow-status-name based.

## 12. Deep-link handling issues found
- Fixed: reassignment push with lead deep-link now targets new assignee only.
- Existing API authorization (`scopeLeadWhere`) still enforces access on lead detail fetch.

## 13. Reminder threshold/config issues found
- No issue found. `LEAD_INACTIVITY_REMINDER_DAYS` is configurable and consumed by inactivity monitor.

## 14. Priority of fixes
- Critical
  - None.
- High
  - Fixed: field-executive restriction on token endpoints.
  - Fixed: missing public lead mirror assignment push.
  - Fixed: reassignment deep-link scoping to current assignee.
- Medium
  - Partial: loan status push tied to lead workflow status naming (not dedicated loan_detail mutation).
- Low
  - Expo Go runtime limitation for RN Firebase push.

## Verification table

| Feature | Required behavior | Current implementation | Status (Correct / Partial / Missing / Broken) | Files involved | Fix required |
|---|---|---|---|---|---|
| FCM token registration | Device token register/refresh/unregister | Mobile handles token lifecycle and calls backend token APIs | Correct | `apps/mobile/src/services/push-notifications.ts`, `apps/api/src/routes/notifications.ts`, `apps/api/src/services/notification.service.ts` | Done |
| Token endpoint role restriction | Only field executives should use mobile push token flow | Backend now restricts token endpoints with `allowRoles("FIELD_EXECUTIVE")` | Correct | `apps/api/src/routes/notifications.ts` | Done |
| New lead assigned (authenticated lead create) | Assigned executive should receive push | Trigger exists after lead creation | Correct | `apps/api/src/routes/leads.ts`, `apps/api/src/services/notification.service.ts` | No |
| New lead assigned (public lead mirrored) | Assigned executive should receive push | Trigger now added in mirror flow | Correct | `apps/api/src/services/public-lead-submission.service.ts`, `apps/api/src/services/notification.service.ts` | Done |
| Reassignment scoping | Only relevant currently assigned executive gets actionable lead push | Reassignment now sends assignment push only to new assignee | Correct | `apps/api/src/routes/leads.ts` | Done |
| Lead status updated by admin/manager | Assigned executive gets status update push | Trigger exists and checks actor role + assignee | Correct | `apps/api/src/routes/leads.ts`, `apps/api/src/services/notification.service.ts` | No |
| UTR rejected | Assigned executive gets retry push | Trigger exists; payload minimized | Correct | `apps/api/src/routes/payments.ts` | Done |
| Document rejected / re-upload | Assigned executive gets re-upload push | Trigger exists; metadata minimized | Correct | `apps/api/src/routes/documents.ts` | Done |
| Inactivity reminder | Remind assigned executive after configurable inactivity days | Scheduler uses `LEAD_INACTIVITY_REMINDER_DAYS` with dedupe | Correct | `apps/api/src/services/sla-overdue.service.ts`, `apps/api/src/config/env.ts` | No |
| Loan status update | Push on loan status updates for executive leads | Implemented via lead-status transitions whose status name includes `"loan"` | Partial | `apps/api/src/routes/leads.ts`, `apps/api/src/services/notification.service.ts` | Optional medium enhancement |
| Foreground/background/quit handling | Receive and process push across app states | Foreground/open/initial/background handlers registered | Correct | `apps/mobile/src/services/push-notifications.ts`, `apps/mobile/index.js` | No |
| Deep-link to lead detail | Tap should open lead detail context | Navigates to `LeadDetail` via payload `leadId`; backend access control applies | Correct | `apps/mobile/src/App.tsx`, `apps/api/src/routes/leads.ts`, `apps/api/src/services/lead-access.service.ts` | No |
| Notification logs/audit | Push delivery attempts should be logged | `notification_logs` written with delivery status and attempts | Correct | `apps/api/src/services/notification.service.ts`, `apps/api/prisma/schema.prisma` | No |
