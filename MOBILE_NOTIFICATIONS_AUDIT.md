# Mobile Notifications Audit: Section 6.7 (Pre-Fix)

## 1. Current mobile notification implementation found in code
- `apps/mobile/src/screens/NotificationsScreen.tsx`:
  - Loads notification feed from `GET /api/notifications/feed`.
  - Manual pull-to-refresh and list rendering are present.
  - No push listener integration.
- `apps/mobile/src/App.tsx`:
  - Navigation container and tabs exist.
  - No push setup lifecycle (permissions, token registration, foreground/background handlers).
  - No notification tap deep-link handling.
- `apps/mobile/src/services/firebase.ts`:
  - Firebase app initialization only.
  - No messaging integration.
- `apps/mobile/src/store/auth-store.ts`:
  - Field-executive role enforcement exists.
  - Blocked account session cleanup exists.
  - No device token register/unregister calls.

## 2. Current backend notification implementation found in code
- `apps/api/src/routes/notifications.ts`:
  - Device token APIs exist:
    - `GET /api/notifications/device-token`
    - `POST /api/notifications/device-token`
    - `DELETE /api/notifications/device-token`
  - Feed endpoint exists: `GET /api/notifications/feed`.
  - Notification log list/detail endpoints exist for admin roles.
- `apps/api/src/services/notification.service.ts`:
  - FCM send via Firebase Admin `sendEachForMulticast`.
  - Invalid token cleanup exists.
  - Notification log writing exists.
  - Trigger helpers exist for:
    - new lead assignment
    - document pending review
    - UTR pending verification
    - overdue lead alerts
- `apps/api/src/workers/notification.worker.ts`:
  - Bull queue integration for in-app and customer notification jobs.

## 3. Which required features are already present
- Device token persistence model (`UserDeviceToken`) exists.
- Notification log model (`NotificationLog`) exists.
- New lead assignment notifications are dispatched.
- UTR rejection notifications to assigned executive exist.
- Document rejection/re-upload request notifications to assigned executive exist.
- Backend auth + role infrastructure exists.

## 4. Which required features are partially implemented
- Push token lifecycle:
  - Backend token APIs exist, but mobile app does not call them.
- Notification delivery pipeline:
  - Backend FCM dispatch exists, but mobile app has no FCM handlers.
- Recent notification visibility:
  - Feed UI exists, but no unread/local push state.
- Reminder concept:
  - SLA-overdue monitor exists, but not inactivity-days reminder for field executives.

## 5. Which required features are missing
- Mobile FCM integration and permission flow in app lifecycle.
- Foreground/background/quit notification handling on mobile.
- Notification tap deep-link to lead detail screen.
- Explicit notification trigger when admin/manager changes lead status affecting executive.
- Explicit loan status update push trigger for assigned executive.
- Configurable inactivity reminder notification (days threshold).

## 6. Which required features are broken or insecure
- No major active data-exposure vulnerability found in current notification payload path.
- Functional gap: push notifications cannot work end-to-end from mobile app because token registration is not wired.
- Functional gap: deep-link navigation from notification tap is absent.

## 7. Which backend/schema changes are required
- Schema changes: **not strictly required** (existing token/log tables are sufficient).
- Backend changes required:
  - Add executive push trigger on lead status transitions by admin/manager.
  - Add loan-status update trigger for executive leads.
  - Add inactivity reminder checker with configurable days.

## 8. Which mobile UI/app changes are required
- Add mobile notification bootstrap service:
  - permission request
  - token registration
  - token refresh update
  - foreground/background/quit handlers
  - tap -> lead detail navigation
- Add small local recent push state store (optional but high-value for UX).

## 9. Which env/config changes are required
- API:
  - Add configurable inactivity threshold env (example: `LEAD_INACTIVITY_REMINDER_DAYS`).
- Mobile:
  - Add/confirm deep-link scheme in Expo config.

## 10. Security and authorization issues found
- Positive:
  - Backend `requireAuth` + role mapping exists.
  - Assigned lead scoping is already enforced in lead routes.
- Gap:
  - Missing deep-link handler means no scoped open flow exists yet from push.

## 11. FCM token registration issues found
- Mobile app currently does not register device token, so server cannot reliably push to app devices.

## 12. Trigger/event coverage issues found
- Present:
  - new lead assignment
  - UTR reject
  - document reject/re-upload request
- Missing:
  - admin/manager lead status change -> executive push
  - loan status updates -> executive push
  - inactivity-days reminder -> executive push

## 13. Deep-link handling issues found
- No deep-link mapping from push payload to `LeadDetail` route in mobile app.

## 14. Reminder threshold/config issues found
- Existing `SLA_CHECK_INTERVAL_MS` handles SLA overdue checks, not inactivity reminder by days.
- No configurable inactivity threshold env currently parsed in API env config.

## 15. Priority of fixes
- Critical:
  - Mobile token registration + push handlers + tap deep-link
  - Missing status-change executive trigger
- High:
  - Loan status update trigger
  - Configurable inactivity reminder trigger
- Medium:
  - Local unread/recent push state polish
- Low:
  - Notification settings UX improvements

## Verification Table

| Feature | Required behavior | Current implementation | Status | Files involved | Fix required |
|---|---|---|---|---|---|
| FCM integration in mobile app | Receive push in app lifecycle | Not implemented in app | Missing | `apps/mobile/src/App.tsx`, `apps/mobile/src/services/firebase.ts` | Yes |
| Notification permission flow | Request/handle permission | Not present | Missing | `apps/mobile/src` app lifecycle | Yes |
| Device token registration | Register and refresh token to backend | Backend APIs exist; mobile does not call | Partial | `apps/api/src/routes/notifications.ts`, `apps/mobile/src/*` | Yes |
| New lead assigned event | Executive notified on assignment | Implemented | Correct | `apps/api/src/services/notification.service.ts`, `apps/api/src/routes/leads.ts` | No |
| Lead status changed by admin/manager | Executive notified | Not implemented | Missing | `apps/api/src/routes/leads.ts` | Yes |
| UTR rejected event | Executive notified for retry | Implemented | Correct | `apps/api/src/routes/payments.ts` | No |
| Document rejected/re-upload event | Executive notified for re-upload | Implemented | Correct | `apps/api/src/routes/documents.ts` | No |
| Inactivity reminder | Configurable days reminder | Only SLA overdue monitor exists | Partial | `apps/api/src/services/sla-overdue.service.ts` | Yes |
| Loan status update event | Executive notified on loan updates | Not implemented explicitly | Missing | `apps/api/src/routes/leads.ts`, `apps/api/src/services/notification.service.ts` | Yes |
| Deep-link on notification tap | Open relevant lead detail | Not implemented | Missing | `apps/mobile/src/App.tsx` | Yes |
| Foreground/background/quit handlers | Handle all push states | Not implemented | Missing | `apps/mobile/src/App.tsx` | Yes |
| Payload data minimization | Avoid sensitive exposure | Metadata is minimal in existing sends | Correct | `apps/api/src/services/notification.service.ts` | No |
| Notification logs/audit | Persist delivery/log records | Implemented | Correct | `apps/api/prisma/schema.prisma`, `apps/api/src/services/notification.service.ts` | No |
