import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import type { PushNotificationPayload } from "../services/push-notifications";

const STORAGE_KEY = "mobile.push.notifications.v1";
const MAX_RECENT = 50;

export type LocalPushNotification = {
  id: string;
  leadId: string | null;
  type: string | null;
  title: string | null;
  body: string | null;
  createdAt: string;
  isRead: boolean;
};

type NotificationStoreState = {
  hydrated: boolean;
  unreadCount: number;
  recent: LocalPushNotification[];
  hydrate: () => Promise<void>;
  addForegroundNotification: (payload: PushNotificationPayload) => Promise<void>;
  addOpenedNotification: (payload: PushNotificationPayload) => Promise<void>;
  markAllRead: () => Promise<void>;
};

type PersistedState = {
  unreadCount: number;
  recent: LocalPushNotification[];
};

function toLocalNotification(
  payload: PushNotificationPayload,
  isRead: boolean
): LocalPushNotification {
  const id =
    payload.messageId ??
    `${payload.leadId ?? "none"}:${payload.type ?? "INTERNAL"}:${Date.now().toString(36)}`;
  return {
    id,
    leadId: payload.leadId,
    type: payload.type,
    title: payload.title,
    body: payload.body,
    createdAt: new Date().toISOString(),
    isRead
  };
}

function dedupeAndLimit(list: LocalPushNotification[]) {
  const map = new Map<string, LocalPushNotification>();
  for (const item of list) {
    const existing = map.get(item.id);
    if (!existing) {
      map.set(item.id, item);
      continue;
    }
    map.set(item.id, {
      ...existing,
      ...item,
      isRead: existing.isRead && item.isRead
    });
  }
  return Array.from(map.values())
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, MAX_RECENT);
}

async function persistState(state: PersistedState) {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export const useNotificationStore = create<NotificationStoreState>((set, get) => ({
  hydrated: false,
  unreadCount: 0,
  recent: [],

  hydrate: async () => {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) {
      set({ hydrated: true, unreadCount: 0, recent: [] });
      return;
    }

    try {
      const parsed = JSON.parse(raw) as PersistedState;
      const recent = Array.isArray(parsed?.recent) ? dedupeAndLimit(parsed.recent) : [];
      const unreadCount =
        typeof parsed?.unreadCount === "number"
          ? parsed.unreadCount
          : recent.filter((item) => !item.isRead).length;
      set({
        hydrated: true,
        unreadCount: Math.max(0, unreadCount),
        recent
      });
    } catch {
      set({ hydrated: true, unreadCount: 0, recent: [] });
      await AsyncStorage.removeItem(STORAGE_KEY);
    }
  },

  addForegroundNotification: async (payload) => {
    const item = toLocalNotification(payload, false);
    const nextRecent = dedupeAndLimit([item, ...get().recent]);
    const unreadCount = nextRecent.filter((entry) => !entry.isRead).length;
    set({ recent: nextRecent, unreadCount });
    await persistState({ recent: nextRecent, unreadCount });
  },

  addOpenedNotification: async (payload) => {
    const item = toLocalNotification(payload, true);
    const nextRecent = dedupeAndLimit([item, ...get().recent]);
    const unreadCount = nextRecent.filter((entry) => !entry.isRead).length;
    set({ recent: nextRecent, unreadCount });
    await persistState({ recent: nextRecent, unreadCount });
  },

  markAllRead: async () => {
    const nextRecent = get().recent.map((item) => ({ ...item, isRead: true }));
    set({ recent: nextRecent, unreadCount: 0 });
    await persistState({ recent: nextRecent, unreadCount: 0 });
  }
}));
