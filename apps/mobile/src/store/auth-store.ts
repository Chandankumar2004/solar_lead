import AsyncStorage from "@react-native-async-storage/async-storage";
import * as LocalAuthentication from "expo-local-authentication";
import axios from "axios";
import { create } from "zustand";
import { api, setAuthFailureHandler, type AuthFailureInfo } from "../services/api";
import { useQueueStore } from "./queue-store";
import { clearOfflineCacheForOwner } from "../services/offline-cache";

const BIOMETRIC_ENABLED_KEY = "auth.biometric_enabled";
const HAS_LOGGED_IN_ONCE_KEY = "auth.has_logged_in_once";
const AUTH_NOTICE_KEY = "auth.notice";
const MOBILE_ALLOWED_ROLE = "FIELD_EXECUTIVE";

class MobileRoleError extends Error {
  constructor() {
    super("This account is not allowed in the mobile app. Use the admin portal.");
    this.name = "MobileRoleError";
  }
}

type User = {
  id: string;
  email: string;
  fullName: string;
  role: string;
  roleLabel?: string;
  status: string;
};

type AuthState = {
  user: User | null;
  isBootstrapping: boolean;
  biometricEnabled: boolean;
  hasLoggedInOnce: boolean;
  isBiometricUnlocked: boolean;
  authNotice: string | null;
  bootstrap: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  setBiometricEnabled: (enabled: boolean) => Promise<void>;
  unlockWithBiometric: () => Promise<boolean>;
  lockBiometric: () => void;
  clearAuthNotice: () => Promise<void>;
  handleAuthFailure: (info?: AuthFailureInfo) => void;
};

function toApiErrorInfo(error: unknown): AuthFailureInfo | undefined {
  if (!axios.isAxiosError(error)) {
    return undefined;
  }
  const payload = (error.response?.data ?? {}) as {
    code?: unknown;
    message?: unknown;
    error?: unknown;
  };
  return {
    code: typeof payload.code === "string" ? payload.code : undefined,
    message:
      typeof payload.message === "string"
        ? payload.message
        : typeof payload.error === "string"
          ? payload.error
          : undefined
  };
}

function blockedAccountNotice(info?: AuthFailureInfo): string | null {
  const code = (info?.code ?? "").trim().toUpperCase();
  if (code === "ACCOUNT_PENDING") {
    return "Your account is pending approval. Please contact your admin.";
  }
  if (code === "ACCOUNT_SUSPENDED") {
    return "Your account has been suspended. Contact your admin to restore access.";
  }
  if (code === "ACCOUNT_DEACTIVATED") {
    return "Your account has been deactivated. Contact your admin.";
  }
  return null;
}

async function persistAuthNotice(notice: string | null) {
  if (notice) {
    await AsyncStorage.setItem(AUTH_NOTICE_KEY, notice);
    return;
  }
  await AsyncStorage.removeItem(AUTH_NOTICE_KEY);
}

function toUser(value: unknown): User | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<User>;
  if (!candidate.id || !candidate.email || !candidate.role || !candidate.status) {
    return null;
  }

  return {
    id: candidate.id,
    email: candidate.email,
    fullName: candidate.fullName ?? "",
    role: candidate.role,
    roleLabel: candidate.roleLabel,
    status: candidate.status
  };
}

function assertMobileRoleAllowed(user: User) {
  if (user.role !== MOBILE_ALLOWED_ROLE) {
    throw new MobileRoleError();
  }
}

async function fetchAuthenticatedUser(): Promise<User> {
  const response = await api.get("/api/auth/me");
  const user = toUser(response.data?.data?.user);

  if (!user) {
    throw new Error("Invalid /auth/me response");
  }
  assertMobileRoleAllowed(user);

  return user;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  isBootstrapping: true,
  biometricEnabled: false,
  hasLoggedInOnce: false,
  isBiometricUnlocked: false,
  authNotice: null,

  bootstrap: async () => {
    set({ isBootstrapping: true });

    const [biometricRaw, loggedInRaw, authNoticeRaw] = await Promise.all([
      AsyncStorage.getItem(BIOMETRIC_ENABLED_KEY),
      AsyncStorage.getItem(HAS_LOGGED_IN_ONCE_KEY),
      AsyncStorage.getItem(AUTH_NOTICE_KEY)
    ]);

    const biometricEnabled = biometricRaw === "1";

    set({
      biometricEnabled,
      hasLoggedInOnce: loggedInRaw === "1",
      isBiometricUnlocked: !biometricEnabled,
      authNotice: authNoticeRaw?.trim() ? authNoticeRaw : null
    });

    try {
      const user = await fetchAuthenticatedUser();
      await persistAuthNotice(null);
      set({
        user,
        isBiometricUnlocked: !biometricEnabled,
        authNotice: null
      });
    } catch (error) {
      if (error instanceof MobileRoleError) {
        try {
          await api.post("/api/auth/logout");
        } catch {
          // Ignore server errors and clear local state.
        }
        await persistAuthNotice(error.message);
        set({
          user: null,
          isBiometricUnlocked: false,
          authNotice: error.message
        });
        return;
      }

      const blockedNotice = blockedAccountNotice(toApiErrorInfo(error));
      if (blockedNotice) {
        await persistAuthNotice(blockedNotice);
        set({
          user: null,
          isBiometricUnlocked: false,
          authNotice: blockedNotice
        });
        return;
      }

      try {
        await api.post("/api/auth/refresh");
        const user = await fetchAuthenticatedUser();
        await persistAuthNotice(null);
        set({
          user,
          isBiometricUnlocked: !biometricEnabled,
          authNotice: null
        });
      } catch (refreshError) {
        const refreshNotice = blockedAccountNotice(toApiErrorInfo(refreshError));
        if (refreshNotice) {
          await persistAuthNotice(refreshNotice);
        }
        set({
          user: null,
          isBiometricUnlocked: false,
          authNotice: refreshNotice ?? get().authNotice
        });
      }
    } finally {
      set({ isBootstrapping: false });
    }
  },

  login: async (email, password) => {
    const response = await api.post("/api/auth/login", {
      email,
      password
    });

    const user = toUser(response.data?.data?.user);
    if (!user) {
      throw new Error("Invalid /auth/login response");
    }
    assertMobileRoleAllowed(user);

    await AsyncStorage.setItem(HAS_LOGGED_IN_ONCE_KEY, "1");
    await persistAuthNotice(null);

    set({
      user,
      hasLoggedInOnce: true,
      isBiometricUnlocked: !get().biometricEnabled,
      authNotice: null
    });
  },

  logout: async () => {
    const currentUserId = get().user?.id;
    try {
      await api.post("/api/auth/logout");
    } catch {
      // Intentionally ignore server errors and clear local session.
    }

    if (currentUserId) {
      await Promise.all([
        useQueueStore.getState().clearByOwner(currentUserId),
        clearOfflineCacheForOwner(currentUserId)
      ]);
    }

    set({
      user: null,
      isBiometricUnlocked: false
    });
  },

  setBiometricEnabled: async (enabled) => {
    if (enabled) {
      await AsyncStorage.setItem(BIOMETRIC_ENABLED_KEY, "1");
    } else {
      await AsyncStorage.removeItem(BIOMETRIC_ENABLED_KEY);
    }

    set({
      biometricEnabled: enabled,
      isBiometricUnlocked: enabled ? get().isBiometricUnlocked : true
    });
  },

  unlockWithBiometric: async () => {
    if (!get().biometricEnabled) {
      set({ isBiometricUnlocked: true });
      return true;
    }

    const [hasHardware, isEnrolled] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync()
    ]);

    if (!hasHardware || !isEnrolled) {
      return false;
    }

    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: "Unlock Solar Lead",
      fallbackLabel: "Use device passcode",
      cancelLabel: "Cancel"
    });

    if (!result.success) {
      return false;
    }

    set({ isBiometricUnlocked: true });
    return true;
  },

  lockBiometric: () => {
    if (get().biometricEnabled && get().user) {
      set({ isBiometricUnlocked: false });
    }
  },

  clearAuthNotice: async () => {
    await persistAuthNotice(null);
    set({ authNotice: null });
  },

  handleAuthFailure: (info) => {
    const currentUserId = get().user?.id;
    if (currentUserId) {
      void useQueueStore.getState().clearByOwner(currentUserId);
      void clearOfflineCacheForOwner(currentUserId);
    }

    const notice = blockedAccountNotice(info) ?? null;
    void persistAuthNotice(notice);
    set({
      user: null,
      isBiometricUnlocked: false,
      authNotice: notice
    });
  }
}));

setAuthFailureHandler((info) => {
  useAuthStore.getState().handleAuthFailure(info);
});
