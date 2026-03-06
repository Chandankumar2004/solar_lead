import React from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  TextStyle,
  View,
  ViewStyle
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { usePreferencesStore } from "../store/preferences-store";
import { getPalette, radius, shadow, spacing } from "./theme";

type ScreenProps = {
  children: React.ReactNode;
  scroll?: boolean;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
};

export function AppScreen({
  children,
  scroll = false,
  style,
  contentContainerStyle
}: ScreenProps) {
  const colors = useAppPalette();

  if (scroll) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }, style]}>
        <ScrollView
          contentContainerStyle={[styles.scrollContent, contentContainerStyle]}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }, style]}>
      <View style={[styles.content, contentContainerStyle]}>{children}</View>
    </SafeAreaView>
  );
}

export function Card({
  children,
  style
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const colors = useAppPalette();
  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border
        },
        style
      ]}
    >
      {children}
    </View>
  );
}

type ButtonProps = {
  title: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  kind?: "primary" | "danger" | "ghost";
  style?: StyleProp<ViewStyle>;
};

export function AppButton({
  title,
  onPress,
  busy = false,
  disabled = false,
  kind = "primary",
  style
}: ButtonProps) {
  const colors = useAppPalette();
  const isDisabled = disabled || busy;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.buttonBase,
        kind === "primary" && { backgroundColor: colors.primary },
        kind === "danger" && { backgroundColor: colors.danger },
        kind === "ghost" && {
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.primary
        },
        isDisabled && styles.buttonDisabled,
        pressed && !isDisabled && styles.buttonPressed,
        style
      ]}
    >
      {busy ? (
        <ActivityIndicator color={kind === "ghost" ? colors.primary : "#fff"} />
      ) : (
        <Text
          style={[
            styles.buttonText,
            kind === "ghost" && { color: colors.primary }
          ]}
        >
          {title}
        </Text>
      )}
    </Pressable>
  );
}

export function Badge({
  label,
  tone = "neutral",
  style
}: {
  label: string;
  tone?: "neutral" | "success" | "warning" | "danger" | "info";
  style?: StyleProp<ViewStyle>;
}) {
  const colors = useAppPalette();
  const toneStyle =
    tone === "success"
      ? { backgroundColor: colors.accent, borderColor: colors.border }
      : tone === "warning"
        ? { backgroundColor: "rgba(224,161,61,0.18)", borderColor: "rgba(224,161,61,0.35)" }
        : tone === "danger"
          ? { backgroundColor: "rgba(234,107,98,0.18)", borderColor: "rgba(234,107,98,0.35)" }
          : tone === "info"
            ? { backgroundColor: "rgba(121,182,255,0.18)", borderColor: "rgba(121,182,255,0.35)" }
            : { backgroundColor: colors.surfaceMuted, borderColor: colors.border };

  return (
    <View style={[styles.badge, toneStyle, style]}>
      <Text style={[styles.badgeText, { color: colors.text }]}>{label}</Text>
    </View>
  );
}

export function SectionTitle({
  title,
  subtitle
}: {
  title: string;
  subtitle?: string;
}) {
  const colors = useAppPalette();
  return (
    <View style={{ gap: 2 }}>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>{title}</Text>
      {subtitle ? <Text style={[styles.sectionSubtitle, { color: colors.textMuted }]}>{subtitle}</Text> : null}
    </View>
  );
}

export function useTextInputStyle(): TextStyle {
  const colors = useAppPalette();
  return {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 11,
    backgroundColor: colors.surface,
    color: colors.text
  };
}

export function useAppPalette() {
  const mode = usePreferencesStore((s) => s.themeMode);
  return getPalette(mode);
}

const styles = StyleSheet.create({
  safe: {
    flex: 1
  },
  content: {
    flex: 1,
    padding: spacing.lg,
    gap: spacing.md
  },
  scrollContent: {
    padding: spacing.lg,
    gap: spacing.md
  },
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.md,
    gap: spacing.xs,
    ...shadow
  },
  buttonBase: {
    minHeight: 46,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.md
  },
  buttonDisabled: {
    opacity: 0.55
  },
  buttonPressed: {
    transform: [{ scale: 0.99 }]
  },
  buttonText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 15
  },
  badge: {
    alignSelf: "flex-start",
    borderRadius: radius.pill,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderWidth: 1
  },
  badgeText: {
    fontWeight: "700",
    fontSize: 12
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: "800"
  },
  sectionSubtitle: {
    fontSize: 13
  }
});
