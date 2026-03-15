# Notifications and Reports Audit (Sections 5.10, 5.11)

## 1) Current notification template implementation found
- Backend template CRUD exists at `apps/api/src/routes/notifications.ts`:
  - `GET /api/notifications/templates`
  - `POST /api/notifications/templates`
  - `PATCH /api/notifications/templates/:id`
  - `DELETE /api/notifications/templates/:id`
  - `POST /api/notifications/templates/:id/render`
- Template model exists in Prisma: `NotificationTemplate` in `apps/api/prisma/schema.prisma`.
- Safe variable rendering exists: `renderTemplateVariables()` in `apps/api/src/services/notification.service.ts`.
- Template association to workflow exists through lead status config:
  - `LeadStatus.notificationTemplateId`, `LeadStatus.notifyCustomer`
  - configuration in `apps/web/src/app/(portal)/workflow/page.tsx`.

## 2) Current notification log implementation found
- Backend logs API exists at `apps/api/src/routes/notifications.ts`:
  - `GET /api/notifications/logs`
  - `GET /api/notifications/logs/:id`
- Log model exists in Prisma: `NotificationLog`.
- Delivery lifecycle is tracked:
  - queued/retrying/sent/failed updates via `logNotification()` and `updateNotificationLogDelivery()` in `apps/api/src/services/notification.service.ts`.
- Customer sends are queued and retried:
  - Bull/worker integration in `notification.worker` via `enqueueCustomerNotificationJob`.

## 3) Current internal notification implementation found
- Internal push notifications implemented using:
  - Firestore document feed (`internal_notifications`)
  - Firebase Cloud Messaging multicast for device tokens
  - Device token APIs in `/api/notifications/device-token`.
- UI real-time component exists:
  - `apps/web/src/components/RealtimeNotifications.tsx`.
- Trigger points already present:
  - new lead, document pending review, UTR pending verification, overdue lead.

## 4) Current reports and analytics implementation found
- Dashboard summary API exists with real data aggregation:
  - `GET /api/dashboard/summary` in `apps/api/src/routes/dashboard.ts`
  - includes totals, status, district, installation type, field executive metrics, loan summary, recent activity.
- Dashboard UI exists:
  - `apps/web/src/app/(portal)/dashboard/page.tsx`
  - charts in `apps/web/src/components/DashboardCharts.tsx`.
- Missing dedicated reports module and export APIs for section 5.11.

## 5) Features already present
- Notification template CRUD with validation.
- Safe variable substitution with fallback empty string for unknown variables.
- Template rendering preview endpoint.
- Notification logs persisted with delivery status, channel, template, timestamp, lead linkage.
- Internal near-real-time notifications via Firestore + FCM.
- Overdue lead notifications and SLA monitoring.
- Core analytics aggregation for dashboard.

## 6) Partially implemented features
- Notification log filtering:
  - backend supports advanced filters, UI exposes only subset.
- Role/scoping behavior for notification logs:
  - admin works; district manager scoped access not fully exposed.
- Reports and analytics:
  - core metrics exist in dashboard, but dedicated report endpoints and exports are missing.

## 7) Missing features
- Dedicated 5.11 reports module endpoints:
  - Lead Source, Lead Pipeline, District Performance, Field Executive Performance, Revenue, Loan Pipeline, Customer Communication.
- CSV export support for these reports.
- PDF export support for these reports.
- Dedicated admin portal reports page with filterable report sections and export controls.

## 8) Broken or insecure features
- Notifications UI allowed internal publish form visibility to non-template managers in some role paths (UX/security mismatch vs backend permission).
- District manager could not access scoped notification logs from portal UI (required scoped role behavior gap).

## 9) Backend/schema changes required
- No schema change required for core 5.10/5.11 delivery.
- Required backend route/service changes:
  - add reports aggregation endpoints
  - add report export endpoints (CSV/PDF)
  - align notification logs access for district manager with backend scoping.

## 10) Frontend/UI changes required
- Add dedicated reports page in portal with:
  - date/district/executive/channel filters
  - 7 report sections
  - CSV/PDF export buttons.
- Update navigation/rbac for reports route.
- Expand notifications logs filters in UI and adjust role-aware tabs.

## 11) Env/config changes required
- No mandatory new env vars required for this implementation.
- Existing providers and Firebase/Redis config remain as-is.

## 12) Security and authorization issues found
- Reports route missing (hence no explicit RBAC path for section 5.11).
- Notification logs lacked district-manager scoped read flow in portal.
- Internal publish action visibility should match backend authorization.

## 13) Notification delivery/provider integration issues found
- SMS (MSG91) and email providers are integrated.
- WhatsApp providers for Twilio/Interakt/WATI currently placeholder-adapters (existing behavior), with logging; delivery outcome still recorded.

## 14) Real-time/internal notification issues found
- Real-time feed works via Firestore listener.
- Read/unread state exists in Firestore payload but no complete management UI in portal (medium priority).

## 15) Reporting/export accuracy issues found
- No dedicated report endpoints and exports before fix.
- Dashboard-only analytics could not satisfy full 5.11 reporting/export requirements.

## 16) Priority of fixes
- Critical:
  - Implement dedicated reports APIs and portal page.
  - Implement CSV/PDF exports for all required reports.
- High:
  - Add district-manager scoped notification logs access and UI path.
  - Align notification internal publish UI with role capability.
  - Improve notification logs filters in UI (date/lead/template/channel/status/search).
- Medium:
  - Add read/unread management UI for internal feed.
  - Enhance provider webhook-driven delivery reconciliation.
- Low:
  - Further chart customization and cached heavy report precomputation.

## Verification Table
| Feature | Required behavior | Current implementation | Status | Files involved | Fix required |
|---|---|---|---|---|---|
| Template CRUD | Manage SMS/Email/WhatsApp templates | Implemented | Correct | `apps/api/src/routes/notifications.ts`, `apps/web/src/app/(portal)/notifications/page.tsx` | No |
| Template variables | Dynamic variable rendering and safe fallback | Implemented in render utility | Correct | `apps/api/src/services/notification.service.ts` | No |
| Template ↔ status association | Associate template with lead status workflow | Implemented via `LeadStatus.notificationTemplateId` | Correct | `apps/api/prisma/schema.prisma`, `apps/api/src/routes/lead-statuses.ts`, `apps/web/src/app/(portal)/workflow/page.tsx` | No |
| Notification logs data | delivery/channel/template/timestamp/lead | Implemented | Correct | `apps/api/src/routes/notifications.ts`, `schema.prisma` | No |
| Notification logs filtering UI | Query/filter logs | Backend richer than UI | Partial | `apps/api/src/routes/notifications.ts`, `apps/web/src/app/(portal)/notifications/page.tsx` | Yes |
| Internal real-time feed | Near-real-time scoped notifications | Firestore + FCM + UI listener | Correct | `apps/api/src/services/notification.service.ts`, `apps/web/src/components/RealtimeNotifications.tsx` | No |
| Overdue notifications | Configurable threshold and alerts | Implemented via SLA hours/status + monitor | Partial | `apps/api/src/services/sla-overdue.service.ts`, `schema.prisma` | Optional |
| Reports module | Dedicated reports for 7 required reports | Missing | Missing | N/A | Yes |
| CSV export | Export all required reports | Missing | Missing | N/A | Yes |
| PDF export | Export all required reports | Missing | Missing | N/A | Yes |
| Reports UI | Filterable reports sections with exports | Missing | Missing | N/A | Yes |
| Reports RBAC/scoping | District manager scoped reports | Not available (reports missing) | Missing | N/A | Yes |
