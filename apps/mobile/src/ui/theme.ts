import { Platform } from "react-native";

export type ThemeMode = "light" | "dark";

export type AppPalette = {
  background: string;
  surface: string;
  surfaceMuted: string;
  text: string;
  textMuted: string;
  border: string;
  primary: string;
  primaryDark: string;
  accent: string;
  warning: string;
  danger: string;
  info: string;
};

export const lightPalette: AppPalette = {
  background: "#f4f7f2",
  surface: "#ffffff",
  surfaceMuted: "#eef4ec",
  text: "#102018",
  textMuted: "#5c6d63",
  border: "#d9e5db",
  primary: "#1f7a59",
  primaryDark: "#155640",
  accent: "#d2ead8",
  warning: "#b45309",
  danger: "#b42318",
  info: "#1d4e89"
} as const;

export const darkPalette: AppPalette = {
  background: "#0d1611",
  surface: "#122018",
  surfaceMuted: "#192a21",
  text: "#eef7f1",
  textMuted: "#a9beb0",
  border: "#294135",
  primary: "#46b183",
  primaryDark: "#2f8d67",
  accent: "#1a3a2c",
  warning: "#e0a13d",
  danger: "#ea6b62",
  info: "#79b6ff"
};

export function getPalette(mode: ThemeMode): AppPalette {
  return mode === "dark" ? darkPalette : lightPalette;
}

export const palette = lightPalette;

export const radius = {
  sm: 10,
  md: 14,
  lg: 18,
  pill: 999
} as const;

export const spacing = {
  xs: 6,
  sm: 10,
  md: 14,
  lg: 18,
  xl: 24
} as const;

export const shadow = Platform.select({
  ios: {
    shadowColor: "#133323",
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: {
      width: 0,
      height: 4
    }
  },
  android: {
    elevation: 2
  },
  default: {}
});
