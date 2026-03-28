import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import type { ThemeMode } from "../ui/theme";

const THEME_MODE_KEY = "ui.theme_mode";
const LANGUAGE_KEY = "ui.language";

export type MobileLanguage = "en" | "hi" | "mr";

function toLanguage(value: string | null): MobileLanguage {
  if (value === "hi") return "hi";
  if (value === "mr") return "mr";
  return "en";
}

type PreferencesState = {
  themeMode: ThemeMode;
  language: MobileLanguage;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setThemeMode: (mode: ThemeMode) => Promise<void>;
  toggleThemeMode: () => Promise<void>;
  setLanguage: (language: MobileLanguage) => Promise<void>;
};

export const usePreferencesStore = create<PreferencesState>((set, get) => ({
  themeMode: "light",
  language: "en",
  hydrated: false,

  hydrate: async () => {
    const [rawTheme, rawLanguage] = await Promise.all([
      AsyncStorage.getItem(THEME_MODE_KEY),
      AsyncStorage.getItem(LANGUAGE_KEY)
    ]);
    const mode: ThemeMode = rawTheme === "dark" ? "dark" : "light";
    set({
      themeMode: mode,
      language: toLanguage(rawLanguage),
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
  },

  setLanguage: async (language) => {
    await AsyncStorage.setItem(LANGUAGE_KEY, language);
    set({ language });
  }
}));
