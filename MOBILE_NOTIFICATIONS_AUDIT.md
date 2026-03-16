# Mobile Notifications Audit (Section 6.7)

Date: 2026-03-16  
Scope: Mobile notifications module only (FCM, token registration, triggers, deep links).

## 1. Current Mobile Notification Implementation Found in Code
- **Mobile push integration**: `apps/mobile/src/services/push-notifications.ts`
  - Dynamic `@react-native-firebase/messaging` load; requests permission; registers token; handles token refresh; listens for foreground messages and tap events; reads initial notification.
  - Stores token locally in AsyncStorage and registers/unregisters with backend `/api/notifications/device-token`.
- **Local inbox + unread state**: `apps/mobile/src/store/notification-store.ts`
  - AsyncStorage persistence for recent pushes; unread counter; mark-all-read.
- **Notifications UI**:
  - `apps/mobile/src/screens/NotificationsScreen.tsx` displays server feed + recent device pushes.
  - `apps/mobile/src/screens/HomeScreen.tsx` shows recent notifications from dashboard summary.
  - `apps/mobile/src/App.tsx` tab badge for unread count + push availability banner.
- **Deep link navigation**:
  - `apps/mobile/src/App.tsx` uses `openLeadFromPush` to navigate to Lead Detail when payload includes `leadId`.
  - App scheme configured as `solarleadmobile://` in `apps/mobile/app.json`.

## 2. Required Features Already Present
- FCM token registration to backend.
- Foreground and tap handlers (`onMessage`, `onNotificationOpenedApp`, `getInitialNotification`).
- Deep-linking to lead detail on notification tap (via `leadId`).
- Notifications for required events:
  - New lead assigned (lead creation + auto-assignment).
  - Lead status updated by admin/manager.
  - UTR rejected.
  - Document rejected.
  - Inactivity reminders (configurable days).
  - Loan status update (via lead status transitions containing “loan”).
- Notification logs recorded in `notification_logs`.
- Reminder threshold configurable via `LEAD_INACTIVITY_REMINDER_DAYS`.
- Assigned lead scoping enforced at the event source (lead assigned exec used for recipients).

## 3. Partially Implemented Features
- **Expo Go limitation**: FCM is unavailable in Expo Go; push requires a dev/native build.  
  Status: Partial only for local dev (not production).  
  Impact: Low (expected by React Native Firebase + Expo).

## 4. Missing Features
- None detected for required notifications behavior.

## 5. Broken or Insecure Features
- None detected in the notification pipeline for this scope.

## 6. Backend/Schema Changes Required
- None required. `UserDeviceToken`, `NotificationLog`, and `NotificationTemplate` are already modeled in Prisma.

## 7. Mobile UI/App Changes Required
- None required for required behavior.

## 8. Env/Config Changes Required
- None required; `LEAD_INACTIVITY_REMINDER_DAYS` already in `.env.example`.

## 9. Security and Authorization Issues Found
- None within this module. Lead scoping enforced by assignment-based targeting and API guards.

## 10. FCM Token Registration Issues Found
- None. Tokens are registered, refreshed, and removed on logout.

## 11. Trigger/Event Coverage Issues Found
- None. All specified events are triggered by existing routes/services.

## 12. Deep-Link Handling Issues Found
- None. Lead detail deep link is handled via payload `leadId` and navigation ref.

## 13. Reminder Threshold/Config Issues Found
- None. `LEAD_INACTIVITY_REMINDER_DAYS` is configurable and used.

## 14. Priority of Fixes
- **Critical**: None
- **High**: None
- **Medium**: None
- **Low**: Expo Go does not support RN Firebase push; use dev/native build for real push.

---

## Verification Table

| Feature | Required behavior | Current implementation | Status | Files involved | Fix required |
|---|---|---|---|---|---|
| FCM token registration | Register/refresh device token with backend | Mobile registers to `/api/notifications/device-token`, refresh handled | Correct | `apps/mobile/src/services/push-notifications.ts`, `apps/api/src/routes/notifications.ts`, `apps/api/src/services/notification.service.ts` | No |
| Foreground/Background handling | Receive notifications in foreground/background/quit | `onMessage`, `onNotificationOpenedApp`, `getInitialNotification`, background handler registered | Correct | `apps/mobile/src/services/push-notifications.ts`, `apps/mobile/index.js` | No |
| Deep linking | Tap opens lead detail | `openLeadFromPush` navigates to Lead Detail when `leadId` present | Correct | `apps/mobile/src/App.tsx` | No |
| New lead assigned | Push sent to assigned executive | Triggered on lead creation with auto-assignment | Correct | `apps/api/src/routes/leads.ts`, `apps/api/src/services/notification.service.ts` | No |
| Lead status updated | Push to executive when admin/manager updates | Triggered on lead transition by admin/manager | Correct | `apps/api/src/routes/leads.ts`, `apps/api/src/services/notification.service.ts` | No |
| UTR rejected | Push to executive for rejected payment | Triggered in payments route | Correct | `apps/api/src/routes/payments.ts` | No |
| Document rejected | Push to executive for rejected document | Triggered in documents route | Correct | `apps/api/src/routes/documents.ts` | No |
| Inactivity reminder | Configurable days reminder | SLA monitor + env `LEAD_INACTIVITY_REMINDER_DAYS` | Correct | `apps/api/src/services/sla-overdue.service.ts`, `apps/api/src/config/env.ts` | No |
| Loan status update | Push on loan status update | Triggered on lead transition when status name contains “loan” | Correct | `apps/api/src/routes/leads.ts`, `apps/api/src/services/notification.service.ts` | No |
| Notification logs | Log delivery and status | `notification_logs` written for push | Correct | `apps/api/src/services/notification.service.ts`, `apps/api/prisma/schema.prisma` | No |
| Recent notifications UI | Recent notifications visible | Mobile home + notifications screen show feeds | Correct | `apps/mobile/src/screens/HomeScreen.tsx`, `apps/mobile/src/screens/NotificationsScreen.tsx` | No |
| Expo Go compatibility | Push works in Expo Go | Not supported for RN Firebase | Partial (dev only) | `apps/mobile/src/services/push-notifications.ts` | No (use dev build) |

