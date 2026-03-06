import React from "react";
import { StyleSheet, Switch, Text, View } from "react-native";
import { useAuthStore } from "../store/auth-store";
import { usePreferencesStore } from "../store/preferences-store";
import { AppButton, AppScreen, Badge, Card, SectionTitle, useAppPalette } from "../ui/primitives";
import { spacing } from "../ui/theme";

export function ProfileScreen() {
  const colors = useAppPalette();
  const user = useAuthStore((s) => s.user);
  const biometricEnabled = useAuthStore((s) => s.biometricEnabled);
  const hasLoggedInOnce = useAuthStore((s) => s.hasLoggedInOnce);
  const setBiometricEnabled = useAuthStore((s) => s.setBiometricEnabled);
  const logout = useAuthStore((s) => s.logout);
  const themeMode = usePreferencesStore((s) => s.themeMode);
  const setThemeMode = usePreferencesStore((s) => s.setThemeMode);

  return (
    <AppScreen>
      <Card>
        <SectionTitle title="Profile" subtitle="Account and device preferences" />
      </Card>

      <Card style={styles.profileCard}>
        <Text style={[styles.name, { color: colors.text }]}>{user?.fullName || "Field User"}</Text>
        <Text style={[styles.line, { color: colors.textMuted }]}>{user?.email}</Text>
        <View style={styles.row}>
          <Badge label={user?.roleLabel ?? user?.role ?? "-"} tone="info" />
          <Badge
            label={user?.status ?? "-"}
            tone={user?.status === "ACTIVE" ? "success" : "warning"}
          />
        </View>
      </Card>

      {hasLoggedInOnce ? (
        <Card style={styles.toggleCard}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={[styles.toggleTitle, { color: colors.text }]}>Biometric Unlock</Text>
            <Text style={[styles.toggleHelp, { color: colors.textMuted }]}>
              Require fingerprint/face unlock when app is reopened.
            </Text>
          </View>
          <Switch
            value={biometricEnabled}
            onValueChange={(value) => void setBiometricEnabled(value)}
            trackColor={{ false: colors.border, true: colors.accent }}
            thumbColor={biometricEnabled ? colors.primary : "#f4f4f4"}
          />
        </Card>
      ) : null}

      <Card style={styles.toggleCard}>
        <View style={{ flex: 1, paddingRight: 12 }}>
          <Text style={[styles.toggleTitle, { color: colors.text }]}>Dark Mode</Text>
          <Text style={[styles.toggleHelp, { color: colors.textMuted }]}>
            Switch app theme for low-light usage.
          </Text>
        </View>
        <Switch
          value={themeMode === "dark"}
          onValueChange={(enabled) => void setThemeMode(enabled ? "dark" : "light")}
          trackColor={{ false: colors.border, true: colors.accent }}
          thumbColor={themeMode === "dark" ? colors.primary : "#f4f4f4"}
        />
      </Card>

      <AppButton title="Logout" kind="danger" onPress={() => void logout()} />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  profileCard: {
    gap: spacing.xs
  },
  name: {
    fontWeight: "800",
    fontSize: 19
  },
  line: {},
  row: {
    flexDirection: "row",
    gap: spacing.xs,
    marginTop: spacing.xs
  },
  toggleCard: {
    flexDirection: "row",
    alignItems: "center"
  },
  toggleTitle: {
    fontWeight: "800"
  },
  toggleHelp: {
    marginTop: 3
  }
});
