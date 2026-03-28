"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, getApiErrorMessage } from "@/lib/api";
import { useWebI18n } from "@/lib/i18n/provider";
import { useSearchParams } from "next/navigation";
import { useAuthStore } from "@/lib/auth-store";

type ChatParticipant = {
  id: string;
  fullName: string;
  email: string;
  role: string;
  roleLabel: string;
  status: string;
  isOnline: boolean;
  lastActiveAt: string | null;
};

type ChatConversation = {
  id: string;
  type: string;
  lead: {
    id: string;
    externalId: string;
    name: string;
    district: {
      id: string;
      name: string;
      state: string;
    };
  } | null;
  participants: Array<{
    id: string;
    fullName: string;
    role: string;
    roleLabel: string;
    status: string;
    isOnline: boolean;
    lastActiveAt: string | null;
  }>;
  peers: Array<{
    id: string;
    fullName: string;
    role: string;
    roleLabel: string;
    status: string;
    isOnline: boolean;
    lastActiveAt: string | null;
  }>;
  lastMessage: {
    id: string;
    body: string;
    createdAt: string;
    senderUserId: string;
  } | null;
  unreadCount: number;
  lastReadAt: string | null;
  lastMessageAt: string;
};

type ChatMessage = {
  id: string;
  body: string;
  createdAt: string;
  sender: {
    id: string;
    fullName: string;
    role: string;
    roleLabel: string;
  };
};

export default function ChatPage() {
  const { t, formatDateTime } = useWebI18n();
  const authUser = useAuthStore((state) => state.user);
  const searchParams = useSearchParams();
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [participants, setParticipants] = useState<ChatParticipant[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [searchPeople, setSearchPeople] = useState("");
  const [composer, setComposer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [participantError, setParticipantError] = useState<string | null>(null);
  const [participantsLoading, setParticipantsLoading] = useState(false);
  const participantRequestIdRef = useRef(0);
  const conversationRequestIdRef = useRef(0);
  const messageRequestIdRef = useRef(0);
  const activeConversationIdRef = useRef<string | null>(null);
  const lastMarkedMessageIdRef = useRef<string | null>(null);
  const messageContainerRef = useRef<HTMLDivElement | null>(null);
  const shouldAutoScrollRef = useRef(true);
  const previousMessageCountRef = useRef(0);
  const previousConversationIdRef = useRef<string | null>(null);

  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === activeConversationId) ?? null,
    [activeConversationId, conversations]
  );

  const scrollMessagesToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const container = messageContainerRef.current;
    if (!container) return;
    container.scrollTo({
      top: container.scrollHeight,
      behavior
    });
  }, []);

  useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
  }, [activeConversationId]);

  const fetchConversations = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;
    const requestId = conversationRequestIdRef.current + 1;
    conversationRequestIdRef.current = requestId;
    if (!silent) {
      setLoadingConversations(true);
    }
    try {
      const response = await api.get("/api/chat/conversations");
      if (conversationRequestIdRef.current !== requestId) {
        return;
      }
      const data = (response.data?.data ?? []) as ChatConversation[];
      setConversations(data);
      setActiveConversationId((current) => {
        if (data.length === 0) return null;
        if (current && data.some((conversation) => conversation.id === current)) {
          return current;
        }
        return data[0]?.id ?? null;
      });
      if (!silent) {
        setError(null);
      }
    } catch (loadError) {
      if (!silent && conversationRequestIdRef.current === requestId) {
        setError(getApiErrorMessage(loadError, t("chat.loadFailed")));
      }
    } finally {
      if (!silent && conversationRequestIdRef.current === requestId) {
        setLoadingConversations(false);
      }
    }
  }, [t]);

  const fetchParticipants = useCallback(
    async (search: string) => {
      const requestId = participantRequestIdRef.current + 1;
      participantRequestIdRef.current = requestId;
      setParticipantsLoading(true);
      try {
        const trimmed = search.trim();
        const response = await api.get("/api/chat/participants", {
          params: trimmed ? { search: trimmed } : undefined
        });
        if (participantRequestIdRef.current !== requestId) {
          return;
        }
        const data = (response.data?.data ?? []) as ChatParticipant[];
        setParticipants(data);
        setParticipantError(null);
      } catch (loadError) {
        if (participantRequestIdRef.current === requestId) {
          setParticipantError(getApiErrorMessage(loadError, t("chat.participantsLoadFailed")));
        }
      } finally {
        if (participantRequestIdRef.current === requestId) {
          setParticipantsLoading(false);
        }
      }
    },
    [t]
  );

  const markConversationRead = useCallback(async (conversationId: string) => {
    try {
      await api.post(`/api/chat/conversations/${conversationId}/read`);
    } catch {
      // Ignore read marker failures.
    }
  }, []);

  const fetchMessages = useCallback(
    async (conversationId: string, options?: { silent?: boolean }) => {
      const silent = options?.silent ?? false;
      const requestId = messageRequestIdRef.current + 1;
      messageRequestIdRef.current = requestId;
      if (!silent) {
        setLoadingMessages(true);
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
          latestMessage.sender.id !== authUser?.id &&
          latestMessage.id !== lastMarkedMessageIdRef.current
        ) {
          lastMarkedMessageIdRef.current = latestMessage.id;
          void markConversationRead(conversationId);
        }
        if (!silent) {
          setError(null);
        }
      } catch (loadError) {
        if (
          !silent &&
          messageRequestIdRef.current === requestId &&
          activeConversationIdRef.current === conversationId
        ) {
          setError(getApiErrorMessage(loadError, t("chat.loadFailed")));
        }
      } finally {
        if (
          !silent &&
          messageRequestIdRef.current === requestId &&
          activeConversationIdRef.current === conversationId
        ) {
          setLoadingMessages(false);
        }
      }
    },
    [authUser?.id, markConversationRead, t]
  );

  useEffect(() => {
    void fetchConversations();
    const timer = setInterval(() => {
      void fetchConversations({ silent: true });
    }, 8000);
    return () => clearInterval(timer);
  }, [fetchConversations]);

  useEffect(() => {
    const fromQuery = searchParams.get("conversationId");
    if (!fromQuery) return;
    const exists = conversations.some((conversation) => conversation.id === fromQuery);
    if (exists) {
      setActiveConversationId(fromQuery);
    }
  }, [conversations, searchParams]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void fetchParticipants(searchPeople);
    }, 250);
    return () => clearTimeout(timer);
  }, [fetchParticipants, searchPeople]);

  useEffect(() => {
    if (!activeConversationId) {
      setMessages([]);
      lastMarkedMessageIdRef.current = null;
      return;
    }
    shouldAutoScrollRef.current = true;
    lastMarkedMessageIdRef.current = null;
    setMessages([]);
    void fetchMessages(activeConversationId);

    const timer = setInterval(() => {
      void fetchMessages(activeConversationId, { silent: true });
    }, 4000);
    return () => clearInterval(timer);
  }, [activeConversationId, fetchMessages]);

  useEffect(() => {
    if (!activeConversationId) {
      previousConversationIdRef.current = null;
      previousMessageCountRef.current = 0;
      return;
    }

    const conversationChanged = previousConversationIdRef.current !== activeConversationId;
    const messageCountChanged = previousMessageCountRef.current !== messages.length;

    if (conversationChanged || (messageCountChanged && shouldAutoScrollRef.current)) {
      requestAnimationFrame(() => {
        scrollMessagesToBottom(conversationChanged ? "auto" : "smooth");
      });
    }

    previousConversationIdRef.current = activeConversationId;
    previousMessageCountRef.current = messages.length;
  }, [activeConversationId, messages.length, scrollMessagesToBottom]);

  const openOrCreateConversation = async (participantUserId: string) => {
    try {
      const response = await api.post("/api/chat/conversations", { participantUserId });
      const conversationId = response.data?.data?.conversationId as string | undefined;
      if (!conversationId) return;
      setActiveConversationId(conversationId);
      void fetchConversations({ silent: true });
    } catch (loadError) {
      setError(getApiErrorMessage(loadError, t("chat.loadFailed")));
    }
  };

  const sendMessage = async () => {
    if (!activeConversationId) return;
    const body = composer.trim();
    if (!body || sending) return;
    const optimisticId = `tmp-${Date.now()}`;
    const optimisticMessage: ChatMessage = {
      id: optimisticId,
      body,
      createdAt: new Date().toISOString(),
      sender: {
        id: authUser?.id ?? "unknown",
        fullName: authUser?.fullName ?? t("chat.you"),
        role: authUser?.role ?? "FIELD_EXECUTIVE",
        roleLabel: authUser?.roleLabel ?? "Field Executive"
      }
    };
    setMessages((previous) => [...previous, optimisticMessage]);
    shouldAutoScrollRef.current = true;
    setComposer("");
    setError(null);
    setSending(true);
    try {
      const response = await api.post(`/api/chat/conversations/${activeConversationId}/messages`, { body });
      const createdMessage = response.data?.data as ChatMessage | undefined;
      if (createdMessage?.id) {
        setMessages((previous) =>
          previous.map((message) => (message.id === optimisticId ? createdMessage : message))
        );
      }
      void fetchConversations({ silent: true });
    } catch (sendError) {
      setMessages((previous) => previous.filter((message) => message.id !== optimisticId));
      setComposer(body);
      setError(getApiErrorMessage(sendError, t("chat.loadFailed")));
    } finally {
      setSending(false);
    }
  };

  const activePeer =
    activeConversation?.peers[0] ??
    activeConversation?.participants.find((participant) => participant.id !== authUser?.id) ??
    null;
  const presence = useMemo(() => {
    if (!activePeer) return t("chat.lastSeenUnavailable");
    if (activePeer.isOnline) {
      return t("chat.online");
    }
    if (activePeer.lastActiveAt) {
      return `${t("chat.offline")} • ${t("chat.lastSeen", { value: formatDateTime(activePeer.lastActiveAt) })}`;
    }
    return t("chat.offline");
  }, [activePeer, formatDateTime, t]);

  return (
    <div className="grid h-[72vh] min-h-[72vh] gap-4 lg:grid-cols-[320px_1fr]">
      <section className="flex h-full min-h-0 flex-col rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <h3 className="text-base font-semibold">{t("chat.pageTitle")}</h3>
        <p className="mt-1 text-xs text-slate-500">{t("chat.pageSubtitle")}</p>

        <div className="mt-3">
          <label className="mb-1 block text-xs font-medium text-slate-600">{t("chat.searchPeople")}</label>
          <input
            value={searchPeople}
            onChange={(event) => setSearchPeople(event.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            placeholder={t("chat.searchPeople")}
          />
        </div>

        <div className="mt-2 max-h-40 overflow-auto rounded-md border border-slate-200">
          {participantError ? (
            <p className="p-2 text-xs text-rose-600">{participantError}</p>
          ) : participantsLoading ? (
            <div className="flex items-center gap-2 p-2 text-xs text-slate-500">
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-slate-500" />
              {t("common.loading")}
            </div>
          ) : participants.length === 0 ? (
            <p className="p-2 text-xs text-slate-500">{t("chat.noParticipants")}</p>
          ) : (
            participants.map((participant) => (
              <button
                key={participant.id}
                onClick={() => void openOrCreateConversation(participant.id)}
                className="w-full border-b border-slate-100 px-3 py-2 text-left text-sm hover:bg-slate-50"
              >
                <p className="font-medium">{participant.fullName}</p>
                <p className="text-xs text-slate-500">
                  {participant.roleLabel} • {participant.isOnline ? t("chat.online") : t("chat.offline")}
                </p>
              </button>
            ))
          )}
        </div>

        <div className="mt-4 min-h-0 flex-1 overflow-hidden rounded-md border border-slate-200">
          {loadingConversations ? (
            <div className="flex items-center gap-2 p-3 text-sm text-slate-500">
              <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-500" />
              {t("common.loading")}
            </div>
          ) : conversations.length === 0 ? (
            <p className="p-3 text-sm text-slate-500">{t("chat.noConversations")}</p>
          ) : (
            <div className="h-full overflow-y-auto">
              {conversations.map((conversation) => {
                const active = conversation.id === activeConversationId;
                const title =
                  conversation.peers[0]?.fullName ??
                  conversation.participants[0]?.fullName ??
                  t("chat.defaultTitle");
                return (
                  <button
                    key={conversation.id}
                    onClick={() => setActiveConversationId(conversation.id)}
                    className={`w-full border-b border-slate-100 px-3 py-2 text-left ${
                      active ? "bg-brand-50" : "hover:bg-slate-50"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-semibold">{title}</p>
                      {conversation.unreadCount > 0 ? (
                        <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-700">
                          {t("chat.unread")}: {conversation.unreadCount}
                        </span>
                      ) : null}
                    </div>
                    <p className="truncate text-xs text-slate-500">
                      {conversation.lastMessage?.body ?? t("chat.noMessages")}
                    </p>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <section className="flex h-full min-h-0 flex-col rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        {error ? (
          <div className="mb-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        {!activeConversation ? (
          <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
            {t("chat.selectConversation")}
          </div>
        ) : (
          <>
            <div className="border-b border-slate-200 pb-2">
              <h4 className="text-base font-semibold">
                {activeConversation.peers[0]?.fullName ?? activeConversation.participants[0]?.fullName}
              </h4>
              <div className="mt-1 flex items-center gap-2">
                <span
                  className={`h-2.5 w-2.5 rounded-full ${
                    activePeer?.isOnline ? "bg-emerald-500" : "bg-slate-400"
                  }`}
                />
                <p className={`text-xs ${activePeer?.isOnline ? "text-emerald-600" : "text-slate-500"}`}>
                  {presence}
                </p>
              </div>
              {activeConversation.lead ? (
                <p className="text-xs text-slate-500">
                  {t("chat.leadLabel")}: {activeConversation.lead.externalId} •{" "}
                  {activeConversation.lead.name}
                </p>
              ) : null}
            </div>

            <div className="mt-2 min-h-0 flex-1 overflow-hidden">
              <div
                ref={messageContainerRef}
                onScroll={(event) => {
                  const target = event.currentTarget;
                  const distanceToBottom =
                    target.scrollHeight - target.scrollTop - target.clientHeight;
                  shouldAutoScrollRef.current = distanceToBottom < 100;
                }}
                className="h-full space-y-2 overflow-y-auto rounded-md border border-slate-200 bg-slate-50 p-2"
              >
              {loadingMessages ? (
                <div className="flex items-center gap-2 text-sm text-slate-500">
                  <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-500" />
                  {t("common.loading")}
                </div>
              ) : messages.length === 0 ? (
                <p className="text-sm text-slate-500">{t("chat.noMessages")}</p>
              ) : (
                messages.map((message) => (
                  <div
                    key={message.id}
                    className={`flex ${message.sender.id === authUser?.id ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-2xl border px-3 py-2 ${
                        message.sender.id === authUser?.id
                          ? "border-brand-600 bg-brand-600 text-white"
                          : "border-slate-200 bg-white text-slate-800"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={`text-xs font-semibold ${
                            message.sender.id === authUser?.id ? "text-white/90" : "text-slate-700"
                          }`}
                        >
                          {message.sender.id === authUser?.id ? t("chat.you") : message.sender.fullName}
                        </span>
                        <span
                          className={`text-[11px] ${
                            message.sender.id === authUser?.id ? "text-white/80" : "text-slate-500"
                          }`}
                        >
                          {formatDateTime(message.createdAt)}
                        </span>
                      </div>
                      <p
                        className={`mt-1 whitespace-pre-wrap text-sm ${
                          message.sender.id === authUser?.id ? "text-white" : "text-slate-800"
                        }`}
                      >
                        {message.body}
                      </p>
                    </div>
                  </div>
                ))
              )}
              </div>
            </div>

            <div className="mt-2 flex items-center gap-2">
              <input
                value={composer}
                onChange={(event) => setComposer(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void sendMessage();
                  }
                }}
                placeholder={t("chat.typeMessage")}
                className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
              <button
                onClick={() => void sendMessage()}
                disabled={sending || !composer.trim()}
                className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-70"
              >
                {sending ? t("chat.sending") : t("chat.send")}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
