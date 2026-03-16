import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { api } from "./api";

const PUSH_TOKEN_STORAGE_KEY = "mobile.push.token.v1";

type NotificationDataMap = Record<string, string>;

type RemoteMessageLike = {
  messageId?: string;
  data?: NotificationDataMap;
  notification?: {
    title?: string | null;
    body?: string | null;
  } | null;
};

type MessagingInstanceLike = {
  requestPermission: () => Promise<number>;
  getToken: () => Promise<string>;
  onTokenRefresh: (listener: (token: string) => void | Promise<void>) => () => void;
  onMessage: (listener: (message: RemoteMessageLike) => void | Promise<void>) => () => void;
  onNotificationOpenedApp: (
    listener: (message: RemoteMessageLike) => void | Promise<void>
  ) => () => void;
  getInitialNotification: () => Promise<RemoteMessageLike | null>;
  registerDeviceForRemoteMessages?: () => Promise<void>;
  setBackgroundMessageHandler?: (
    handler: (message: RemoteMessageLike) => Promise<void>
  ) => void;
};

type MessagingFactoryLike = (() => MessagingInstanceLike) & {
  AuthorizationStatus?: {
    AUTHORIZED: number;
    PROVISIONAL: number;
  };
};

export type PushNotificationPayload = {
  leadId: string | null;
  messageId: string | null;
  type: string | null;
  title: string | null;
  body: string | null;
  data: NotificationDataMap;
};

type PushPermissionState = "granted" | "denied" | "unsupported";

export type PushInitResult = {
  available: boolean;
  permission: PushPermissionState;
  tokenRegistered: boolean;
  reason?: string;
};

type PushInitOptions = {
  onForegroundMessage?: (payload: PushNotificationPayload) => void;
  onNotificationTap?: (payload: PushNotificationPayload) => void;
};

let backgroundHandlerRegistered = false;

function loadMessagingFactory(): MessagingFactoryLike | null {
  try {
    const dynamicRequire = new Function("return require")() as (moduleId: string) => unknown;
    const loaded = dynamicRequire("@react-native-firebase/messaging") as {
      default?: unknown;
    };
    const candidate = loaded?.default ?? loaded;
    if (typeof candidate === "function") {
      return candidate as MessagingFactoryLike;
    }
    return null;
  } catch {
    return null;
  }
}

function resolveDevicePlatform() {
  if (Platform.OS === "android") return "ANDROID" as const;
  if (Platform.OS === "ios") return "IOS" as const;
  return "WEB" as const;
}

function parseLeadId(data: NotificationDataMap | undefined) {
  if (!data) return null;
  const direct = data.leadId ?? data.lead_id;
  if (typeof direct === "string" && direct.trim().length > 0) {
    return direct.trim();
  }
  const entityType = data.entityType?.trim().toLowerCase();
  if (entityType === "lead" && typeof data.entityId === "string" && data.entityId.trim().length > 0) {
    return data.entityId.trim();
  }
  return null;
}

function toPayload(message: RemoteMessageLike | null): PushNotificationPayload | null {
  if (!message) return null;
  const data = (message.data ?? {}) as NotificationDataMap;
  return {
    leadId: parseLeadId(data),
    messageId: message.messageId ?? null,
    type: typeof data.type === "string" ? data.type : null,
    title: message.notification?.title ?? (typeof data.title === "string" ? data.title : null),
    body: message.notification?.body ?? (typeof data.body === "string" ? data.body : null),
    data
  };
}

function hasPushPermission(status: number, factory: MessagingFactoryLike) {
  const auth = factory.AuthorizationStatus;
  if (auth) {
    return status === auth.AUTHORIZED || status === auth.PROVISIONAL;
  }
  return status > 0;
}

async function saveStoredPushToken(token: string) {
  await AsyncStorage.setItem(PUSH_TOKEN_STORAGE_KEY, token);
}

export async function clearStoredPushToken() {
  await AsyncStorage.removeItem(PUSH_TOKEN_STORAGE_KEY);
}

async function registerPushTokenWithBackend(token: string) {
  await api.post("/api/notifications/device-token", {
    token,
    platform: resolveDevicePlatform(),
    deviceId: null,
    appVersion: null
  });
}

async function registerTokenAndPersist(token: string) {
  await registerPushTokenWithBackend(token);
  await saveStoredPushToken(token);
}

export async function unregisterCurrentPushToken() {
  const token = await AsyncStorage.getItem(PUSH_TOKEN_STORAGE_KEY);
  if (!token) {
    return;
  }

  try {
    await api.delete("/api/notifications/device-token", {
      data: { token }
    });
  } catch {
    // Ignore API failures during logout/session teardown.
  } finally {
    await clearStoredPushToken();
  }
}

export function registerBackgroundPushHandler() {
  if (backgroundHandlerRegistered) {
    return;
  }

  const messagingFactory = loadMessagingFactory();
  if (!messagingFactory) {
    return;
  }

  try {
    const messaging = messagingFactory();
    messaging.setBackgroundMessageHandler?.(async () => {
      // Background messages are handled by OS tray + open handlers in app lifecycle.
    });
    backgroundHandlerRegistered = true;
  } catch {
    // Ignore optional setup failures in unsupported runtimes.
  }
}

export async function initializePushNotifications(
  options: PushInitOptions = {}
): Promise<{ teardown: () => void; result: PushInitResult }> {
  const messagingFactory = loadMessagingFactory();
  if (!messagingFactory) {
    return {
      teardown: () => {},
      result: {
        available: false,
        permission: "unsupported",
        tokenRegistered: false,
        reason: "RN_FIREBASE_MESSAGING_UNAVAILABLE"
      }
    };
  }

  const messaging = messagingFactory();
  const unsubscribers: Array<() => void> = [];

  try {
    if (messaging.registerDeviceForRemoteMessages) {
      await messaging.registerDeviceForRemoteMessages();
    }

    const permissionStatus = await messaging.requestPermission();
    const granted = hasPushPermission(permissionStatus, messagingFactory);
    if (!granted) {
      return {
        teardown: () => {},
        result: {
          available: true,
          permission: "denied",
          tokenRegistered: false,
          reason: "PUSH_PERMISSION_DENIED"
        }
      };
    }

    const token = await messaging.getToken();
    let tokenRegistered = false;
    try {
      await registerTokenAndPersist(token);
      tokenRegistered = true;
    } catch {
      tokenRegistered = false;
    }

    unsubscribers.push(
      messaging.onTokenRefresh((nextToken) => {
        void registerTokenAndPersist(nextToken).catch(() => {
          // Keep app running; registration will retry on next app open.
        });
      })
    );

    unsubscribers.push(
      messaging.onMessage((message) => {
        const payload = toPayload(message);
        if (!payload) return;
        options.onForegroundMessage?.(payload);
      })
    );

    unsubscribers.push(
      messaging.onNotificationOpenedApp((message) => {
        const payload = toPayload(message);
        if (!payload) return;
        options.onNotificationTap?.(payload);
      })
    );

    const initialMessage = await messaging.getInitialNotification();
    const initialPayload = toPayload(initialMessage);
    if (initialPayload) {
      options.onNotificationTap?.(initialPayload);
    }

    return {
      teardown: () => {
        for (const unsubscribe of unsubscribers) {
          try {
            unsubscribe();
          } catch {
            // Ignore cleanup failures.
          }
        }
      },
      result: {
        available: true,
        permission: "granted",
        tokenRegistered,
        reason: tokenRegistered ? undefined : "DEVICE_TOKEN_REGISTRATION_FAILED"
      }
    };
  } catch {
    return {
      teardown: () => {
        for (const unsubscribe of unsubscribers) {
          try {
            unsubscribe();
          } catch {
            // Ignore cleanup failures.
          }
        }
      },
      result: {
        available: true,
        permission: "unsupported",
        tokenRegistered: false,
        reason: "PUSH_INIT_FAILED"
      }
    };
  }
}
