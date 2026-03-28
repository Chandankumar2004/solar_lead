# Solar Lead Management System

Production-focused monorepo for internal solar lead lifecycle management across web admin, mobile executive app, and a shared backend API.

## What This Repo Contains

- `apps/api`: Express + Prisma API (Supabase Postgres, Supabase Auth mapping, Redis/BullMQ, Firebase admin push, chat, reports, payments, documents).
- `apps/web`: Next.js admin portal + public lead capture.
- `apps/mobile`: Expo React Native app for field executives.
- `packages/shared`: shared TypeScript contracts and utilities.
- `scripts`: helper scripts for local development and utilities.

## Monorepo Structure

```txt
.
├─ apps/
│  ├─ api/
│  ├─ web/
│  └─ mobile/
├─ packages/
│  └─ shared/
├─ scripts/
├─ docs/
├─ Dockerfile
├─ railway.json
└─ README.md
```

## Core Functional Areas

- Role-based access control (`SUPER_ADMIN`, `ADMIN`, `MANAGER`, `EXECUTIVE`)
- District-scoped lead management workflow
- Public lead capture with anti-spam validation
- Lead status transitions and SLA/overdue handling
- Document upload/review pipeline with Supabase Storage
- Payment tracking + Razorpay webhook ingestion
- Internal notifications + queue processing
- Internal chat (conversation, message, unread/read)
- Audit log trail for sensitive operations

## Tech Stack

- **API**: Node.js 20+, Express, Prisma, PostgreSQL, Redis/BullMQ, Supabase, Firebase Admin, Zod
- **Web**: Next.js 14, React 18, Tailwind, RHF + Zod, Zustand, Axios/SWR
- **Mobile**: Expo SDK 51, React Native 0.74, React Navigation, Zustand, AsyncStorage, Firebase messaging
- **Shared**: TypeScript workspace package

## Prerequisites

- Node.js `20.x`
- pnpm `9.x`
- PostgreSQL (Supabase recommended)
- Redis (recommended for worker/notifications)
- Expo Go / Android Studio / Xcode tools (for mobile)

## Setup

### 1) Install dependencies

```bash
pnpm install
```

### 2) Configure environment files

Copy these files and fill real values:

- `apps/api/.env.example` -> `apps/api/.env`
- `apps/web/.env.example` -> `apps/web/.env.local`
- `apps/mobile/.env.example` -> `apps/mobile/.env`

### 3) API env essentials (must be valid)

Minimum keys for API startup:

- `NODE_ENV`
- `PORT`
- `DATABASE_URL`
- `DIRECT_URL` (recommended for migrations/introspection)
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`
- `WEB_ORIGIN` (and/or `CORS_ORIGIN`, `FRONTEND_URL`)

Optional but commonly required by features:

- `REDIS_URL`
- payment vars (`RAZORPAY_*`, `PAYMENT_*`)
- communication vars (`SMS_PROVIDER`, `EMAIL_PROVIDER`, `WHATSAPP_PROVIDER`, related keys)

### 4) Web env essentials

- `NEXT_PUBLIC_API_BASE_URL` (local usually `http://localhost:4000`)
- Firebase web public keys
- reCAPTCHA site key(s) if enabled

### 5) Mobile env essentials

- `EXPO_PUBLIC_API_BASE_URL`
  - Android emulator: `http://10.0.2.2:4000`
  - iOS simulator: `http://localhost:4000`
  - Physical device: `http://<LAN_IP>:4000`
- Firebase mobile public keys

## Run Locally

Use three terminals:

### API

```bash
pnpm --filter @solar/api dev
```

### Web

```bash
pnpm --filter @solar/web dev
```

Optional port override:

```bash
pnpm --filter @solar/web dev -- -p 3200
```

### Mobile

```bash
pnpm --filter @solar/mobile dev
```

If tunnel is needed:

```bash
pnpm --filter @solar/mobile dev -- --tunnel
```

## Useful Root Scripts

```bash
pnpm dev:api
pnpm dev:api:worker
pnpm dev:web
pnpm dev:mobile
pnpm build:api
pnpm build:web
pnpm build:all
pnpm lint
pnpm typecheck
pnpm prisma:migrate:deploy
```

## Database and Migrations (Prisma)

This repo uses **Prisma migrations** as the source of truth.

Common commands:

```bash
pnpm --filter @solar/api exec prisma validate --schema prisma/schema.prisma
pnpm --filter @solar/api exec prisma migrate status --schema prisma/schema.prisma
pnpm --filter @solar/api exec prisma migrate deploy --schema prisma/schema.prisma
pnpm --filter @solar/api exec prisma db pull --print --schema prisma/schema.prisma
```

## API Endpoint Groups (High Level)

- Auth: `/api/auth/*`
- Public lead endpoints: `/public/*` and `/api/public/*`
- Users/districts/dashboard: `/api/users`, `/api/districts`, `/api/dashboard`
- Lead operations: `/api/leads`, `/api/lead-statuses`, `/api/leads/:leadId/documents`
- Documents/uploads: `/api/documents`, `/api/uploads`
- Payments + webhook: `/api/payments`, `/api/payments/webhook/razorpay`
- Notifications: `/api/notifications`
- Chat: `/api/chat`
- Reports: `/api/reports`
- Health: `/health`, `/api/health`

Standard API response envelope:

```json
{
  "success": true,
  "data": {},
  "message": "OK",
  "error": null,
  "pagination": null
}
```

## Deployment

### API (Railway/Dockerfile path)

This repo ships with:

- `Dockerfile` that builds `@solar/api` (and shared package)
- `railway.json` with health check at `/health`

Typical API deploy flow:

1. Set all required API env vars in Railway/project settings.
2. Deploy from repo root using Dockerfile.
3. Run Prisma migrations in release/deploy step:

```bash
pnpm --filter @solar/api prisma:migrate:deploy
```

4. Start API:

```bash
node apps/api/dist/index.js
```

### Web

- `vercel.json` is configured for `apps/web`.
- Web build command: `pnpm --filter @solar/web build`.

### Mobile

- Built and distributed via Expo workflow.
- Ensure `EXPO_PUBLIC_API_BASE_URL` points to deployed API base URL.

## CI

GitHub Actions workflow `.github/workflows/ci.yml` currently runs:

- API build
- Web build
- Mobile typecheck

## Troubleshooting

- **CORS errors on web**: verify `WEB_ORIGIN`/`CORS_ORIGIN`/`FRONTEND_URL` in API env.
- **Web cannot reach API**: verify `NEXT_PUBLIC_API_BASE_URL`.
- **Mobile cannot reach API**: verify emulator/device base URL rules (`10.0.2.2` for Android emulator).
- **Tunnel fails (`ngrok tunnel took too long`)**: start mobile without tunnel or retry with stable network.
- **Prisma database errors**: run `prisma validate`, then `prisma migrate status`.
- **401 loops**: check auth cookies, refresh route, and API base URL consistency.

## Security Notes

- Never commit real secrets.
- Keep `SUPABASE_SERVICE_ROLE_KEY` server-side only.
- Rotate leaked JWT/Firebase/Supabase/provider keys immediately.
- Use least-privilege DB and storage policies.
- Keep chat and internal APIs behind authenticated RBAC routes only.
