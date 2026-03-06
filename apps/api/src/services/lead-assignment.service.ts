import { prisma } from "../lib/prisma.js";

export type LeadAutoAssignmentMode = "EXECUTIVE" | "MANAGER_FALLBACK";

export type LeadAutoAssignmentResult = {
  mode: LeadAutoAssignmentMode;
  assignedExecutiveId: string | null;
  assignedManagerId: string | null;
  flagged: boolean;
  fallbackReason?: string;
};

async function pickUserWithLowestActiveLeads(
  districtId: string,
  role: "EXECUTIVE" | "MANAGER"
) {
  const assignees = await prisma.userDistrictAssignment.findMany({
    where: {
      districtId,
      user: {
        status: "ACTIVE",
        role
      }
    },
    select: {
      userId: true
    }
  });

  if (!assignees.length) {
    return null;
  }

  const activeCounts = await Promise.all(
    assignees.map(async ({ userId }) => {
      const activeCount = await prisma.lead.count({
        where: {
          ...(role === "EXECUTIVE"
            ? { assignedExecutiveId: userId }
            : { assignedManagerId: userId }),
          currentStatus: { isTerminal: false }
        }
      });
      return { userId, activeCount };
    })
  );

  activeCounts.sort((a, b) => a.activeCount - b.activeCount);
  return activeCounts[0]?.userId ?? null;
}

export async function pickExecutiveWithLowestActiveLeads(districtId: string) {
  return pickUserWithLowestActiveLeads(districtId, "EXECUTIVE");
}

export async function pickDistrictManagerWithLowestActiveLeads(districtId: string) {
  return pickUserWithLowestActiveLeads(districtId, "MANAGER");
}

export async function resolveLeadAutoAssignment(
  districtId: string
): Promise<LeadAutoAssignmentResult | null> {
  const assignedExecutiveId = await pickExecutiveWithLowestActiveLeads(districtId);
  if (assignedExecutiveId) {
    return {
      mode: "EXECUTIVE",
      assignedExecutiveId,
      assignedManagerId: null,
      flagged: false
    };
  }

  const assignedManagerId = await pickDistrictManagerWithLowestActiveLeads(districtId);
  if (!assignedManagerId) {
    return null;
  }

  return {
    mode: "MANAGER_FALLBACK",
    assignedExecutiveId: null,
    assignedManagerId,
    flagged: true,
    fallbackReason:
      "No active field executive available in district; lead auto-assigned to district manager."
  };
}
