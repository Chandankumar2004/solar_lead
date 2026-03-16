# Mobile Push (FCM) Dev Build Setup

Use this when push shows unavailable in Expo Go.

## Why
- This app uses `@react-native-firebase/messaging` runtime hooks.
- Expo Go does not include native Firebase Messaging integration for this project flow.
- Use a native dev build.

## 1) Install native messaging packages
From repo root:

```bash
pnpm --filter @solar/mobile add @react-native-firebase/app @react-native-firebase/messaging
```

## 2) Ensure Firebase native config is present
- Android: `google-services.json`
- iOS: `GoogleService-Info.plist`

Place files in `apps/mobile` and wire as needed for Expo prebuild/dev build.

## 3) Build native app
Android:

```bash
pnpm --filter @solar/mobile android
```

iOS:

```bash
pnpm --filter @solar/mobile ios
```

## 4) Run dev client

```bash
pnpm --filter @solar/mobile dev:client
```

## 5) Verify token registration
- Login as field executive.
- Check backend endpoint via app flow:
  - `POST /api/notifications/device-token` should be called.
- Optional API check:
  - `GET /api/notifications/device-token`

## 6) Verify deep-link open
- Send a push with `data.leadId`.
- Tap notification.
- App should open lead detail screen.
