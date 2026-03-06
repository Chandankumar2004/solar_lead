import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import type { ThemeMode } from "../ui/theme";

const THEME_MODE_KEY = "ui.theme_mode";

type PreferencesState = {
  themeMode: ThemeMode;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setThemeMode: (mode: ThemeMode) => Promise<void>;
  toggleThemeMode: () => Promise<void>;
};

export const usePreferencesStore = create<PreferencesState>((set, get) => ({
  themeMode: "light",
  hydrated: false,

  hydrate: async () => {
    const raw = await AsyncStorage.getItem(THEME_MODE_KEY);
    const mode: ThemeMode = raw === "dark" ? "dark" : "light";
    set({
      themeMode: mode,
      hydrated: true
    });
  },

  setThemeMode: async (mode) => {
    await AsyncStorage.setItem(THEME_MODE_KEY, mode);
    set({ themeMode: mode });
  },

  toggleThemeMode: async () => {
    const next: ThemeMode = get().themeMode === "dark" ? "light" : "dark";
    await AsyncStorage.setItem(THEME_MODE_KEY, next);
    set({ themeMode: next });
  }
}));
