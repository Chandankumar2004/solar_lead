import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { api } from "../services/api";
import { useAuthStore } from "../store/auth-store";
import { AppScreen, Card, useAppPalette } from "../ui/primitives";
import { spacing } from "../ui/theme";
import { useMobileI18n } from "../i18n";
import type { ChatStackParamList } from "./ChatListScreen";

type Props = NativeStackScreenProps<ChatStackParamList, "ChatThread">;

type ChatMessage = {
  id: string;
  body: string;
  createdAt: string;
  sender: {
    id: string;
    fullName: string;
    roleLabel: string;
  };
};

export function ChatThreadScreen({ route }: Props) {
  const colors = useAppPalette();
  const { t, formatDateTime } = useMobileI18n();
  const currentUser = useAuthStore((state) => state.user);
  const currentUserId = currentUser?.id ?? null;
  const { conversationId, title, peer } = route.params;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [composer, setComposer] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<FlatList<ChatMessage> | null>(null);
  const messageRequestIdRef = useRef(0);
  const activeConversationIdRef = useRef(conversationId);
  const lastMarkedMessageIdRef = useRef<string | null>(null);
  const shouldAutoScrollRef = useRef(true);
  const previousConversationIdRef = useRef<string | null>(null);
  const previousMessageCountRef = useRef(0);

  const presenceText = useMemo(() => {
    if (peer?.isOnline) {
      return t("chat.online");
    }
    if (peer?.lastActiveAt) {
      return `${t("chat.offline")} • ${t("chat.lastSeen", {
        value: formatDateTime(peer.lastActiveAt)
      })}`;
    }
    return t("chat.offline");
  }, [formatDateTime, peer?.isOnline, peer?.lastActiveAt, t]);

  const scrollToBottom = useCallback((animated: boolean) => {
    listRef.current?.scrollToEnd({ animated });
  }, []);

  const onMessageListScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const distanceFromBottom = contentSize.height - (contentOffset.y + layoutMeasurement.height);
    shouldAutoScrollRef.current = distanceFromBottom < 80;
  }, []);

  useEffect(() => {
    activeConversationIdRef.current = conversationId;
  }, [conversationId]);

  const markRead = useCallback(async () => {
    try {
      await api.post(`/api/chat/conversations/${conversationId}/read`);
    } catch {
      // Ignore read failures.
    }
  }, [conversationId]);

  const loadMessages = useCallback(
    async (options?: { silent?: boolean }) => {
      const silent = options?.silent ?? false;
      const requestId = messageRequestIdRef.current + 1;
      messageRequestIdRef.current = requestId;
      if (!silent) {
        setLoading(true);
      }
      try {
        const response = await api.get(`/api/chat/conversations/${conversationId}/messages`);
        if (messageRequestIdRef.current !== requestId) {
          return;
        }
        if (activeConversationIdRef.current !== conversationId) {
          return;
        }
        const payload = response.data?.data as
          | { conversation?: { id: string }; messages?: ChatMessage[] }
          | undefined;
        if (payload?.conversation?.id && payload.conversation.id !== conversationId) {
          return;
        }
        const nextMessages = payload?.messages ?? [];
        setMessages(nextMessages);
        const latestMessage = nextMessages[nextMessages.length - 1];
        if (
          latestMessage &&
          latestMessage.sender.id !== currentUserId &&
          latestMessage.id !== lastMarkedMessageIdRef.current
        ) {
          lastMarkedMessageIdRef.current = latestMessage.id;
          void markRead();
        }
        if (!silent) {
          setError(null);
        }
      } catch {
        if (
          !silent &&
          messageRequestIdRef.current === requestId &&
          activeConversationIdRef.current === conversationId
        ) {
          setError(t("chat.loadFailed"));
        }
      } finally {
        if (
          !silent &&
          messageRequestIdRef.current === requestId &&
          activeConversationIdRef.current === conversationId
        ) {
          setLoading(false);
        }
      }
    },
    [conversationId, currentUserId, markRead, t]
  );

  useEffect(() => {
    shouldAutoScrollRef.current = true;
    lastMarkedMessageIdRef.current = null;
    setMessages([]);
    setError(null);
    void loadMessages();
    const timer = setInterval(() => {
      void loadMessages({ silent: true });
    }, 4000);
    return () => clearInterval(timer);
  }, [loadMessages]);

  useEffect(() => {
    if (messages.length === 0) {
      previousConversationIdRef.current = conversationId;
      previousMessageCountRef.current = 0;
      return;
    }

    const conversationChanged = previousConversationIdRef.current !== conversationId;
    const messageCountChanged = previousMessageCountRef.current !== messages.length;

    if (conversationChanged || (messageCountChanged && shouldAutoScrollRef.current)) {
      requestAnimationFrame(() => {
        scrollToBottom(!conversationChanged);
      });
    }

    previousConversationIdRef.current = conversationId;
    previousMessageCountRef.current = messages.length;
  }, [conversationId, messages.length, scrollToBottom]);

  const sendMessage = async () => {
    const body = composer.trim();
    if (!body || sending) return;
    const optimisticId = `tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const optimisticCreatedAt = new Date().toISOString();
    const optimisticMessage: ChatMessage = {
      id: optimisticId,
      body,
      createdAt: optimisticCreatedAt,
      sender: {
        id: currentUserId ?? "unknown",
        fullName: currentUser?.fullName ?? t("chat.you"),
        roleLabel: currentUser?.roleLabel ?? ""
      }
    };

    setMessages((previous) => [...previous, optimisticMessage]);
    setComposer("");
    setError(null);
    shouldAutoScrollRef.current = true;
    setSending(true);
    try {
      const response = await api.post(`/api/chat/conversations/${conversationId}/messages`, { body });
      const created = response.data?.data as ChatMessage | undefined;
      if (created?.id) {
        setMessages((previous) =>
          previous.map((message) => (message.id === optimisticId ? created : message))
        );
      }
    } catch {
      setMessages((previous) => previous.filter((message) => message.id !== optimisticId));
      setComposer(body);
      setError(t("chat.loadFailed"));
    } finally {
      setSending(false);
    }
  };

  return (
    <AppScreen>
      <Card>
        <Text style={{ color: colors.text, fontWeight: "800", fontSize: 18 }}>
          {title || t("chat.title")}
        </Text>
        <View style={styles.presenceRow}>
          <View
            style={[
              styles.presenceDot,
              { backgroundColor: peer?.isOnline ? colors.primary : colors.textMuted }
            ]}
          />
          <Text style={{ color: peer?.isOnline ? colors.primary : colors.textMuted, fontSize: 12 }}>
            {presenceText}
          </Text>
        </View>
      </Card>

      {error ? (
        <Card>
          <Text style={{ color: colors.danger }}>{error}</Text>
          <Pressable
            onPress={() => {
              void loadMessages();
            }}
            style={({ pressed }) => [
              styles.retryButton,
              {
                borderColor: colors.border,
                backgroundColor: pressed ? colors.surfaceMuted : colors.surface
              }
            ]}
          >
            <Text style={{ color: colors.text, fontWeight: "700", fontSize: 12 }}>
              Retry
            </Text>
          </Pressable>
        </Card>
      ) : null}

      <Card style={styles.messagesWrap}>
        {loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={{ color: colors.textMuted }}>{t("common.loading")}</Text>
          </View>
        ) : messages.length === 0 ? (
          <View style={styles.loadingWrap}>
            <Text style={{ color: colors.textMuted }}>{t("chat.noMessages")}</Text>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(item) => item.id}
            style={styles.messageList}
            contentContainerStyle={styles.messageListContent}
            onScroll={onMessageListScroll}
            scrollEventThrottle={16}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => {
              const isCurrentUser = item.sender.id === currentUserId;
              return (
                <View style={[styles.messageRow, { justifyContent: isCurrentUser ? "flex-end" : "flex-start" }]}>
                  <View
                    style={[
                      styles.messageBubble,
                      {
                        borderColor: isCurrentUser ? colors.primary : colors.border,
                        backgroundColor: isCurrentUser ? colors.primary : colors.surfaceMuted
                      }
                    ]}
                  >
                    <View style={styles.messageMetaRow}>
                      <Text
                        style={{
                          color: isCurrentUser ? "#ffffff" : colors.text,
                          fontWeight: "700",
                          fontSize: 12
                        }}
                      >
                        {isCurrentUser ? t("chat.you") : item.sender.fullName}
                      </Text>
                      <Text
                        style={{
                          color: isCurrentUser ? "rgba(255,255,255,0.82)" : colors.textMuted,
                          fontSize: 11
                        }}
                      >
                        {formatDateTime(item.createdAt)}
                      </Text>
                    </View>
                    <Text style={{ color: isCurrentUser ? "#ffffff" : colors.text }}>{item.body}</Text>
                  </View>
                </View>
              );
            }}
          />
        )}
      </Card>

      <Card style={styles.composerRow}>
        <TextInput
          value={composer}
          onChangeText={setComposer}
          placeholder={t("chat.typeMessage")}
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
        <Pressable
          onPress={() => {
            void sendMessage();
          }}
          disabled={sending || !composer.trim()}
          style={[
            styles.sendButton,
            {
              backgroundColor: colors.primary,
              opacity: sending || !composer.trim() ? 0.6 : 1
            }
          ]}
        >
          <Text style={{ color: "#fff", fontWeight: "700" }}>
            {sending ? t("chat.sending") : t("chat.send")}
          </Text>
        </Pressable>
      </Card>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  loadingWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs
  },
  messagesWrap: {
    flex: 1,
    minHeight: 220,
    padding: 0,
    overflow: "hidden"
  },
  messageList: {
    flex: 1
  },
  messageListContent: {
    padding: 12,
    gap: spacing.xs
  },
  messageRow: {
    width: "100%",
    flexDirection: "row"
  },
  messageBubble: {
    maxWidth: "84%",
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    gap: 4
  },
  messageMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.xs
  },
  presenceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs
  },
  presenceDot: {
    width: 8,
    height: 8,
    borderRadius: 999
  },
  retryButton: {
    marginTop: spacing.xs,
    alignSelf: "flex-start",
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6
  },
  composerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  sendButton: {
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10
  }
});
