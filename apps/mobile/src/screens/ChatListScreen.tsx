import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { api } from "../services/api";
import { AppScreen, Card, SectionTitle, useAppPalette } from "../ui/primitives";
import { spacing } from "../ui/theme";
import { useMobileI18n } from "../i18n";

export type ChatStackParamList = {
  ChatList: undefined;
  ChatThread: {
    conversationId: string;
    title?: string;
    peer?: {
      id: string;
      fullName: string;
      roleLabel?: string;
      isOnline?: boolean;
      lastActiveAt?: string | null;
      status?: string;
    };
  };
};

type Props = NativeStackScreenProps<ChatStackParamList, "ChatList">;

type ChatParticipant = {
  id: string;
  fullName: string;
  roleLabel: string;
  status: string;
  isOnline: boolean;
  lastActiveAt: string | null;
};

type ChatConversation = {
  id: string;
  peers: Array<{
    id: string;
    fullName: string;
    roleLabel: string;
    status: string;
    isOnline: boolean;
    lastActiveAt: string | null;
  }>;
  lastMessage: {
    body: string;
    createdAt: string;
  } | null;
  unreadCount: number;
};

function dedupeParticipants(items: ChatParticipant[]) {
  const seen = new Set<string>();
  const output: ChatParticipant[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    output.push(item);
  }
  return output;
}

export function ChatListScreen({ navigation }: Props) {
  const colors = useAppPalette();
  const { t } = useMobileI18n();
  const [participants, setParticipants] = useState<ChatParticipant[]>([]);
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [search, setSearch] = useState("");
  const [conversationError, setConversationError] = useState<string | null>(null);
  const [participantError, setParticipantError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [participantsLoading, setParticipantsLoading] = useState(false);
  const participantRequestIdRef = useRef(0);

  const loadConversations = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;
    if (!silent) {
      setLoading(true);
    }
    try {
      const response = await api.get("/api/chat/conversations");
      const data = (response.data?.data ?? []) as ChatConversation[];
      setConversations(data);
      if (!silent) {
        setConversationError(null);
      }
    } catch {
      if (!silent) {
        setConversationError(t("chat.loadFailed"));
      }
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, [t]);

  const loadParticipants = useCallback(
    async (value: string) => {
      const requestId = participantRequestIdRef.current + 1;
      participantRequestIdRef.current = requestId;
      setParticipantsLoading(true);
      try {
        const trimmed = value.trim();
        const response = await api.get("/api/chat/participants", {
          params: trimmed ? { search: trimmed } : undefined
        });
        if (participantRequestIdRef.current !== requestId) {
          return;
        }
        const data = (response.data?.data ?? []) as ChatParticipant[];
        setParticipants(dedupeParticipants(data));
        setParticipantError(null);
      } catch {
        if (participantRequestIdRef.current === requestId) {
          setParticipantError(t("chat.participantsLoadFailed"));
        }
      } finally {
        if (participantRequestIdRef.current === requestId) {
          setParticipantsLoading(false);
        }
      }
    },
    [t]
  );

  useEffect(() => {
    void loadConversations();
    const timer = setInterval(() => {
      void loadConversations({ silent: true });
    }, 8000);
    return () => clearInterval(timer);
  }, [loadConversations]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadParticipants(search);
    }, 250);
    return () => clearTimeout(timer);
  }, [loadParticipants, search]);

  const visibleParticipants = useMemo(() => participants, [participants]);

  const openOrCreateConversation = async (participant: ChatParticipant) => {
    try {
      const response = await api.post("/api/chat/conversations", {
        participantUserId: participant.id
      });
      const conversationId = response.data?.data?.conversationId as string | undefined;
      if (!conversationId) return;
      navigation.navigate("ChatThread", {
        conversationId,
        title: participant.fullName,
        peer: {
          id: participant.id,
          fullName: participant.fullName,
          roleLabel: participant.roleLabel,
          isOnline: participant.isOnline,
          lastActiveAt: participant.lastActiveAt,
          status: participant.status
        }
      });
      void loadConversations({ silent: true });
    } catch {
      setConversationError(t("chat.loadFailed"));
    }
  };

  return (
    <AppScreen scroll>
      <Card>
        <SectionTitle title={t("chat.title")} subtitle={t("chat.subtitle")} />
      </Card>

      {conversationError ? (
        <Card>
          <Text style={{ color: colors.danger }}>{conversationError}</Text>
        </Card>
      ) : null}

      {participantError ? (
        <Card>
          <Text style={{ color: colors.danger }}>{participantError}</Text>
        </Card>
      ) : null}

      <Card style={{ gap: spacing.sm }}>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder={t("chat.searchPeople")}
          placeholderTextColor={colors.textMuted}
          style={[
            styles.input,
            {
              color: colors.text,
              borderColor: colors.border,
              backgroundColor: colors.surface
            }
          ]}
        />
        <View style={styles.listWrap}>
          {participantsLoading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={{ color: colors.textMuted }}>{t("common.loading")}</Text>
            </View>
          ) : visibleParticipants.length === 0 ? (
            <Text style={{ color: colors.textMuted }}>{t("chat.noParticipants")}</Text>
          ) : (
            <View
              style={[
                styles.searchResultsBox,
                { borderColor: colors.border, backgroundColor: colors.surfaceMuted }
              ]}
            >
              <ScrollView
                style={styles.searchResultsScroll}
                contentContainerStyle={styles.searchResultsContent}
                nestedScrollEnabled
                keyboardShouldPersistTaps="handled"
              >
                {visibleParticipants.map((participant) => (
                  <Pressable
                    key={participant.id}
                    onPress={() => {
                      void openOrCreateConversation(participant);
                    }}
                    style={({ pressed }) => [
                      styles.listItem,
                      {
                        borderColor: colors.border,
                        backgroundColor: pressed ? colors.surface : colors.surfaceMuted
                      }
                    ]}
                  >
                    <Text style={{ color: colors.text, fontWeight: "700" }}>{participant.fullName}</Text>
                    <Text style={{ color: colors.textMuted, fontSize: 12 }}>
                      {participant.roleLabel}
                      {` • ${participant.isOnline ? t("chat.online") : t("chat.offline")}`}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          )}
        </View>
      </Card>

      <Card style={{ gap: spacing.xs }}>
        <Text style={{ color: colors.text, fontWeight: "700" }}>{t("chat.title")}</Text>
        {loading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={{ color: colors.textMuted }}>{t("common.loading")}</Text>
          </View>
        ) : conversations.length === 0 ? (
          <Text style={{ color: colors.textMuted }}>{t("chat.noConversations")}</Text>
        ) : (
          conversations.map((conversation) => {
            const peer = conversation.peers[0];
            return (
              <Pressable
                key={conversation.id}
                  onPress={() => {
                    navigation.navigate("ChatThread", {
                      conversationId: conversation.id,
                      title: peer?.fullName ?? t("chat.title"),
                      peer
                    });
                  }}
                  style={({ pressed }) => [
                  styles.conversationItem,
                  {
                    borderColor: colors.border,
                    backgroundColor: pressed ? colors.surfaceMuted : colors.surface
                  }
                ]}
              >
                <View style={styles.row}>
                  <Text style={{ color: colors.text, fontWeight: "700", flex: 1 }}>
                    {peer?.fullName ?? t("chat.title")}
                  </Text>
                  {conversation.unreadCount > 0 ? (
                    <Text style={{ color: colors.danger, fontWeight: "700", fontSize: 12 }}>
                      {t("chat.unread")}: {conversation.unreadCount}
                    </Text>
                  ) : null}
                </View>
                <Text style={{ color: colors.textMuted, fontSize: 12 }}>
                  {conversation.lastMessage?.body ?? t("chat.noMessages")}
                </Text>
              </Pressable>
            );
          })
        )}
      </Card>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  listWrap: {
    gap: spacing.xs
  },
  searchResultsBox: {
    maxHeight: 220,
    borderWidth: 1,
    borderRadius: 10,
    overflow: "hidden"
  },
  searchResultsScroll: {
    maxHeight: 220
  },
  searchResultsContent: {
    padding: spacing.xs,
    gap: spacing.xs
  },
  listItem: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 10
  },
  conversationItem: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    gap: 4
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs
  }
});
