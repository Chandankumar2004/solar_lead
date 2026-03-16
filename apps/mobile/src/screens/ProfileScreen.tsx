import React, { useMemo, useState } from "react";
import { StyleSheet, Switch, Text, View } from "react-native";
import { useAuthStore } from "../store/auth-store";
import { usePreferencesStore } from "../store/preferences-store";
import { useQueueStore } from "../store/queue-store";
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
  const queueItems = useQueueStore((s) => s.items);
  const flushQueue = useQueueStore((s) => s.flush);
  const [syncingQueue, setSyncingQueue] = useState(false);

  const scopedQueueItems = useMemo(() => {
    if (!user?.id) return [];
    return queueItems.filter(
      (item) => !item.ownerUserId || item.ownerUserId === user.id
    );
  }, [queueItems, user?.id]);
  const failedQueueItems = useMemo(
    () => scopedQueueItems.filter((item) => (item.failCount ?? 0) > 0),
    [scopedQueueItems]
  );
  const nonRetryableCount = useMemo(
    () => failedQueueItems.filter((item) => item.retryable === false).length,
    [failedQueueItems]
  );

  const retryQueueSync = async () => {
    if (!user?.id || syncingQueue) return;
    setSyncingQueue(true);
    try {
      await flushQueue(user.id);
    } finally {
      setSyncingQueue(false);
    }
  };

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

      {scopedQueueItems.length > 0 ? (
        <Card style={{ gap: spacing.sm }}>
          <SectionTitle
            title="Offline Sync Queue"
            subtitle="Pending actions waiting to sync"
          />
          <Text style={{ color: colors.text }}>
            Pending items: {scopedQueueItems.length}
          </Text>
          {failedQueueItems.length > 0 ? (
            <Text style={{ color: colors.warning, fontWeight: "700" }}>
              Failed sync attempts: {failedQueueItems.length}
            </Text>
          ) : (
            <Text style={{ color: colors.textMuted }}>
              All queued items are ready to sync when online.
            </Text>
          )}
          {nonRetryableCount > 0 ? (
            <Text style={{ color: colors.danger }}>
              {nonRetryableCount} item(s) need manual review before retrying.
            </Text>
          ) : null}
          <AppButton
            title={syncingQueue ? "Retrying..." : "Retry Sync Now"}
            kind="primary"
            onPress={() => void retryQueueSync()}
            disabled={syncingQueue}
          />
          {failedQueueItems.length > 0 ? (
            <View style={{ gap: spacing.xs }}>
              {failedQueueItems.slice(0, 3).map((item) => (
                <View
                  key={item.id}
                  style={{
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: 8,
                    padding: 8
                  }}
                >
                  <Text style={{ fontWeight: "700", color: colors.text }}>{item.kind}</Text>
                  {item.lastError ? (
                    <Text style={{ color: colors.danger, fontSize: 12 }}>{item.lastError}</Text>
                  ) : null}
                </View>
              ))}
            </View>
          ) : null}
        </Card>
      ) : null}

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
