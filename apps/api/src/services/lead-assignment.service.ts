import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

const GLOBAL_ASSIGNMENT_CONFIG_SCOPE = "GLOBAL";
const DEFAULT_MAX_ACTIVE_LEADS_PER_EXECUTIVE = 50;

type AssignmentDbClient = Prisma.TransactionClient | typeof prisma;

type AssignmentCandidate = {
  userId: string;
  userCreatedAt: Date;
  activeCount: number;
};

export type LeadAutoAssignmentMode = "EXECUTIVE" | "MANAGER_FALLBACK" | "UNASSIGNED";

export type LeadAutoAssignmentResult = {
  mode: LeadAutoAssignmentMode;
  assignedExecutiveId: string | null;
  assignedManagerId: string | null;
  noExecutiveAvailable: boolean;
  maxActiveLeadsPerExecutive: number;
  fallbackReason?: string;
  failureReason?: string;
};

export type AutoAssignmentConfig = {
  maxActiveLeadsPerExecutive: number;
};

function normalizeMaxActiveLeadsPerExecutive(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_MAX_ACTIVE_LEADS_PER_EXECUTIVE;
  }
  return Math.max(1, Math.trunc(value));
}

function sortByLowestActiveLoad(left: AssignmentCandidate, right: AssignmentCandidate) {
  if (left.activeCount !== right.activeCount) {
    return left.activeCount - right.activeCount;
  }
  const createdAtDiff = left.userCreatedAt.getTime() - right.userCreatedAt.getTime();
  if (createdAtDiff !== 0) {
    return createdAtDiff;
  }
  return left.userId.localeCompare(right.userId);
}

async function listDistrictCandidates(
  client: AssignmentDbClient,
  districtId: string,
  role: "EXECUTIVE" | "MANAGER"
) {
  return client.userDistrictAssignment.findMany({
    where: {
      districtId,
      user: {
        status: "ACTIVE",
        role
      }
    },
    select: {
      userId: true,
      user: {
        select: {
          createdAt: true
        }
      }
    }
  });
}

async function countActiveExecutiveLeads(
  client: AssignmentDbClient,
  userIds: string[]
) {
  if (!userIds.length) {
    return new Map<string, number>();
  }

  const grouped = await client.lead.groupBy({
    by: ["assignedExecutiveId"],
    where: {
      assignedExecutiveId: { in: userIds },
      currentStatus: {
        isTerminal: false
      }
    },
    _count: {
      _all: true
    }
  });

  const countByUserId = new Map<string, number>();
  for (const row of grouped) {
    if (!row.assignedExecutiveId) continue;
    countByUserId.set(row.assignedExecutiveId, row._count._all);
  }
  return countByUserId;
}

async function countActiveManagerLeads(
  client: AssignmentDbClient,
  userIds: string[]
) {
  if (!userIds.length) {
    return new Map<string, number>();
  }

  const grouped = await client.lead.groupBy({
    by: ["assignedManagerId"],
    where: {
      assignedManagerId: { in: userIds },
      currentStatus: {
        isTerminal: false
      }
    },
    _count: {
      _all: true
    }
  });

  const countByUserId = new Map<string, number>();
  for (const row of grouped) {
    if (!row.assignedManagerId) continue;
    countByUserId.set(row.assignedManagerId, row._count._all);
  }
  return countByUserId;
}

function rankCandidates(
  candidates: Array<{ userId: string; user: { createdAt: Date } }>,
  countByUserId: Map<string, number>
) {
  return candidates
    .map<AssignmentCandidate>((candidate) => ({
      userId: candidate.userId,
      userCreatedAt: candidate.user.createdAt,
      activeCount: countByUserId.get(candidate.userId) ?? 0
    }))
    .sort(sortByLowestActiveLoad);
}

export async function getAutoAssignmentConfig(client: AssignmentDbClient = prisma) {
  const config = await client.assignmentConfig.findUnique({
    where: {
      scope: GLOBAL_ASSIGNMENT_CONFIG_SCOPE
    },
    select: {
      maxActiveLeadsPerExecutive: true
    }
  });

  return {
    maxActiveLeadsPerExecutive: normalizeMaxActiveLeadsPerExecutive(
      config?.maxActiveLeadsPerExecutive
    )
  } satisfies AutoAssignmentConfig;
}

export async function upsertAutoAssignmentConfig(
  maxActiveLeadsPerExecutive: number,
  client: AssignmentDbClient = prisma
) {
  const normalized = normalizeMaxActiveLeadsPerExecutive(maxActiveLeadsPerExecutive);
  const config = await client.assignmentConfig.upsert({
    where: {
      scope: GLOBAL_ASSIGNMENT_CONFIG_SCOPE
    },
    create: {
      scope: GLOBAL_ASSIGNMENT_CONFIG_SCOPE,
      maxActiveLeadsPerExecutive: normalized
    },
    update: {
      maxActiveLeadsPerExecutive: normalized
    },
    select: {
      maxActiveLeadsPerExecutive: true
    }
  });

  return {
    maxActiveLeadsPerExecutive: normalizeMaxActiveLeadsPerExecutive(
      config.maxActiveLeadsPerExecutive
    )
  } satisfies AutoAssignmentConfig;
}

export async function lockDistrictAutoAssignment(
  client: Prisma.TransactionClient,
  districtId: string
) {
  await client.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${districtId}))`;
}

export async function pickExecutiveWithLowestActiveLeads(
  districtId: string,
  options?: {
    client?: AssignmentDbClient;
    maxActiveLeadsPerExecutive?: number;
  }
) {
  const client = options?.client ?? prisma;
  const maxActiveLeadsPerExecutive =
    options?.maxActiveLeadsPerExecutive ??
    (await getAutoAssignmentConfig(client)).maxActiveLeadsPerExecutive;

  const candidates = await listDistrictCandidates(client, districtId, "EXECUTIVE");
  const countByUserId = await countActiveExecutiveLeads(
    client,
    candidates.map((candidate) => candidate.userId)
  );
  const ranked = rankCandidates(candidates, countByUserId);
  const eligible = ranked.filter(
    (candidate) => candidate.activeCount < maxActiveLeadsPerExecutive
  );
  return eligible[0]?.userId ?? null;
}

export async function pickDistrictManagerWithLowestActiveLeads(
  districtId: string,
  options?: {
    client?: AssignmentDbClient;
  }
) {
  const client = options?.client ?? prisma;
  const candidates = await listDistrictCandidates(client, districtId, "MANAGER");
  const countByUserId = await countActiveManagerLeads(
    client,
    candidates.map((candidate) => candidate.userId)
  );
  const ranked = rankCandidates(candidates, countByUserId);
  return ranked[0]?.userId ?? null;
}

export async function resolveLeadAutoAssignment(
  districtId: string,
  options?: {
    client?: AssignmentDbClient;
  }
): Promise<LeadAutoAssignmentResult> {
  const client = options?.client ?? prisma;
  const config = await getAutoAssignmentConfig(client);
  const assignedManagerId = await pickDistrictManagerWithLowestActiveLeads(districtId, {
    client
  });

  if (!assignedManagerId) {
    return {
      mode: "UNASSIGNED",
      assignedExecutiveId: null,
      assignedManagerId: null,
      noExecutiveAvailable: true,
      maxActiveLeadsPerExecutive: config.maxActiveLeadsPerExecutive,
      failureReason:
        "No active district manager is mapped to this district. Auto-assignment requires district manager mapping."
    };
  }

  const executiveCandidates = await listDistrictCandidates(client, districtId, "EXECUTIVE");
  const executiveCountByUserId = await countActiveExecutiveLeads(
    client,
    executiveCandidates.map((candidate) => candidate.userId)
  );
  const rankedExecutives = rankCandidates(executiveCandidates, executiveCountByUserId);
  const eligibleExecutives = rankedExecutives.filter(
    (candidate) => candidate.activeCount < config.maxActiveLeadsPerExecutive
  );

  if (eligibleExecutives.length > 0) {
    return {
      mode: "EXECUTIVE",
      assignedExecutiveId: eligibleExecutives[0].userId,
      assignedManagerId,
      noExecutiveAvailable: false,
      maxActiveLeadsPerExecutive: config.maxActiveLeadsPerExecutive
    };
  }

  const fallbackReason =
    rankedExecutives.length === 0
      ? "No active field executive is mapped to this district."
      : `All active field executives in this district are at maximum load (${config.maxActiveLeadsPerExecutive}).`;

  return {
    mode: "MANAGER_FALLBACK",
    assignedExecutiveId: null,
    assignedManagerId,
    noExecutiveAvailable: true,
    maxActiveLeadsPerExecutive: config.maxActiveLeadsPerExecutive,
    fallbackReason
  };
}
