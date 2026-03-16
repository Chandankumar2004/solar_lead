import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { api } from "../services/api";
import { useNotificationStore } from "../store/notification-store";
import { AppScreen, Badge, Card, SectionTitle, useAppPalette } from "../ui/primitives";
import { spacing } from "../ui/theme";

type FeedItem = {
  id: string;
  contentSent?: string | null;
  deliveryStatus?: string | null;
  channel?: string | null;
  createdAt: string;
};

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
}

export function NotificationsScreen() {
  const colors = useAppPalette();
  const unreadCount = useNotificationStore((s) => s.unreadCount);
  const localPushRecent = useNotificationStore((s) => s.recent);
  const markAllRead = useNotificationStore((s) => s.markAllRead);
  const [items, setItems] = useState<FeedItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const response = await api.get("/api/notifications/feed");
      const data = Array.isArray(response.data?.data) ? (response.data.data as FeedItem[]) : [];
      setItems(data);
    } catch {
      setError("Could not load notifications.");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const keyExtractor = useCallback((item: FeedItem) => item.id, []);

  const emptyLabel = useMemo(
    () => (refreshing ? "Loading..." : "No notifications yet."),
    [refreshing]
  );

  return (
    <AppScreen style={{ paddingBottom: 0 }}>
      <Card>
        <SectionTitle title="Notifications" subtitle="Recent communication and internal alerts" />
        <View style={styles.headerMeta}>
          <Badge label={`Unread: ${unreadCount}`} tone={unreadCount > 0 ? "warning" : "success"} />
          {unreadCount > 0 ? (
            <Pressable
              onPress={() => {
                void markAllRead();
              }}
              style={styles.markAllButton}
            >
              <Text style={{ color: colors.primary, fontWeight: "700" }}>Mark all read</Text>
            </Pressable>
          ) : null}
        </View>
      </Card>
      {localPushRecent.length > 0 ? (
        <Card>
          <SectionTitle title="Device Push Inbox" subtitle="Latest push events received on this device" />
          {localPushRecent.slice(0, 5).map((item) => (
            <View key={item.id} style={styles.localRow}>
              <View style={styles.topRow}>
                <Badge label={item.type ?? "INTERNAL"} tone="info" />
                <Badge label={item.isRead ? "READ" : "UNREAD"} tone={item.isRead ? "neutral" : "warning"} />
              </View>
              <Text style={[styles.message, { color: colors.text }]}>
                {item.title ?? "Notification"}
              </Text>
              {item.body ? (
                <Text style={[styles.message, { color: colors.textMuted }]}>{item.body}</Text>
              ) : null}
              <Text style={[styles.date, { color: colors.textMuted }]}>{formatDate(item.createdAt)}</Text>
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
            onRefresh={load}
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
                <Badge label={item.channel ?? "IN_APP"} tone="info" />
                <Badge label={status} tone={tone} />
              </View>
              <Text style={[styles.message, { color: colors.text }]}>
                {item.contentSent ?? "Notification message"}
              </Text>
              <Text style={[styles.date, { color: colors.textMuted }]}>
                {formatDate(item.createdAt)}
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
