# Solar Lead Management System

Production-style monorepo for a Solar Panel Installation Lead Management System.

## Tech Stack
- Web Admin + Landing: Next.js, Tailwind CSS, React Hook Form + Zod, Axios/SWR, Recharts, Firebase client
- Backend API: Node.js 20+, Express, Supabase Auth, PostgreSQL (Supabase), Redis, BullMQ, Supabase Storage signed URL flow
- Mobile App: Expo (React Native), React Navigation, Zustand, React Hook Form, AsyncStorage offline queue, document/image picker, maps, biometric unlock
- Shared package: `@solar/shared` (types, constants, schemas)

## Monorepo Structure
```txt
.
├─ apps/
│  ├─ api/        # Express backend (Supabase Auth + data services)
│  ├─ web/        # Next.js admin + public landing
│  └─ mobile/     # Expo mobile app
├─ packages/
│  └─ shared/     # shared TS types + zod schemas
├─ docs/
│  └─ database-er-diagram.mmd
├─ scripts/       # helper start scripts
└─ README.md
```

## Core Product Behavior
- JWT auth with HTTP-only cookies
  - access token: 15 minutes
  - refresh token: 7 days
- RBAC roles:
  - Super Admin
  - Admin
  - District Manager
  - Field Executive
- Consistent API response envelope:
  - `{ success, data, message, error, pagination }`
- Lead workflow graph with allowed transitions only
- Auto-assignment engine:
  - assign to active executive with lowest active non-terminal leads
  - fallback to district manager + admin alert when no executive available
- Supabase Storage document upload via signed URLs
- Offline queue in mobile for lead/doc submission and retry on reconnect
- Audit logging for auth and user actions

## Prerequisites
- Node.js `>=20`
- pnpm `>=9`
- PostgreSQL (Supabase Postgres is supported)
- Redis (`localhost:6379` by default)
- Expo Go / Android Studio (for mobile)

## 1) Install Dependencies
```bash
pnpm install
```

## 2) Environment Setup

### API env
Copy:
- `apps/api/.env.example` -> `apps/api/.env`

Required keys to verify in `apps/api/.env`:
- `PORT`
- `DATABASE_URL`
- `DIRECT_URL`
- `REDIS_URL`
- `JWT_ACCESS_SECRET`
- `JWT_REFRESH_SECRET`
- `WEB_ORIGIN` (must include your web origin, e.g. `http://localhost:3200`)
- Supabase keys (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`)
- Firebase admin keys (`FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`)
- Seed admin keys (`SEED_SUPER_ADMIN_*`)

### Web env
Copy:
- `apps/web/.env.example` -> `apps/web/.env.local`

Required keys:
- `NEXT_PUBLIC_API_BASE_URL` (e.g. `http://localhost:4000`)
- Firebase public keys
- `NEXT_PUBLIC_RECAPTCHA_SITE_KEY`

### Mobile env
Copy:
- `apps/mobile/.env.example` -> `apps/mobile/.env`

Required keys:
- `EXPO_PUBLIC_API_BASE_URL`
  - Android emulator: `http://10.0.2.2:4000`
  - iOS simulator: `http://localhost:4000`
  - Physical device: `http://<YOUR_LAN_IP>:4000`
- Firebase public keys
- Optional UPI fields:
  - `EXPO_PUBLIC_COMPANY_UPI_QR_URL`
  - `EXPO_PUBLIC_COMPANY_UPI_ID`
  - `EXPO_PUBLIC_COMPANY_UPI_NAME`

## 3) Database (Supabase Postgres)
Run from repo root:
```bash
pnpm --filter @solar/api build
```

Notes:
- Existing application tables include:
  - users, districts, user_district_assignments, lead_statuses, lead_status_transitions, leads,
    lead_status_history, customer_details, documents, payments, notification_templates,
    notification_logs, loan_details, audit_logs, user_device_tokens

## Storage
Storage:
Supabase Storage

Files uploaded to:
`documents` bucket

Setup instructions:
1. Open Supabase dashboard
2. Go to Storage
3. Create bucket named `documents`
4. Set public access if needed

Manual setup path:
Supabase Dashboard -> Storage -> Create bucket -> `documents`

Required storage environment variables:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

## 4) Run the Project (Local)
Use 3 terminals:

Terminal 1 (API)
```bash
pnpm --filter @solar/api dev
```

Terminal 2 (Web on port 3200)
```bash
pnpm --filter @solar/web dev -p 3200
```

Terminal 3 (Mobile)
```bash
pnpm --filter @solar/mobile dev -- --tunnel
```

Default local URLs:
- Web: `http://localhost:3200`
- API: `http://localhost:4000`
- API health: `http://localhost:4000/health`
- Metro status: `http://localhost:8081/status`

## Detached Start Helpers (Windows)
Available helper scripts in `scripts/`:
- `start-api.ps1`
- `start-web.ps1`
- `start-mobile.ps1`
- `start-api-detached.cjs`
- `start-web-detached.cjs`
- `start-mobile-detached.cjs`

## Quality Commands
```bash
pnpm lint
pnpm typecheck
pnpm --filter @solar/api build
pnpm --filter @solar/web build
pnpm --filter @solar/mobile typecheck
```

## API Surface (High-Level)
- Auth:
  - `/api/auth/login`
  - `/api/auth/refresh`
  - `/api/auth/logout`
  - `/api/auth/me`
  - `/api/auth/change-password`
- Public:
  - `/public/districts`
  - `/public/leads`
  - `/public/leads/duplicate-check`
- Protected:
  - `/api/dashboard`
  - `/api/users`
  - `/api/districts`
  - `/api/lead-statuses`
  - `/api/leads`
  - `/api/payments`
  - `/api/documents`
  - `/api/notifications`

## API Response Envelope
```json
{
  "success": true,
  "data": {},
  "message": "OK",
  "error": null,
  "pagination": null
}
```

## Document Upload Flow
1. Request pre-signed URL from API
2. Upload file directly to Supabase Storage from client
3. Call complete endpoint to persist metadata
4. Review/verify/reject from admin queue

## Database ER Diagram
- Mermaid ERD file: `docs/database-er-diagram.mmd`
- Prisma schema: `apps/api/prisma/schema.prisma`

## Deployment Notes
See `DEVOPS.md` for target deployment architecture:
- Web: Vercel
- API: AWS ECS/EC2
- DB: RDS PostgreSQL
- Cache/Queue: ElastiCache Redis
- Files: Supabase Storage (`documents` bucket)
- Monitoring: CloudWatch + Sentry

## Render Deployment Checklist (Web + API)
- API service root directory: `apps/api`
- API build command: `pnpm install --frozen-lockfile && pnpm build`
- API start command: `pnpm start`
- API required env:
  - `NODE_ENV=production`
  - `PORT=10000` (or use Render default)
  - `SUPABASE_URL`
  - `SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` (if still used by legacy modules)
  - `SEED_SUPER_ADMIN_PASSWORD` (+ optional `SEED_SUPER_ADMIN_*`)
- Web service root directory: `apps/web`
- Web build command: `pnpm install --frozen-lockfile && pnpm build`
- Web start command: `pnpm start`
- Web env:
  - `NEXT_PUBLIC_API_BASE_URL=https://<your-api-service>.onrender.com`
- Verify in browser network tab:
  - `POST /api/auth/login` returns `200`
  - response has both `Set-Cookie` headers (`accessToken`, `refreshToken`)
  - next `GET /api/auth/me` returns `200` (not `401`)

## Troubleshooting
- CORS blocked from web:
  - ensure frontend calls the correct API URL in `NEXT_PUBLIC_API_BASE_URL`
- Web login `ERR_CONNECTION_REFUSED`:
  - API is not running on `:4000`
- Auth profile not found (`APP_PROFILE_NOT_FOUND`):
  - run `pnpm --filter @solar/api auth:reset-super-admin` or use SQL in `apps/api/sql/001_supabase_auth_backfill.sql`
- Expo cannot connect to Metro:
  - ensure Metro running, same Wi-Fi, and correct `EXPO_PUBLIC_API_BASE_URL`
- Android SDK/adb not found:
  - set `ANDROID_HOME` and add `platform-tools` to `PATH`
- Expo SDK mismatch:
  - Expo Go version must match project SDK (currently SDK 51)

## Security Checklist
- Never commit real secrets in env files
- Rotate JWT/Firebase/Supabase keys if exposed
- Keep `SUPABASE_SERVICE_ROLE_KEY` only on backend
- Mobile must use backend-generated signed URLs only
