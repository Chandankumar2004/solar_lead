import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import { isPrismaConnected } from "../lib/prisma.js";
import { createAuditLog } from "./audit-log.service.js";
import {
  notifyDistrictManagersAndAdmins,
  triggerExecutiveInactivityReminderNotification
} from "./notification.service.js";

const DEFAULT_SLA_CHECK_INTERVAL_MS = 5 * 60 * 1000;
const REMINDER_DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;

type SlaCheckSummary = {
  checkedLeads: number;
  markedOverdue: number;
  notifiedUsers: number;
};

type InactivityCheckSummary = {
  checkedLeads: number;
  remindersSent: number;
};

let timer: NodeJS.Timeout | null = null;
let isRunning = false;
let lastDbUnavailableLogAt = 0;

function resolveSlaCheckIntervalMs() {
  const raw = Number(process.env.SLA_CHECK_INTERVAL_MS ?? "");
  if (Number.isFinite(raw) && raw >= 60_000) {
    return raw;
  }
  return DEFAULT_SLA_CHECK_INTERVAL_MS;
}

function resolveInactivityReminderDays() {
  const configured = env.LEAD_INACTIVITY_REMINDER_DAYS;
  if (Number.isFinite(configured) && configured >= 0) {
    return configured;
  }
  return 3;
}

export async function runSlaOverdueCheck(): Promise<SlaCheckSummary> {
  const now = new Date();
  const candidates = await prisma.lead.findMany({
    where: {
      isOverdue: false,
      currentStatus: {
        is: {
          isTerminal: false,
          slaDurationHours: {
            not: null
          }
        }
      }
    },
    select: {
      id: true,
      externalId: true,
      districtId: true,
      currentStatusId: true,
      createdAt: true,
      currentStatus: {
        select: {
          id: true,
          name: true,
          slaDurationHours: true
        }
      },
      statusHistory: {
        orderBy: {
          createdAt: "desc"
        },
        take: 1,
        select: {
          toStatusId: true,
          createdAt: true
        }
      }
    }
  });

  let markedOverdue = 0;
  let notifiedUsers = 0;

  for (const lead of candidates) {
    const slaDurationHours = lead.currentStatus.slaDurationHours;
    if (!slaDurationHours || slaDurationHours <= 0) {
      continue;
    }

    const latestHistory = lead.statusHistory[0];
    const enteredAt =
      latestHistory && latestHistory.toStatusId === lead.currentStatusId
        ? latestHistory.createdAt
        : lead.createdAt;

    const exceeded = now.getTime() - enteredAt.getTime() > slaDurationHours * 60 * 60 * 1000;
    if (!exceeded) {
      continue;
    }

    const updated = await prisma.lead.updateMany({
      where: {
        id: lead.id,
        isOverdue: false
      },
      data: {
        isOverdue: true
      }
    });

    if (updated.count === 0) {
      continue;
    }

    markedOverdue += 1;

    const recipients = await notifyDistrictManagersAndAdmins(
      lead.districtId,
      "Lead SLA breached",
      `Lead ${lead.externalId} is overdue in status "${lead.currentStatus.name}" (SLA ${slaDurationHours}h).`,
      {
        type: "LEAD_OVERDUE",
        leadId: lead.id,
        entityType: "lead",
        entityId: lead.id,
        metadata: {
          source: "sla_monitor",
          statusId: lead.currentStatus.id,
          statusName: lead.currentStatus.name,
          slaDurationHours,
          enteredAt: enteredAt.toISOString()
        }
      }
    );
    notifiedUsers += recipients.length;

    await createAuditLog({
      actorUserId: null,
      action: "LEAD_MARKED_OVERDUE_SLA",
      entityType: "lead",
      entityId: lead.id,
      detailsJson: {
        leadId: lead.id,
        externalId: lead.externalId,
        statusId: lead.currentStatus.id,
        statusName: lead.currentStatus.name,
        slaDurationHours,
        enteredAt: enteredAt.toISOString(),
        checkedAt: now.toISOString(),
        notifiedUserIds: recipients
      },
      ipAddress: null
    });
  }

  return {
    checkedLeads: candidates.length,
    markedOverdue,
    notifiedUsers
  };
}

export async function runInactivityReminderCheck(): Promise<InactivityCheckSummary> {
  const inactivityDays = resolveInactivityReminderDays();
  if (inactivityDays <= 0) {
    return {
      checkedLeads: 0,
      remindersSent: 0
    };
  }

  const now = new Date();
  const inactivityThreshold = new Date(now.getTime() - inactivityDays * 24 * 60 * 60 * 1000);
  const dedupeSince = new Date(now.getTime() - REMINDER_DEDUPE_WINDOW_MS);

  const candidates = await prisma.lead.findMany({
    where: {
      assignedExecutiveId: {
        not: null
      },
      updatedAt: {
        lte: inactivityThreshold
      },
      currentStatus: {
        is: {
          isTerminal: false
        }
      },
      assignedExecutive: {
        is: {
          role: "EXECUTIVE",
          status: "ACTIVE"
        }
      }
    },
    select: {
      id: true,
      externalId: true,
      assignedExecutiveId: true,
      updatedAt: true,
      currentStatus: {
        select: {
          name: true
        }
      }
    }
  });

  if (!candidates.length) {
    return {
      checkedLeads: 0,
      remindersSent: 0
    };
  }

  const leadIds = candidates.map((lead) => lead.id);
  const recipientIds = candidates
    .map((lead) => lead.assignedExecutiveId)
    .filter((value): value is string => Boolean(value));

  const recentReminderLogs = await prisma.notificationLog.findMany({
    where: {
      leadId: {
        in: leadIds
      },
      recipient: {
        in: recipientIds
      },
      channel: "PUSH",
      createdAt: {
        gte: dedupeSince
      },
      contentSent: {
        contains: "Inactivity reminder",
        mode: "insensitive"
      }
    },
    select: {
      leadId: true,
      recipient: true
    }
  });

  const dedupeKeys = new Set(
    recentReminderLogs
      .filter((log) => log.leadId)
      .map((log) => `${log.leadId}:${log.recipient}`)
  );

  let remindersSent = 0;

  for (const lead of candidates) {
    if (!lead.assignedExecutiveId) continue;
    const dedupeKey = `${lead.id}:${lead.assignedExecutiveId}`;
    if (dedupeKeys.has(dedupeKey)) {
      continue;
    }

    const recipients = await triggerExecutiveInactivityReminderNotification({
      leadId: lead.id,
      externalId: lead.externalId,
      assignedExecutiveId: lead.assignedExecutiveId,
      inactivityDays,
      statusName: lead.currentStatus.name,
      lastActivityAt: lead.updatedAt
    });

    if (recipients.length === 0) {
      continue;
    }

    remindersSent += recipients.length;
    dedupeKeys.add(dedupeKey);

    await createAuditLog({
      actorUserId: null,
      action: "LEAD_INACTIVITY_REMINDER_SENT",
      entityType: "lead",
      entityId: lead.id,
      detailsJson: {
        leadId: lead.id,
        externalId: lead.externalId,
        inactivityDays,
        lastActivityAt: lead.updatedAt.toISOString(),
        remindedUserIds: recipients
      },
      ipAddress: null
    });
  }

  return {
    checkedLeads: candidates.length,
    remindersSent
  };
}

export function startSlaOverdueMonitor() {
  if (timer || env.NODE_ENV === "test") {
    return;
  }

  const intervalMs = resolveSlaCheckIntervalMs();

  const run = async () => {
    if (isRunning) return;
    isRunning = true;
    try {
      if (!isPrismaConnected()) {
        const now = Date.now();
        if (now - lastDbUnavailableLogAt > 15 * 60 * 1000) {
          lastDbUnavailableLogAt = now;
          console.warn("sla_overdue_check_skipped", {
            reason: "PRISMA_DB_UNAVAILABLE"
          });
        }
        return;
      }

      const summary = await runSlaOverdueCheck();
      const inactivitySummary = await runInactivityReminderCheck();
      if (summary.markedOverdue > 0 || inactivitySummary.remindersSent > 0) {
        console.info("sla_overdue_check_completed", {
          ...summary,
          inactivityCheckedLeads: inactivitySummary.checkedLeads,
          inactivityRemindersSent: inactivitySummary.remindersSent
        });
      }
    } catch (error) {
      console.error("sla_overdue_check_failed", error);
    } finally {
      isRunning = false;
    }
  };

  void run();
  timer = setInterval(() => {
    void run();
  }, intervalMs);
}
