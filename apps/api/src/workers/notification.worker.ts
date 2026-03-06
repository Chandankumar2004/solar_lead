import { Worker } from "bullmq";
import { bullConnection } from "../lib/bull-connection.js";
import { firebaseMessaging, firestore } from "../lib/firebase.js";
import { sendCustomerNotification } from "../services/customer-notification-delivery.service.js";
import {
  type CustomerNotificationJobPayload,
  type InAppNotificationJobPayload,
  listDeviceTokensForUser,
  logNotification,
  removeDeviceTokens,
  updateNotificationLogDelivery
} from "../services/notification.service.js";

function toFcmData(payload: InAppNotificationJobPayload) {
  const data: Record<string, string> = {
    userId: payload.userId,
    title: payload.title,
    body: payload.body,
    type: payload.type ?? "INTERNAL"
  };

  if (payload.leadId) data.leadId = payload.leadId;
  if (payload.entityType) data.entityType = payload.entityType;
  if (payload.entityId) data.entityId = payload.entityId;

  if (payload.metadata) {
    for (const [key, value] of Object.entries(payload.metadata)) {
      if (value === undefined) continue;
      data[`meta_${key}`] =
        value === null ? "null" : typeof value === "string" ? value : JSON.stringify(value);
    }
  }

  return data;
}

function isInvalidTokenError(code?: string) {
  return (
    code === "messaging/invalid-registration-token" ||
    code === "messaging/registration-token-not-registered"
  );
}

async function processInternalNotification(jobData: InAppNotificationJobPayload) {
  const payload = jobData;

  const firestoreDoc = {
    userId: payload.userId,
    title: payload.title,
    body: payload.body,
    type: payload.type ?? "INTERNAL",
    leadId: payload.leadId ?? null,
    entityType: payload.entityType ?? null,
    entityId: payload.entityId ?? null,
    metadata: payload.metadata ?? {},
    isRead: false,
    readAt: null,
    createdAt: new Date().toISOString()
  };

  const ref = await firestore.collection("internal_notifications").add(firestoreDoc);

  const userTokens = await listDeviceTokensForUser(payload.userId);
  let deliveryStatus = "firestore_only";
  let attempts = 1;

  if (userTokens.length > 0) {
    attempts = userTokens.length;
    try {
      const sendResult = await firebaseMessaging.sendEachForMulticast({
        tokens: userTokens,
        notification: {
          title: payload.title,
          body: payload.body
        },
        data: toFcmData(payload)
      });

      deliveryStatus =
        sendResult.failureCount === 0
          ? "sent"
          : sendResult.successCount > 0
            ? "partial_failed"
            : "failed";

      const invalidTokens: string[] = [];
      sendResult.responses.forEach((response, index) => {
        if (response.success) return;
        if (isInvalidTokenError(response.error?.code)) {
          const token = userTokens[index];
          if (token) invalidTokens.push(token);
        }
      });

      if (invalidTokens.length > 0) {
        await removeDeviceTokens(invalidTokens);
      }
    } catch (error) {
      console.error("fcm_send_failed", {
        userId: payload.userId,
        error
      });
      deliveryStatus = "failed";
    }
  }

  await logNotification({
    leadId: payload.leadId,
    channel: "PUSH",
    recipient: payload.userId,
    contentSent: `${payload.title}: ${payload.body}`,
    deliveryStatus,
    providerMessageId: ref.id,
    attempts
  });
}

async function processCustomerNotification(
  payload: CustomerNotificationJobPayload,
  attemptsMade: number,
  maxAttempts: number
) {
  const currentAttempt = attemptsMade + 1;
  await updateNotificationLogDelivery({
    logId: payload.logId,
    attempts: currentAttempt,
    deliveryStatus: currentAttempt === 1 ? "sending" : "retrying"
  });

  try {
    const delivered = await sendCustomerNotification({
      channel: payload.channel,
      recipient: payload.recipient,
      subject: payload.subject,
      body: payload.body,
      metadata: {
        leadId: payload.leadId,
        templateId: payload.templateId
      }
    });

    await updateNotificationLogDelivery({
      logId: payload.logId,
      attempts: currentAttempt,
      deliveryStatus: "sent",
      providerMessageId: delivered.providerMessageId
    });
  } catch (error) {
    const willRetry = currentAttempt < maxAttempts;
    await updateNotificationLogDelivery({
      logId: payload.logId,
      attempts: currentAttempt,
      deliveryStatus: willRetry ? "retrying" : "failed"
    });

    console.error("customer_notification_send_failed", {
      logId: payload.logId,
      leadId: payload.leadId,
      channel: payload.channel,
      attempt: currentAttempt,
      maxAttempts,
      error
    });

    if (willRetry) {
      throw error;
    }
  }
}

new Worker(
  "notification-queue",
  async (job) => {
    if (job.name === "notify-user") {
      await processInternalNotification(job.data as InAppNotificationJobPayload);
      return;
    }

    if (job.name === "notify-customer") {
      const payload = job.data as CustomerNotificationJobPayload;
      await processCustomerNotification(
        payload,
        job.attemptsMade,
        job.opts.attempts ?? 1
      );
    }
  },
  { connection: bullConnection }
);
