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
import { readOfflineCache, writeOfflineCache } from "../services/offline-cache";
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
const SORT_NEWEST = "NEWEST";
const SORT_OLDEST = "OLDEST";
const LEAD_LIST_CACHE_KEY = "lead-list";

export function LeadListScreen() {
  const colors = useAppPalette();
  const navigation = useNavigation<NativeStackNavigationProp<LeadsStackParamList>>();
  const user = useAuthStore((s) => s.user);

  const [leads, setLeads] = useState<Lead[]>([]);
  const [selectedStatus, setSelectedStatus] = useState<string>(ALL_STATUSES);
  const [sortOrder, setSortOrder] = useState<typeof SORT_NEWEST | typeof SORT_OLDEST>(
    SORT_NEWEST
  );
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!user?.id) return;
    setRefreshing(true);
    setError(null);
    try {
      const baseParams = {
        pageSize: 100,
        execId: user.id
      };

      const firstPage = await api.get("/api/leads", {
        params: {
          ...baseParams,
          page: 1
        }
      });

      const allRows: Lead[] = Array.isArray(firstPage.data?.data)
        ? (firstPage.data.data as Lead[])
        : [];

      const totalPages = Number(firstPage.data?.pagination?.totalPages ?? 1);
      let partialPageLoadFailed = false;

      if (Number.isFinite(totalPages) && totalPages > 1) {
        for (let page = 2; page <= totalPages; page += 1) {
          try {
            const pageResponse = await api.get("/api/leads", {
              params: {
                ...baseParams,
                page
              }
            });
            const pageRows = Array.isArray(pageResponse.data?.data)
              ? (pageResponse.data.data as Lead[])
              : [];
            allRows.push(...pageRows);
          } catch {
            partialPageLoadFailed = true;
            break;
          }
        }
      }

      const deduped = Array.from(new Map(allRows.map((row) => [row.id, row])).values());
      setLeads(deduped);
      await writeOfflineCache(user.id, LEAD_LIST_CACHE_KEY, deduped);

      if (partialPageLoadFailed) {
        setError("Some leads could not be loaded. Pull to refresh.");
      }
    } catch {
      const cached = await readOfflineCache<Lead[]>(user.id, LEAD_LIST_CACHE_KEY);
      if (cached && cached.length > 0) {
        setLeads(cached);
        setError("Offline mode: showing cached leads.");
      } else {
        setError("Failed to load leads.");
        setLeads([]);
      }
    } finally {
      setRefreshing(false);
    }
  }, [user?.id]);

  const filteredLeads = useMemo(() => {
    if (selectedStatus === ALL_STATUSES) {
      return leads;
    }
    return leads.filter((lead) => lead.currentStatus?.name === selectedStatus);
  }, [leads, selectedStatus]);

  const sortedLeads = useMemo(
    () =>
      [...filteredLeads].sort((a, b) => {
        const aTs = new Date(a.updatedAt).getTime();
        const bTs = new Date(b.updatedAt).getTime();
        if (sortOrder === SORT_OLDEST) {
          return aTs - bTs;
        }
        return bTs - aTs;
      }),
    [filteredLeads, sortOrder]
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
        <SectionTitle
          title="Assigned Leads"
          subtitle={sortOrder === SORT_OLDEST ? "Sorted by oldest update first" : "Sorted by newest update first"}
        />
      </Card>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8, marginBottom: 10 }}
      >
        <Pressable
          onPress={() => setSortOrder(SORT_NEWEST)}
          style={[
            styles.filterChip,
            { borderColor: colors.border, backgroundColor: colors.surface },
            sortOrder === SORT_NEWEST && {
              borderColor: colors.primary,
              backgroundColor: colors.accent
            }
          ]}
        >
          <Text
            style={[
              styles.filterLabel,
              { color: colors.text },
              sortOrder === SORT_NEWEST && { color: colors.primary }
            ]}
          >
            Newest
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setSortOrder(SORT_OLDEST)}
          style={[
            styles.filterChip,
            { borderColor: colors.border, backgroundColor: colors.surface },
            sortOrder === SORT_OLDEST && {
              borderColor: colors.primary,
              backgroundColor: colors.accent
            }
          ]}
        >
          <Text
            style={[
              styles.filterLabel,
              { color: colors.text },
              sortOrder === SORT_OLDEST && { color: colors.primary }
            ]}
          >
            Oldest
          </Text>
        </Pressable>
      </ScrollView>

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
