import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import { createAuditLog } from "./audit-log.service.js";
import { notifyDistrictManagersAndAdmins } from "./notification.service.js";

const DEFAULT_SLA_CHECK_INTERVAL_MS = 5 * 60 * 1000;

type SlaCheckSummary = {
  checkedLeads: number;
  markedOverdue: number;
  notifiedUsers: number;
};

let timer: NodeJS.Timeout | null = null;
let isRunning = false;

function resolveSlaCheckIntervalMs() {
  const raw = Number(process.env.SLA_CHECK_INTERVAL_MS ?? "");
  if (Number.isFinite(raw) && raw >= 60_000) {
    return raw;
  }
  return DEFAULT_SLA_CHECK_INTERVAL_MS;
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

export function startSlaOverdueMonitor() {
  if (timer || env.NODE_ENV === "test") {
    return;
  }

  const intervalMs = resolveSlaCheckIntervalMs();

  const run = async () => {
    if (isRunning) return;
    isRunning = true;
    try {
      const summary = await runSlaOverdueCheck();
      if (summary.markedOverdue > 0) {
        console.info("sla_overdue_check_completed", summary);
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
