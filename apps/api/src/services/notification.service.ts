import { Queue } from "bullmq";
import { DevicePlatform, NotificationChannel } from "@prisma/client";
import { bullConnection } from "../lib/bull-connection.js";
import { prisma } from "../lib/prisma.js";

export type NotificationEventType =
  | "NEW_LEAD"
  | "DOC_PENDING_REVIEW"
  | "UTR_PENDING_VERIFICATION"
  | "LEAD_OVERDUE"
  | "INTERNAL";

export type CustomerNotificationJobPayload = {
  logId: string;
  leadId: string;
  templateId: string;
  channel: NotificationChannel;
  recipient: string;
  subject?: string | null;
  body: string;
};

export type InAppNotificationJobPayload = {
  userId: string;
  title: string;
  body: string;
  type?: NotificationEventType;
  leadId?: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
};

export const notificationQueue = new Queue("notification-queue", {
  connection: bullConnection
});

function uniqueIds(ids: Array<string | null | undefined>) {
  return [...new Set(ids.filter((value): value is string => Boolean(value)))];
}

export async function enqueueInAppNotification(params: InAppNotificationJobPayload) {
  await notificationQueue.add("notify-user", params);
}

function toTemplateValue(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

export function renderTemplateVariables(
  template: string,
  variables: Record<string, unknown>
) {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_raw, key: string) => {
    if (!(key in variables)) return "";
    return toTemplateValue(variables[key]);
  });
}

export async function notifyUsers(
  userIds: string[],
  title: string,
  body: string,
  context?: Omit<InAppNotificationJobPayload, "userId" | "title" | "body">
) {
  const uniqueUserIds = uniqueIds(userIds);
  await Promise.all(
    uniqueUserIds.map((userId) =>
      enqueueInAppNotification({
        userId,
        title,
        body,
        ...(context ?? {})
      })
    )
  );
  return uniqueUserIds;
}

async function getActiveAdminIds() {
  const admins = await prisma.user.findMany({
    where: {
      status: "ACTIVE",
      role: { in: ["SUPER_ADMIN", "ADMIN"] }
    },
    select: { id: true }
  });
  return admins.map((admin) => admin.id);
}

async function getActiveDistrictManagerIds(districtId: string) {
  const assignments = await prisma.userDistrictAssignment.findMany({
    where: {
      districtId,
      user: {
        role: "MANAGER",
        status: "ACTIVE"
      }
    },
    select: {
      userId: true
    }
  });
  return assignments.map((item) => item.userId);
}

export async function notifyDistrictManagersAndAdmins(
  districtId: string,
  title: string,
  body: string,
  context?: Omit<InAppNotificationJobPayload, "userId" | "title" | "body">
) {
  const [adminIds, districtManagerIds] = await Promise.all([
    getActiveAdminIds(),
    getActiveDistrictManagerIds(districtId)
  ]);

  const recipients = uniqueIds([...adminIds, ...districtManagerIds]);
  if (!recipients.length) return [];

  await notifyUsers(recipients, title, body, context);
  return recipients;
}

export async function notifyActiveAdmins(
  title: string,
  body: string,
  context?: Omit<InAppNotificationJobPayload, "userId" | "title" | "body">
) {
  const adminIds = await getActiveAdminIds();
  await notifyUsers(adminIds, title, body, context);
  return adminIds;
}

export async function upsertUserDeviceToken(input: {
  userId: string;
  token: string;
  platform: DevicePlatform;
  deviceId?: string | null;
  appVersion?: string | null;
}) {
  return prisma.$transaction(async (tx) => {
    await tx.userDeviceToken.deleteMany({
      where: {
        token: input.token,
        userId: { not: input.userId }
      }
    });

    return tx.userDeviceToken.upsert({
      where: {
        userId_token: {
          userId: input.userId,
          token: input.token
        }
      },
      update: {
        platform: input.platform,
        deviceId: input.deviceId ?? null,
        appVersion: input.appVersion ?? null,
        lastSeenAt: new Date()
      },
      create: {
        userId: input.userId,
        token: input.token,
        platform: input.platform,
        deviceId: input.deviceId ?? null,
        appVersion: input.appVersion ?? null,
        lastSeenAt: new Date()
      }
    });
  });
}

export async function removeUserDeviceToken(input: { userId: string; token: string }) {
  await prisma.userDeviceToken.deleteMany({
    where: {
      userId: input.userId,
      token: input.token
    }
  });
}

export async function removeDeviceTokens(tokens: string[]) {
  if (!tokens.length) return;
  await prisma.userDeviceToken.deleteMany({
    where: {
      token: { in: tokens }
    }
  });
}

export async function listUserDeviceTokens(userId: string) {
  return prisma.userDeviceToken.findMany({
    where: { userId },
    select: {
      id: true,
      token: true,
      platform: true,
      deviceId: true,
      appVersion: true,
      createdAt: true,
      updatedAt: true,
      lastSeenAt: true
    },
    orderBy: { updatedAt: "desc" }
  });
}

export async function listDeviceTokensForUser(userId: string) {
  const records = await prisma.userDeviceToken.findMany({
    where: { userId },
    select: {
      token: true
    }
  });
  return records.map((record) => record.token);
}

export async function logNotification(params: {
  leadId?: string;
  channel: NotificationChannel;
  templateId?: string;
  recipient: string;
  contentSent: string;
  deliveryStatus: string;
  providerMessageId?: string;
  attempts?: number;
}) {
  return prisma.notificationLog.create({
    data: {
      leadId: params.leadId,
      channel: params.channel,
      templateId: params.templateId,
      recipient: params.recipient,
      contentSent: params.contentSent,
      deliveryStatus: params.deliveryStatus,
      providerMessageId: params.providerMessageId,
      attempts: params.attempts ?? 1,
      lastAttemptedAt: new Date()
    }
  });
}

export async function updateNotificationLogDelivery(input: {
  logId: string;
  attempts: number;
  deliveryStatus: string;
  providerMessageId?: string | null;
}) {
  return prisma.notificationLog.update({
    where: { id: input.logId },
    data: {
      attempts: input.attempts,
      deliveryStatus: input.deliveryStatus,
      providerMessageId:
        input.providerMessageId !== undefined ? input.providerMessageId : undefined,
      lastAttemptedAt: new Date()
    }
  });
}

const CUSTOMER_TEMPLATE_CHANNELS = new Set<NotificationChannel>([
  "SMS",
  "EMAIL",
  "WHATSAPP"
]);

type QueueLeadStatusCustomerNotificationInput = {
  leadId: string;
  toStatusId: string;
  changedByUserId?: string | null;
  transitionNotes?: string | null;
};

export async function queueLeadStatusCustomerNotification(
  input: QueueLeadStatusCustomerNotificationInput
) {
  try {
    const [lead, status] = await Promise.all([
      prisma.lead.findUnique({
        where: { id: input.leadId },
        select: {
          id: true,
          externalId: true,
          name: true,
          phone: true,
          email: true
        }
      }),
      prisma.leadStatus.findUnique({
        where: { id: input.toStatusId },
        include: {
          notificationTemplate: {
            select: {
              id: true,
              name: true,
              channel: true,
              subject: true,
              bodyTemplate: true,
              isActive: true
            }
          }
        }
      })
    ]);

    if (!lead || !status) {
      return {
        queued: false,
        reason: "lead_or_status_not_found"
      } as const;
    }

    if (!status.notifyCustomer) {
      return {
        queued: false,
        reason: "notify_customer_disabled"
      } as const;
    }

    const template = status.notificationTemplate;
    if (!template || !template.isActive) {
      return {
        queued: false,
        reason: "template_missing_or_inactive"
      } as const;
    }

    if (!CUSTOMER_TEMPLATE_CHANNELS.has(template.channel)) {
      return {
        queued: false,
        reason: "template_channel_not_supported"
      } as const;
    }

    const recipient =
      template.channel === "EMAIL" ? lead.email?.trim() || "" : lead.phone?.trim() || "";

    const variables = {
      customer_name: lead.name,
      lead_id: lead.id,
      lead_external_id: lead.externalId,
      status: status.name,
      lead_status: status.name,
      phone: lead.phone ?? "",
      email: lead.email ?? "",
      transition_notes: input.transitionNotes ?? ""
    };

    const renderedBody = renderTemplateVariables(template.bodyTemplate, variables);
    const renderedSubject = template.subject
      ? renderTemplateVariables(template.subject, variables)
      : null;

    if (!recipient) {
      const missingRecipientLog = await prisma.notificationLog.create({
        data: {
          leadId: lead.id,
          channel: template.channel,
          templateId: template.id,
          recipient: "",
          contentSent: renderedSubject
            ? `${renderedSubject}\n\n${renderedBody}`
            : renderedBody,
          deliveryStatus: "failed_missing_recipient",
          attempts: 0
        }
      });
      return {
        queued: false,
        reason: "recipient_missing",
        logId: missingRecipientLog.id
      } as const;
    }

    const log = await prisma.notificationLog.create({
      data: {
        leadId: lead.id,
        channel: template.channel,
        templateId: template.id,
        recipient,
        contentSent: renderedSubject ? `${renderedSubject}\n\n${renderedBody}` : renderedBody,
        deliveryStatus: "queued",
        attempts: 0
      }
    });

    await notificationQueue.add(
      "notify-customer",
      {
        logId: log.id,
        leadId: lead.id,
        templateId: template.id,
        channel: template.channel,
        recipient,
        subject: renderedSubject,
        body: renderedBody
      } satisfies CustomerNotificationJobPayload,
      {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 5_000
        },
        removeOnComplete: 500,
        removeOnFail: 2_000
      }
    );

    return {
      queued: true,
      logId: log.id,
      templateId: template.id,
      channel: template.channel,
      recipient
    } as const;
  } catch (error) {
    console.error("queue_customer_notification_failed", {
      leadId: input.leadId,
      toStatusId: input.toStatusId,
      error
    });
    return {
      queued: false,
      reason: "internal_error"
    } as const;
  }
}

export async function triggerNewLeadNotification(input: {
  leadId: string;
  externalId: string;
  assignedExecutiveId?: string | null;
  assignedManagerId?: string | null;
}) {
  const recipients = uniqueIds([
    input.assignedExecutiveId,
    input.assignedManagerId
  ]);
  if (!recipients.length) return [];

  return notifyUsers(
    recipients,
    "New lead created",
    `Lead ${input.externalId} is created and assigned.`,
    {
      type: "NEW_LEAD",
      leadId: input.leadId,
      entityType: "lead",
      entityId: input.leadId,
      metadata: {
        externalId: input.externalId
      }
    }
  );
}

export async function triggerDocumentPendingNotification(input: {
  leadId: string;
  documentId: string;
  fileName: string;
  uploadedByUserId?: string | null;
}) {
  const lead = await prisma.lead.findUnique({
    where: { id: input.leadId },
    select: {
      id: true,
      externalId: true,
      districtId: true,
      assignedManagerId: true
    }
  });
  if (!lead) return [];

  const [adminIds, districtManagerIds] = await Promise.all([
    getActiveAdminIds(),
    getActiveDistrictManagerIds(lead.districtId)
  ]);

  const recipients = uniqueIds([
    lead.assignedManagerId,
    ...adminIds,
    ...districtManagerIds
  ]);
  if (!recipients.length) return [];

  return notifyUsers(
    recipients,
    "Document pending review",
    `Lead ${lead.externalId} has a new pending document (${input.fileName}).`,
    {
      type: "DOC_PENDING_REVIEW",
      leadId: lead.id,
      entityType: "document",
      entityId: input.documentId,
      metadata: {
        externalId: lead.externalId,
        uploadedByUserId: input.uploadedByUserId ?? null
      }
    }
  );
}

export async function triggerUtrPendingNotification(input: {
  paymentId: string;
  leadId: string;
  utrNumber?: string | null;
  amount: string;
}) {
  const lead = await prisma.lead.findUnique({
    where: { id: input.leadId },
    select: {
      id: true,
      externalId: true,
      districtId: true,
      assignedManagerId: true
    }
  });
  if (!lead) return [];

  const [adminIds, districtManagerIds] = await Promise.all([
    getActiveAdminIds(),
    getActiveDistrictManagerIds(lead.districtId)
  ]);

  const recipients = uniqueIds([
    lead.assignedManagerId,
    ...adminIds,
    ...districtManagerIds
  ]);
  if (!recipients.length) return [];

  return notifyUsers(
    recipients,
    "UTR pending verification",
    `Lead ${lead.externalId} has a new pending UTR${input.utrNumber ? ` (${input.utrNumber})` : ""}.`,
    {
      type: "UTR_PENDING_VERIFICATION",
      leadId: lead.id,
      entityType: "payment",
      entityId: input.paymentId,
      metadata: {
        externalId: lead.externalId,
        amount: input.amount,
        utrNumber: input.utrNumber ?? null
      }
    }
  );
}

export async function triggerOverdueLeadNotification(input: {
  leadId: string;
  reason?: string | null;
}) {
  const lead = await prisma.lead.findUnique({
    where: { id: input.leadId },
    select: {
      id: true,
      externalId: true,
      districtId: true,
      assignedExecutiveId: true,
      assignedManagerId: true
    }
  });
  if (!lead) return [];

  const [adminIds, districtManagerIds] = await Promise.all([
    getActiveAdminIds(),
    getActiveDistrictManagerIds(lead.districtId)
  ]);

  const recipients = uniqueIds([
    lead.assignedExecutiveId,
    lead.assignedManagerId,
    ...adminIds,
    ...districtManagerIds
  ]);
  if (!recipients.length) return [];

  return notifyUsers(
    recipients,
    "Overdue lead alert",
    `Lead ${lead.externalId} is marked overdue.${input.reason ? ` ${input.reason}` : ""}`,
    {
      type: "LEAD_OVERDUE",
      leadId: lead.id,
      entityType: "lead",
      entityId: lead.id,
      metadata: {
        externalId: lead.externalId,
        reason: input.reason ?? null
      }
    }
  );
}
