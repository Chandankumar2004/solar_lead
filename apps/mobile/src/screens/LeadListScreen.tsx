import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View
} from "react-native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useNavigation } from "@react-navigation/native";
import { api } from "../services/api";
import { useAuthStore } from "../store/auth-store";
import { AppScreen, Badge, Card, SectionTitle, useAppPalette } from "../ui/primitives";
import { spacing } from "../ui/theme";

type Lead = {
  id: string;
  externalId: string;
  name: string;
  phone: string;
  email?: string | null;
  installationType?: string | null;
  updatedAt: string;
  currentStatus: {
    id: string;
    name: string;
    colorCode?: string | null;
  };
  district?: {
    id: string;
    name: string;
    state: string;
  } | null;
};

type LeadsStackParamList = {
  LeadList: undefined;
  LeadCreate: undefined;
  LeadDetail: { leadId: string };
};

const ALL_STATUSES = "ALL_STATUSES";

export function LeadListScreen() {
  const colors = useAppPalette();
  const navigation = useNavigation<NativeStackNavigationProp<LeadsStackParamList>>();
  const user = useAuthStore((s) => s.user);

  const [leads, setLeads] = useState<Lead[]>([]);
  const [selectedStatus, setSelectedStatus] = useState<string>(ALL_STATUSES);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!user?.id) return;
    setRefreshing(true);
    setError(null);
    try {
      const response = await api.get("/api/leads", {
        params: {
          page: 1,
          pageSize: 100,
          execId: user.id,
          ...(selectedStatus !== ALL_STATUSES ? { status: selectedStatus } : {})
        }
      });
      const rows = Array.isArray(response.data?.data) ? (response.data.data as Lead[]) : [];
      setLeads(rows);
    } catch {
      setError("Failed to load leads.");
      setLeads([]);
    } finally {
      setRefreshing(false);
    }
  }, [selectedStatus, user?.id]);

  const sortedLeads = useMemo(
    () =>
      [...leads].sort((a, b) => {
        const aTs = new Date(a.updatedAt).getTime();
        const bTs = new Date(b.updatedAt).getTime();
        return bTs - aTs;
      }),
    [leads]
  );

  useEffect(() => {
    void load();
  }, [load]);

  const statusOptions = useMemo(() => {
    const names = Array.from(
      new Set(leads.map((row) => row.currentStatus?.name).filter(Boolean))
    ) as string[];
    names.sort((a, b) => a.localeCompare(b));
    return names;
  }, [leads]);

  const statusFilters = useMemo(
    () => [ALL_STATUSES, ...statusOptions],
    [statusOptions]
  );

  const keyExtractor = useCallback((item: Lead) => item.id, []);

  const renderItem = useCallback(
    ({ item }: { item: Lead }) => (
      <Pressable
        onPress={() => navigation.navigate("LeadDetail", { leadId: item.id })}
        style={({ pressed }) => [styles.cardWrap, pressed && { opacity: 0.9 }]}
      >
        <Card style={{ marginBottom: spacing.sm }}>
          <View style={styles.cardTopRow}>
            <Text style={[styles.externalId, { color: colors.text }]}>{item.externalId}</Text>
            <Badge
              label={item.currentStatus?.name ?? "-"}
              tone="success"
              style={{ backgroundColor: item.currentStatus?.colorCode ?? "#e8f5ef" }}
            />
          </View>
          <Text style={[styles.name, { color: colors.text }]}>{item.name}</Text>
          <Text style={[styles.phone, { color: colors.text }]}>{item.phone}</Text>
          <Text style={[styles.metaLine, { color: colors.textMuted }]}>
            {item.district?.name ? `${item.district.name}, ${item.district.state}` : "District not set"}
          </Text>
          <Text style={[styles.metaLine, { color: colors.textMuted }]}>
            Updated: {new Date(item.updatedAt).toLocaleString()}
          </Text>
        </Card>
      </Pressable>
    ),
    [colors.text, colors.textMuted, navigation]
  );

  return (
    <AppScreen style={{ paddingBottom: 0 }}>
      <Card>
        <SectionTitle title="Assigned Leads" subtitle="Sorted by last updated activity" />
      </Card>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8, marginBottom: 10 }}
      >
        {statusFilters.map((statusName) => {
          const isActive = statusName === selectedStatus;
          const label = statusName === ALL_STATUSES ? "All Statuses" : statusName;
          return (
            <Pressable
              key={statusName}
              onPress={() => setSelectedStatus(statusName)}
              style={[
                styles.filterChip,
                { borderColor: colors.border, backgroundColor: colors.surface },
                isActive && {
                  borderColor: colors.primary,
                  backgroundColor: colors.accent
                }
              ]}
            >
              <Text
                style={[
                  styles.filterLabel,
                  { color: colors.text },
                  isActive && { color: colors.primary }
                ]}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {error ? <Text style={[styles.error, { color: colors.danger }]}>{error}</Text> : null}

      <FlatList
        data={sortedLeads}
        contentContainerStyle={{ paddingBottom: spacing.xl }}
        keyExtractor={keyExtractor}
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={10}
        removeClippedSubviews
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              void load();
            }}
          />
        }
        ListEmptyComponent={
          <Text style={[styles.emptyText, { color: colors.textMuted }]}>
            {refreshing ? "Loading leads..." : "No assigned leads found."}
          </Text>
        }
        renderItem={renderItem}
      />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  filterChip: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1
  },
  filterLabel: {
    fontWeight: "600"
  },
  error: {
    marginBottom: 8
  },
  emptyText: {
    marginTop: 12
  },
  cardWrap: {
    marginBottom: 0
  },
  cardTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center"
  },
  externalId: {
    fontWeight: "800"
  },
  name: {
    fontWeight: "700",
    marginTop: 4
  },
  phone: {
    marginTop: 2
  },
  metaLine: {
    marginTop: 4,
    fontSize: 12
  }
});
