"use client";

import { useEffect } from "react";
import { getMessaging, getToken, isSupported, onMessage, type MessagePayload } from "firebase/messaging";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { firebaseApp, firebaseConfig } from "@/lib/firebase";

const WEB_PUSH_TOKEN_STORAGE_KEY = "web.push.fcm.token.v1";
const FIREBASE_VAPID_KEY = (process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY ?? "").trim();

function readStoredToken() {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(WEB_PUSH_TOKEN_STORAGE_KEY);
}

function writeStoredToken(token: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(WEB_PUSH_TOKEN_STORAGE_KEY, token);
}

function clearStoredToken() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(WEB_PUSH_TOKEN_STORAGE_KEY);
}

async function removeTokenFromBackend(token: string) {
  await api.delete("/api/notifications/device-token", {
    data: { token }
  });
}

function buildServiceWorkerUrl() {
  const params = new URLSearchParams({
    apiKey: firebaseConfig.apiKey ?? "",
    authDomain: firebaseConfig.authDomain ?? "",
    projectId: firebaseConfig.projectId ?? "",
    storageBucket: firebaseConfig.storageBucket ?? "",
    messagingSenderId: firebaseConfig.messagingSenderId ?? "",
    appId: firebaseConfig.appId ?? ""
  });
  return `/firebase-messaging-sw.js?${params.toString()}`;
}

function resolveLeadHref(payload: MessagePayload) {
  const data = payload.data ?? {};
  const leadId =
    data.leadId ??
    data.lead_id ??
    (data.entityType === "lead" ? data.entityId : null) ??
    null;
  if (!leadId || typeof leadId !== "string" || leadId.trim().length === 0) {
    return "/notifications";
  }
  return `/leads/${leadId.trim()}`;
}

function showForegroundBrowserNotification(payload: MessagePayload) {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return;
  }
  if (Notification.permission !== "granted") {
    return;
  }

  const title = payload.notification?.title ?? payload.data?.title ?? "Solar Lead update";
  const body = payload.notification?.body ?? payload.data?.body ?? "";
  const href = resolveLeadHref(payload);

  const browserNotification = new Notification(title, {
    body,
    tag: payload.messageId ?? undefined
  });

  browserNotification.onclick = () => {
    window.focus();
    window.location.assign(href);
  };
}

function resolveDeviceId() {
  if (typeof navigator === "undefined") return null;
  const value = navigator.userAgent.trim();
  if (!value) return null;
  return value.slice(0, 120);
}

export function WebPushRegistrar() {
  const user = useAuthStore((state) => state.user);
  const userId = user?.id ?? null;
  const userRole = user?.role ?? null;

  useEffect(() => {
    let active = true;
    let unsubscribeOnMessage: (() => void) | null = null;
    let visibilityHandler: (() => void) | null = null;
    let refreshTimer: number | null = null;

    const register = async () => {
      if (typeof window === "undefined") {
        return;
      }

      if (!userId) {
        const stored = readStoredToken();
        if (stored) {
          try {
            await removeTokenFromBackend(stored);
          } catch {
            // Ignore logout/unauthed cleanup failures.
          }
        }
        clearStoredToken();
        return;
      }

      if (userRole === "FIELD_EXECUTIVE") {
        return;
      }

      if (!("Notification" in window) || !("serviceWorker" in navigator)) {
        return;
      }

      if (!FIREBASE_VAPID_KEY) {
        console.warn("web_push_not_configured", {
          reason: "NEXT_PUBLIC_FIREBASE_VAPID_KEY_MISSING"
        });
        return;
      }

      const messagingSupported = await isSupported().catch(() => false);
      if (!messagingSupported) {
        return;
      }

      let permission = Notification.permission;
      if (permission === "default") {
        permission = await Notification.requestPermission();
      }
      if (permission !== "granted") {
        return;
      }

      const serviceWorkerRegistration = await navigator.serviceWorker.register(
        buildServiceWorkerUrl()
      );

      const messaging = getMessaging(firebaseApp);
      const token = await getToken(messaging, {
        vapidKey: FIREBASE_VAPID_KEY,
        serviceWorkerRegistration
      });
      if (!token) {
        return;
      }

      const previousToken = readStoredToken();
      if (previousToken && previousToken !== token) {
        try {
          await removeTokenFromBackend(previousToken);
        } catch {
          // Ignore stale-token cleanup failures.
        }
      }

      await api.post("/api/notifications/device-token", {
        token,
        platform: "WEB",
        deviceId: resolveDeviceId(),
        appVersion: null
      });
      writeStoredToken(token);

      const refreshTokenSilently = async () => {
        const refreshedToken = await getToken(messaging, {
          vapidKey: FIREBASE_VAPID_KEY,
          serviceWorkerRegistration
        });
        if (!refreshedToken) {
          return;
        }

        const currentStoredToken = readStoredToken();
        if (currentStoredToken === refreshedToken) {
          return;
        }

        if (currentStoredToken) {
          try {
            await removeTokenFromBackend(currentStoredToken);
          } catch {
            // Ignore cleanup failures for stale browser token.
          }
        }

        await api.post("/api/notifications/device-token", {
          token: refreshedToken,
          platform: "WEB",
          deviceId: resolveDeviceId(),
          appVersion: null
        });
        writeStoredToken(refreshedToken);
      };

      visibilityHandler = () => {
        if (document.visibilityState !== "visible") return;
        void refreshTokenSilently().catch(() => {
          // Ignore silent refresh failures; next cycle will retry.
        });
      };
      document.addEventListener("visibilitychange", visibilityHandler);

      refreshTimer = window.setInterval(() => {
        void refreshTokenSilently().catch(() => {
          // Ignore silent refresh failures; next cycle will retry.
        });
      }, 10 * 60 * 1000);

      unsubscribeOnMessage = onMessage(messaging, (payload) => {
        if (!active) return;
        showForegroundBrowserNotification(payload);
      });
    };

    void register().catch((error) => {
      console.error("web_push_registration_failed", { error });
    });

    return () => {
      active = false;
      if (unsubscribeOnMessage) {
        unsubscribeOnMessage();
      }
      if (visibilityHandler) {
        document.removeEventListener("visibilitychange", visibilityHandler);
      }
      if (refreshTimer !== null) {
        window.clearInterval(refreshTimer);
      }
    };
  }, [userId, userRole]);

  return null;
}
