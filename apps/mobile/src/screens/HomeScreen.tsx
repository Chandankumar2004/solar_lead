import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { api } from "../services/api";
import { useAuthStore } from "../store/auth-store";
import { Badge, Card, SectionTitle, useAppPalette, AppScreen } from "../ui/primitives";
import { spacing } from "../ui/theme";
import { useMobileI18n } from "../i18n";

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

export function HomeScreen() {
  const colors = useAppPalette();
  const user = useAuthStore((s) => s.user);
  const { t, formatDateTime, formatNumber } = useMobileI18n();

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
      setError(t("home.summaryLoadFailed"));
      setSummary(null);
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }, [t]);

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
        <SectionTitle title={t("home.title")} subtitle={t("home.subtitle")} />
        <Text style={[styles.welcomeText, { color: colors.text }]}>
          {user?.fullName
            ? t("home.welcomeWithName", { name: user.fullName })
            : t("home.welcomeWithEmail", { email: user?.email ?? t("home.fieldUser") })}
        </Text>
        <View style={styles.heroMeta}>
          <Badge label={user?.roleLabel ?? user?.role ?? t("home.fieldUser")} tone="info" />
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
          <Text style={[styles.sectionHeading, { color: colors.text }]}>{t("home.activeLeads")}</Text>
          <Pressable
            onPress={() => {
              void loadSummary();
            }}
            style={styles.refreshButton}
            disabled={refreshing}
          >
            <Text style={{ color: colors.primary, fontWeight: "700" }}>
              {refreshing ? t("home.refreshing") : t("home.refresh")}
            </Text>
          </Pressable>
        </View>

        <View style={styles.kpiRow}>
          <View style={styles.kpiItem}>
            <Text style={[styles.kpiValue, { color: colors.text }]}>
              {summary?.totals.active !== undefined
                ? formatNumber(summary.totals.active)
                : loading
                  ? "-"
                  : "0"}
            </Text>
            <Text style={[styles.kpiLabel, { color: colors.textMuted }]}>{t("home.active")}</Text>
          </View>
          <View style={styles.kpiItem}>
            <Text style={[styles.kpiValue, { color: colors.warning }]}>
              {summary?.urgency.overdue !== undefined
                ? formatNumber(summary.urgency.overdue)
                : loading
                  ? "-"
                  : "0"}
            </Text>
            <Text style={[styles.kpiLabel, { color: colors.textMuted }]}>{t("home.overdue")}</Text>
          </View>
          <View style={styles.kpiItem}>
            <Text style={[styles.kpiValue, { color: colors.text }]}>
              {summary?.totals.assigned !== undefined
                ? formatNumber(summary.totals.assigned)
                : loading
                  ? "-"
                  : "0"}
            </Text>
            <Text style={[styles.kpiLabel, { color: colors.textMuted }]}>{t("home.assigned")}</Text>
          </View>
        </View>

        {topStatusRows.length === 0 ? (
          <Text style={[styles.helper, { color: colors.textMuted }]}>
            {loading ? t("home.loadingStatusSummary") : t("home.noStatusSummary")}
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
        <Text style={[styles.sectionHeading, { color: colors.text }]}>{t("home.tasksTitle")}</Text>
        {taskRows.length === 0 ? (
          <Text style={[styles.helper, { color: colors.textMuted }]}>
            {loading ? t("home.loadingTasks") : t("home.noTasks")}
          </Text>
        ) : (
          taskRows.map((task) => (
            <View key={task.leadId} style={styles.taskRow}>
              <Text style={[styles.taskTitle, { color: colors.text }]}>
                {task.customerName} ({task.statusName})
              </Text>
              <Text style={[styles.taskMeta, { color: colors.textMuted }]}>
                {task.districtName}, {task.districtState} | {formatDateTime(task.updatedAt)}
              </Text>
              {task.isOverdue ? (
                <Text style={{ color: colors.warning }}>{t("home.overdueFlag")}</Text>
              ) : null}
            </View>
          ))
        )}
      </Card>

      <Card>
        <Text style={[styles.sectionHeading, { color: colors.text }]}>
          {t("home.pendingActionsTitle")}
        </Text>
        <View style={styles.kpiRow}>
          <View style={styles.kpiItem}>
            <Text style={[styles.kpiValue, { color: colors.text }]}>
              {summary?.pendingActions.documentsToUpload !== undefined
                ? formatNumber(summary.pendingActions.documentsToUpload)
                : loading
                  ? "-"
                  : "0"}
            </Text>
            <Text style={[styles.kpiLabel, { color: colors.textMuted }]}>
              {t("home.docsToUpload")}
            </Text>
          </View>
          <View style={styles.kpiItem}>
            <Text style={[styles.kpiValue, { color: colors.text }]}>
              {summary?.pendingActions.paymentsToCollect !== undefined
                ? formatNumber(summary.pendingActions.paymentsToCollect)
                : loading
                  ? "-"
                  : "0"}
            </Text>
            <Text style={[styles.kpiLabel, { color: colors.textMuted }]}>{t("home.payments")}</Text>
          </View>
          <View style={styles.kpiItem}>
            <Text style={[styles.kpiValue, { color: colors.text }]}>
              {summary?.pendingActions.formsToComplete !== undefined
                ? formatNumber(summary.pendingActions.formsToComplete)
                : loading
                  ? "-"
                  : "0"}
            </Text>
            <Text style={[styles.kpiLabel, { color: colors.textMuted }]}>{t("home.forms")}</Text>
          </View>
        </View>
      </Card>

      <Card>
        <Text style={[styles.sectionHeading, { color: colors.text }]}>
          {t("home.recentNotificationsTitle")}
        </Text>
        {notificationRows.length === 0 ? (
          <Text style={[styles.helper, { color: colors.textMuted }]}>
            {loading ? t("home.loadingNotifications") : t("home.noNotifications")}
          </Text>
        ) : (
          notificationRows.map((entry) => (
            <View key={entry.id} style={styles.notificationRow}>
              <View style={styles.sectionRow}>
                <Badge label={entry.channel ?? t("home.channelInApp")} tone="info" />
                <Badge label={(entry.deliveryStatus ?? "SENT").toUpperCase()} tone="neutral" />
              </View>
              <Text style={{ color: colors.text }}>
                {entry.contentSent ?? t("home.notificationDefault")}
              </Text>
              <Text style={[styles.taskMeta, { color: colors.textMuted }]}>
                {formatDateTime(entry.createdAt)}
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
