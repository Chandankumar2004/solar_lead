import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useAuthStore } from "../store/auth-store";
import { useQueueStore } from "../store/queue-store";
import { AppScreen, Badge, Card, SectionTitle, useAppPalette } from "../ui/primitives";
import { spacing } from "../ui/theme";

export function HomeScreen() {
  const colors = useAppPalette();
  const user = useAuthStore((s) => s.user);
  const pendingQueueCount = useQueueStore((s) => s.items.length);

  return (
    <AppScreen>
      <Card style={styles.heroCard}>
        <SectionTitle title="Home" subtitle="Field operations snapshot" />
        <Text style={[styles.welcomeText, { color: colors.text }]}>
          {user?.fullName ? `Welcome, ${user.fullName}` : `Welcome, ${user?.email ?? "User"}`}
        </Text>
        <Badge
          label={user?.roleLabel ?? user?.role ?? "Field User"}
          tone="info"
        />
      </Card>

      <View style={styles.statRow}>
        <Card style={[styles.statCard, { backgroundColor: colors.accent }]}>
          <Text style={[styles.statValue, { color: colors.text }]}>{pendingQueueCount}</Text>
          <Text style={[styles.statLabel, { color: colors.textMuted }]}>Pending Queue</Text>
        </Card>
        <Card style={[styles.statCard, { backgroundColor: colors.surfaceMuted }]}>
          <Text style={[styles.statValue, { color: colors.text }]}>{user?.status ?? "-"}</Text>
          <Text style={[styles.statLabel, { color: colors.textMuted }]}>Account Status</Text>
        </Card>
      </View>

      <Card>
        <Text style={[styles.sectionHeading, { color: colors.text }]}>Today Focus</Text>
        <Text style={[styles.helper, { color: colors.textMuted }]}>
          Keep queue count at zero and update lead statuses after every field visit.
        </Text>
      </Card>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  heroCard: {
    gap: spacing.sm
  },
  welcomeText: {
    fontSize: 15
  },
  statRow: {
    flexDirection: "row",
    gap: spacing.sm
  },
  statCard: {
    flex: 1
  },
  statValue: {
    fontSize: 20,
    fontWeight: "800"
  },
  statLabel: {
    marginTop: 4
  },
  sectionHeading: {
    fontWeight: "800"
  },
  helper: {
    marginTop: 2
  }
});
