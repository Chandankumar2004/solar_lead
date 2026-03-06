import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import { api } from "../services/api";
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
      </Card>
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
