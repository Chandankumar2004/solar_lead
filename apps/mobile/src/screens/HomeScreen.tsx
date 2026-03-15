import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { api } from "../services/api";
import { useAuthStore } from "../store/auth-store";
import { Badge, Card, SectionTitle, useAppPalette, AppScreen } from "../ui/primitives";
import { spacing } from "../ui/theme";

type StatusSummary = {
  statusId: string;
  statusName: string;
  colorCode?: string | null;
  count: number;
};

type TaskItem = {
  leadId: string;
  externalId: string;
  customerName: string;
  districtName: string;
  districtState: string;
  statusName: string;
  isOverdue: boolean;
  updatedAt: string;
};

type RecentNotification = {
  id: string;
  channel: string;
  deliveryStatus: string;
  contentSent: string;
  createdAt: string;
};

type MobileSummary = {
  totals: {
    assigned: number;
    active: number;
    overdue: number;
  };
  activeLeadsByStatus: StatusSummary[];
  urgency: {
    overdue: number;
    normal: number;
  };
  todaysTasks: TaskItem[];
  pendingActions: {
    documentsToUpload: number;
    paymentsToCollect: number;
    formsToComplete: number;
    total: number;
  };
  recentNotifications: RecentNotification[];
  generatedAt: string;
};

function toReadableDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
}

export function HomeScreen() {
  const colors = useAppPalette();
  const user = useAuthStore((s) => s.user);

  const [summary, setSummary] = useState<MobileSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSummary = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const response = await api.get("/api/dashboard/mobile-summary");
      setSummary((response.data?.data ?? null) as MobileSummary | null);
    } catch {
      setError("Unable to load dashboard summary.");
      setSummary(null);
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSummary();
    const timer = setInterval(() => {
      void loadSummary();
    }, 60000);
    return () => clearInterval(timer);
  }, [loadSummary]);

  const topStatusRows = useMemo(
    () => (summary?.activeLeadsByStatus ?? []).slice(0, 6),
    [summary?.activeLeadsByStatus]
  );

  const taskRows = useMemo(() => (summary?.todaysTasks ?? []).slice(0, 6), [summary?.todaysTasks]);
  const notificationRows = useMemo(
    () => (summary?.recentNotifications ?? []).slice(0, 6),
    [summary?.recentNotifications]
  );

  return (
    <AppScreen scroll>
      <Card style={styles.heroCard}>
        <SectionTitle title="Home" subtitle="Field operations dashboard" />
        <Text style={[styles.welcomeText, { color: colors.text }]}>
          {user?.fullName ? `Welcome, ${user.fullName}` : `Welcome, ${user?.email ?? "User"}`}
        </Text>
        <View style={styles.heroMeta}>
          <Badge label={user?.roleLabel ?? user?.role ?? "Field User"} tone="info" />
          <Badge label={user?.status ?? "-"} tone="success" />
        </View>
      </Card>

      {error ? (
        <Card>
          <Text style={{ color: colors.danger }}>{error}</Text>
        </Card>
      ) : null}

      <Card style={styles.summaryCard}>
        <View style={styles.sectionRow}>
          <Text style={[styles.sectionHeading, { color: colors.text }]}>Active Leads</Text>
          <Pressable
            onPress={() => {
              void loadSummary();
            }}
            style={styles.refreshButton}
            disabled={refreshing}
          >
            <Text style={{ color: colors.primary, fontWeight: "700" }}>
              {refreshing ? "Refreshing..." : "Refresh"}
            </Text>
          </Pressable>
        </View>

        <View style={styles.kpiRow}>
          <View style={styles.kpiItem}>
            <Text style={[styles.kpiValue, { color: colors.text }]}>
              {summary?.totals.active ?? (loading ? "-" : "0")}
            </Text>
            <Text style={[styles.kpiLabel, { color: colors.textMuted }]}>Active</Text>
          </View>
          <View style={styles.kpiItem}>
            <Text style={[styles.kpiValue, { color: colors.warning }]}>
              {summary?.urgency.overdue ?? (loading ? "-" : "0")}
            </Text>
            <Text style={[styles.kpiLabel, { color: colors.textMuted }]}>Overdue</Text>
          </View>
          <View style={styles.kpiItem}>
            <Text style={[styles.kpiValue, { color: colors.text }]}>
              {summary?.totals.assigned ?? (loading ? "-" : "0")}
            </Text>
            <Text style={[styles.kpiLabel, { color: colors.textMuted }]}>Assigned</Text>
          </View>
        </View>

        {topStatusRows.length === 0 ? (
          <Text style={[styles.helper, { color: colors.textMuted }]}>
            {loading ? "Loading status summary..." : "No active status summary yet."}
          </Text>
        ) : (
          <View style={styles.statusList}>
            {topStatusRows.map((item) => (
              <View key={item.statusId} style={styles.statusRow}>
                <Text style={[styles.statusName, { color: colors.text }]}>{item.statusName}</Text>
                <Badge
                  label={`${item.count}`}
                  tone="success"
                  style={{ backgroundColor: item.colorCode ?? colors.accent }}
                />
              </View>
            ))}
          </View>
        )}
      </Card>

      <Card>
        <Text style={[styles.sectionHeading, { color: colors.text }]}>Today's Tasks / Visits</Text>
        {taskRows.length === 0 ? (
          <Text style={[styles.helper, { color: colors.textMuted }]}>
            {loading ? "Loading tasks..." : "No tasks scheduled right now."}
          </Text>
        ) : (
          taskRows.map((task) => (
            <View key={task.leadId} style={styles.taskRow}>
              <Text style={[styles.taskTitle, { color: colors.text }]}>
                {task.customerName} ({task.statusName})
              </Text>
              <Text style={[styles.taskMeta, { color: colors.textMuted }]}>
                {task.districtName}, {task.districtState} | {toReadableDateTime(task.updatedAt)}
              </Text>
              {task.isOverdue ? <Text style={{ color: colors.warning }}>Overdue</Text> : null}
            </View>
          ))
        )}
      </Card>

      <Card>
        <Text style={[styles.sectionHeading, { color: colors.text }]}>Pending Actions</Text>
        <View style={styles.kpiRow}>
          <View style={styles.kpiItem}>
            <Text style={[styles.kpiValue, { color: colors.text }]}>
              {summary?.pendingActions.documentsToUpload ?? (loading ? "-" : "0")}
            </Text>
            <Text style={[styles.kpiLabel, { color: colors.textMuted }]}>Docs to Upload</Text>
          </View>
          <View style={styles.kpiItem}>
            <Text style={[styles.kpiValue, { color: colors.text }]}>
              {summary?.pendingActions.paymentsToCollect ?? (loading ? "-" : "0")}
            </Text>
            <Text style={[styles.kpiLabel, { color: colors.textMuted }]}>Payments</Text>
          </View>
          <View style={styles.kpiItem}>
            <Text style={[styles.kpiValue, { color: colors.text }]}>
              {summary?.pendingActions.formsToComplete ?? (loading ? "-" : "0")}
            </Text>
            <Text style={[styles.kpiLabel, { color: colors.textMuted }]}>Forms</Text>
          </View>
        </View>
      </Card>

      <Card>
        <Text style={[styles.sectionHeading, { color: colors.text }]}>Recent Notifications</Text>
        {notificationRows.length === 0 ? (
          <Text style={[styles.helper, { color: colors.textMuted }]}>
            {loading ? "Loading notifications..." : "No recent notifications."}
          </Text>
        ) : (
          notificationRows.map((entry) => (
            <View key={entry.id} style={styles.notificationRow}>
              <View style={styles.sectionRow}>
                <Badge label={entry.channel ?? "IN_APP"} tone="info" />
                <Badge label={(entry.deliveryStatus ?? "SENT").toUpperCase()} tone="neutral" />
              </View>
              <Text style={{ color: colors.text }}>{entry.contentSent ?? "Notification"}</Text>
              <Text style={[styles.taskMeta, { color: colors.textMuted }]}>
                {toReadableDateTime(entry.createdAt)}
              </Text>
            </View>
          ))
        )}
      </Card>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  heroCard: {
    gap: spacing.sm
  },
  heroMeta: {
    flexDirection: "row",
    gap: spacing.xs
  },
  welcomeText: {
    fontSize: 15
  },
  summaryCard: {
    gap: spacing.sm
  },
  sectionRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.sm
  },
  sectionHeading: {
    fontWeight: "800"
  },
  refreshButton: {
    paddingVertical: 4,
    paddingHorizontal: 8
  },
  kpiRow: {
    flexDirection: "row",
    gap: spacing.sm
  },
  kpiItem: {
    flex: 1
  },
  kpiValue: {
    fontSize: 20,
    fontWeight: "800"
  },
  kpiLabel: {
    marginTop: 4,
    fontSize: 12
  },
  helper: {
    marginTop: 2
  },
  statusList: {
    gap: spacing.xs
  },
  statusRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center"
  },
  statusName: {
    fontWeight: "600"
  },
  taskRow: {
    borderTopWidth: 1,
    borderTopColor: "#E5E7EB",
    paddingTop: spacing.sm,
    marginTop: spacing.xs
  },
  taskTitle: {
    fontWeight: "700"
  },
  taskMeta: {
    fontSize: 12,
    marginTop: 2
  },
  notificationRow: {
    borderTopWidth: 1,
    borderTopColor: "#E5E7EB",
    paddingTop: spacing.sm,
    marginTop: spacing.xs,
    gap: 4
  }
});
