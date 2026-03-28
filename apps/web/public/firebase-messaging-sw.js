/* eslint-disable no-undef */
importScripts("https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging-compat.js");

const params = new URL(self.location.href).searchParams;
const firebaseConfig = {
  apiKey: params.get("apiKey") || "",
  authDomain: params.get("authDomain") || "",
  projectId: params.get("projectId") || "",
  storageBucket: params.get("storageBucket") || "",
  messagingSenderId: params.get("messagingSenderId") || "",
  appId: params.get("appId") || ""
};

const hasConfig =
  Boolean(firebaseConfig.apiKey) &&
  Boolean(firebaseConfig.projectId) &&
  Boolean(firebaseConfig.messagingSenderId) &&
  Boolean(firebaseConfig.appId);

if (hasConfig) {
  firebase.initializeApp(firebaseConfig);
  const messaging = firebase.messaging();

  messaging.onBackgroundMessage((payload) => {
    const title =
      payload?.notification?.title ||
      payload?.data?.title ||
      "Solar Lead update";
    const body = payload?.notification?.body || payload?.data?.body || "";
    const leadId =
      payload?.data?.leadId ||
      payload?.data?.lead_id ||
      (payload?.data?.entityType === "lead" ? payload?.data?.entityId : null) ||
      null;
    const conversationId =
      payload?.data?.conversationId ||
      payload?.data?.meta_conversationId ||
      (payload?.data?.entityType === "chat_conversation" ? payload?.data?.entityId : null) ||
      null;

    const notificationOptions = {
      body,
      tag: payload?.messageId || undefined,
      data: {
        ...(payload?.data || {}),
        leadId: leadId || null,
        conversationId: conversationId || null
      }
    };

    self.registration.showNotification(title, notificationOptions);
  });
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const leadId =
    event.notification?.data?.leadId ||
    (event.notification?.data?.entityType === "lead"
      ? event.notification?.data?.entityId
      : null);
  const conversationId =
    event.notification?.data?.conversationId ||
    event.notification?.data?.meta_conversationId ||
    (event.notification?.data?.entityType === "chat_conversation"
      ? event.notification?.data?.entityId
      : null);
  const targetPath =
    typeof conversationId === "string" && conversationId.trim().length > 0
      ? `/chat?conversationId=${encodeURIComponent(conversationId.trim())}`
      :
    typeof leadId === "string" && leadId.trim().length > 0
      ? `/leads/${leadId.trim()}`
      : "/notifications";
  const targetUrl = new URL(targetPath, self.location.origin).href;

  event.waitUntil(
    self.clients
      .matchAll({
        type: "window",
        includeUncontrolled: true
      })
      .then((clients) => {
        for (const client of clients) {
          if ("focus" in client) {
            client.focus();
          }
          if ("navigate" in client) {
            client.navigate(targetUrl);
            return;
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
        return undefined;
      })
  );
});
