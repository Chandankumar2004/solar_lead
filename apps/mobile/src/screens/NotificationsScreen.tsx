import React, { useCallback, useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { api } from "../services/api";
import { useNotificationStore } from "../store/notification-store";
import { AppScreen, Badge, Card, SectionTitle, useAppPalette } from "../ui/primitives";
import { spacing } from "../ui/theme";
import { useMobileI18n } from "../i18n";

type FeedItem = {
  id: string;
  contentSent?: string | null;
  deliveryStatus?: string | null;
  channel?: string | null;
  createdAt: string;
};

const AUTO_REFRESH_MS = 15000;

export function NotificationsScreen() {
  const colors = useAppPalette();
  const { t, formatDateTime } = useMobileI18n();
  const unreadCount = useNotificationStore((s) => s.unreadCount);
  const localPushRecent = useNotificationStore((s) => s.recent);
  const markAllRead = useNotificationStore((s) => s.markAllRead);
  const [items, setItems] = useState<FeedItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;
    if (!silent) {
      setRefreshing(true);
    }
    setError(null);
    try {
      const response = await api.get("/api/notifications/feed");
      const data = Array.isArray(response.data?.data) ? (response.data.data as FeedItem[]) : [];
      setItems(data);
    } catch {
      setError(t("notifications.loadFailed"));
    } finally {
      if (!silent) {
        setRefreshing(false);
      }
    }
  }, [t]);

  useFocusEffect(
    useCallback(() => {
      void load();
      const timer = setInterval(() => {
        void load({ silent: true });
      }, AUTO_REFRESH_MS);

      return () => {
        clearInterval(timer);
      };
    }, [load])
  );

  const keyExtractor = useCallback((item: FeedItem) => item.id, []);

  const emptyLabel = useMemo(
    () => (refreshing ? t("notifications.loading") : t("notifications.empty")),
    [refreshing, t]
  );

  return (
    <AppScreen style={{ paddingBottom: 0 }}>
      <Card>
        <SectionTitle title={t("notifications.title")} subtitle={t("notifications.subtitle")} />
        <View style={styles.headerMeta}>
          <Badge
            label={t("notifications.unread", { count: unreadCount })}
            tone={unreadCount > 0 ? "warning" : "success"}
          />
          {unreadCount > 0 ? (
            <Pressable
              onPress={() => {
                void markAllRead();
              }}
              style={styles.markAllButton}
            >
              <Text style={{ color: colors.primary, fontWeight: "700" }}>
                {t("notifications.markAllRead")}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </Card>
      {localPushRecent.length > 0 ? (
        <Card>
          <SectionTitle
            title={t("notifications.deviceInboxTitle")}
            subtitle={t("notifications.deviceInboxSubtitle")}
          />
          {localPushRecent.slice(0, 5).map((item) => (
            <View key={item.id} style={styles.localRow}>
              <View style={styles.topRow}>
                <Badge label={item.type ?? t("notifications.defaultType")} tone="info" />
                <Badge
                  label={item.isRead ? t("notifications.read") : t("notifications.unreadStatus")}
                  tone={item.isRead ? "neutral" : "warning"}
                />
              </View>
              <Text style={[styles.message, { color: colors.text }]}>
                {item.title ?? t("notifications.defaultTitle")}
              </Text>
              {item.body ? (
                <Text style={[styles.message, { color: colors.textMuted }]}>{item.body}</Text>
              ) : null}
              <Text style={[styles.date, { color: colors.textMuted }]}>
                {formatDateTime(item.createdAt)}
              </Text>
            </View>
          ))}
        </Card>
      ) : null}
      {error ? <Text style={[styles.error, { color: colors.danger }]}>{error}</Text> : null}
      <FlatList
        data={items}
        contentContainerStyle={{ paddingBottom: spacing.xl }}
        keyExtractor={keyExtractor}
        initialNumToRender={10}
        maxToRenderPerBatch={10}
        windowSize={11}
        removeClippedSubviews
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              void load();
            }}
            tintColor={colors.primary}
          />
        }
        ListEmptyComponent={
          <Text style={[styles.emptyText, { color: colors.textMuted }]}>{emptyLabel}</Text>
        }
        renderItem={({ item }) => {
          const status = (item.deliveryStatus ?? "SENT").toUpperCase();
          const tone =
            status.includes("FAIL")
              ? "danger"
              : status.includes("PENDING")
                ? "warning"
                : "success";

          return (
            <Card style={styles.rowCard}>
              <View style={styles.topRow}>
                <Badge label={item.channel ?? t("notifications.defaultChannel")} tone="info" />
                <Badge label={status} tone={tone} />
              </View>
              <Text style={[styles.message, { color: colors.text }]}>
                {item.contentSent ?? t("notifications.defaultMessage")}
              </Text>
              <Text style={[styles.date, { color: colors.textMuted }]}>
                {formatDateTime(item.createdAt)}
              </Text>
            </Card>
          );
        }}
      />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  error: {},
  headerMeta: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  markAllButton: {
    paddingHorizontal: 8,
    paddingVertical: 4
  },
  localRow: {
    borderTopWidth: 1,
    borderTopColor: "#E5E7EB",
    paddingTop: spacing.sm,
    marginTop: spacing.xs
  },
  emptyText: {
    marginTop: 16
  },
  rowCard: {
    marginBottom: spacing.sm
  },
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center"
  },
  message: {
    marginTop: 6
  },
  date: {
    marginTop: 8,
    fontSize: 12
  }
});
