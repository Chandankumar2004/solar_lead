import AsyncStorage from "@react-native-async-storage/async-storage";
import * as LocalAuthentication from "expo-local-authentication";
import { create } from "zustand";
import { api, setAuthFailureHandler } from "../services/api";

const BIOMETRIC_ENABLED_KEY = "auth.biometric_enabled";
const HAS_LOGGED_IN_ONCE_KEY = "auth.has_logged_in_once";

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
  bootstrap: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  setBiometricEnabled: (enabled: boolean) => Promise<void>;
  unlockWithBiometric: () => Promise<boolean>;
  lockBiometric: () => void;
  handleAuthFailure: () => void;
};

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

async function fetchAuthenticatedUser(): Promise<User> {
  const response = await api.get("/api/auth/me");
  const user = toUser(response.data?.data?.user);

  if (!user) {
    throw new Error("Invalid /auth/me response");
  }

  return user;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  isBootstrapping: true,
  biometricEnabled: false,
  hasLoggedInOnce: false,
  isBiometricUnlocked: false,

  bootstrap: async () => {
    set({ isBootstrapping: true });

    const [biometricRaw, loggedInRaw] = await Promise.all([
      AsyncStorage.getItem(BIOMETRIC_ENABLED_KEY),
      AsyncStorage.getItem(HAS_LOGGED_IN_ONCE_KEY)
    ]);

    const biometricEnabled = biometricRaw === "1";

    set({
      biometricEnabled,
      hasLoggedInOnce: loggedInRaw === "1",
      isBiometricUnlocked: !biometricEnabled
    });

    try {
      const user = await fetchAuthenticatedUser();
      set({ user, isBiometricUnlocked: !biometricEnabled });
    } catch {
      try {
        await api.post("/api/auth/refresh");
        const user = await fetchAuthenticatedUser();
        set({ user, isBiometricUnlocked: !biometricEnabled });
      } catch {
        set({
          user: null,
          isBiometricUnlocked: false
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

    await AsyncStorage.setItem(HAS_LOGGED_IN_ONCE_KEY, "1");

    set({
      user,
      hasLoggedInOnce: true,
      isBiometricUnlocked: !get().biometricEnabled
    });
  },

  logout: async () => {
    try {
      await api.post("/api/auth/logout");
    } catch {
      // Intentionally ignore server errors and clear local session.
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

  handleAuthFailure: () => {
    set({
      user: null,
      isBiometricUnlocked: false
    });
  }
}));

setAuthFailureHandler(() => {
  useAuthStore.getState().handleAuthFailure();
});
