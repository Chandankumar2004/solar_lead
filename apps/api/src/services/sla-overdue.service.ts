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
  clearedOverdue: number;
  notifiedUsers: number;
  repairedOverdueAt: number;
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
      currentStatus: {
        is: {
          isTerminal: false
        }
      },
      OR: [
        {
          isOverdue: true
        },
        {
          currentStatus: {
            is: {
              slaDurationHours: {
                not: null
              }
            }
          }
        }
      ]
    },
    select: {
      id: true,
      externalId: true,
      districtId: true,
      statusUpdatedAt: true,
      isOverdue: true,
      overdueAt: true,
      currentStatus: {
        select: {
          id: true,
          name: true,
          slaDurationHours: true
        }
      }
    }
  });

  let markedOverdue = 0;
  let clearedOverdue = 0;
  let notifiedUsers = 0;
  let repairedOverdueAt = 0;

  for (const lead of candidates) {
    const slaDurationHours = lead.currentStatus.slaDurationHours;
    const hasSla = typeof slaDurationHours === "number" && slaDurationHours > 0;
    const enteredAt = lead.statusUpdatedAt;
    const exceeded = hasSla
      ? now.getTime() - enteredAt.getTime() > slaDurationHours * 60 * 60 * 1000
      : false;

    if (!exceeded && !lead.isOverdue) {
      continue;
    }

    if (!exceeded && lead.isOverdue) {
      const reset = await prisma.lead.updateMany({
        where: {
          id: lead.id,
          isOverdue: true
        },
        data: {
          isOverdue: false,
          overdueAt: null
        }
      });
      if (reset.count === 0) {
        continue;
      }

      clearedOverdue += 1;

      await createAuditLog({
        actorUserId: null,
        action: "LEAD_OVERDUE_CLEARED_SLA",
        entityType: "lead",
        entityId: lead.id,
        detailsJson: {
          leadId: lead.id,
          externalId: lead.externalId,
          statusId: lead.currentStatus.id,
          statusName: lead.currentStatus.name,
          slaDurationHours,
          statusUpdatedAt: lead.statusUpdatedAt.toISOString(),
          checkedAt: now.toISOString(),
          reason: hasSla ? "within_sla_window" : "status_without_sla"
        },
        ipAddress: null
      });
      continue;
    }

    const updated = await prisma.lead.updateMany({
      where: {
        id: lead.id,
        isOverdue: false
      },
      data: {
        isOverdue: true,
        overdueAt: now
      }
    });

    if (updated.count === 0) {
      if (lead.isOverdue && !lead.overdueAt) {
        const repaired = await prisma.lead.updateMany({
          where: {
            id: lead.id,
            isOverdue: true,
            overdueAt: null
          },
          data: {
            overdueAt: now
          }
        });
        repairedOverdueAt += repaired.count;
      }
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
    clearedOverdue,
    notifiedUsers,
    repairedOverdueAt
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
      districtId: true,
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

  const recentReminderLogs = await prisma.notificationLog.findMany({
    where: {
      leadId: {
        in: leadIds
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
      leadId: true
    }
  });

  const dedupeLeadIds = new Set(
    recentReminderLogs
      .filter((log) => log.leadId)
      .map((log) => log.leadId as string)
  );

  let remindersSent = 0;

  for (const lead of candidates) {
    if (!lead.assignedExecutiveId) continue;
    if (dedupeLeadIds.has(lead.id)) {
      continue;
    }

    const [executiveRecipients, portalRecipients] = await Promise.all([
      triggerExecutiveInactivityReminderNotification({
        leadId: lead.id,
        externalId: lead.externalId,
        assignedExecutiveId: lead.assignedExecutiveId,
        inactivityDays,
        statusName: lead.currentStatus.name,
        lastActivityAt: lead.updatedAt
      }),
      notifyDistrictManagersAndAdmins(
        lead.districtId,
        "Executive inactivity reminder",
        `Lead ${lead.externalId} has no field-executive activity for ${inactivityDays} day(s). Current status: "${lead.currentStatus.name}".`,
        {
          type: "LEAD_INACTIVITY_REMINDER",
          leadId: lead.id,
          entityType: "lead",
          entityId: lead.id,
          metadata: {
            source: "sla_monitor",
            externalId: lead.externalId,
            inactivityDays,
            statusName: lead.currentStatus.name,
            lastActivityAt: lead.updatedAt.toISOString()
          }
        }
      )
    ]);

    const recipients = [
      ...new Set([...executiveRecipients, ...portalRecipients])
    ];
    if (recipients.length === 0) {
      continue;
    }

    remindersSent += recipients.length;
    dedupeLeadIds.add(lead.id);

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
      if (
        summary.markedOverdue > 0 ||
        summary.clearedOverdue > 0 ||
        inactivitySummary.remindersSent > 0
      ) {
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
