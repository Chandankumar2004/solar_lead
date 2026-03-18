import type { PrismaClient } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { UserRole } from "../types.js";

type PublicDistrict = {
  id: string;
  name: string;
  state: string;
};

type DistrictListFilters = {
  state?: string;
  isActive?: boolean;
};

const PUBLIC_DISTRICTS_CACHE_TTL_MS = 60_000;
const PUBLIC_DISTRICTS_FAILURE_LOG_INTERVAL_MS = 5 * 60 * 1000;
let publicDistrictsCache: { value: PublicDistrict[]; expiresAt: number } | null = null;
let lastPublicDistrictsFailureLogAt = 0;

async function withReadFallback<T>(
  operation: string,
  run: (client: PrismaClient) => Promise<T>
) {
  try {
    return await run(prisma);
  } catch (primaryError) {
    console.error("DISTRICTS_READ_PRIMARY_DB_FAILED", {
      operation,
      reason: primaryError instanceof Error ? primaryError.message : "UNKNOWN_ERROR"
    });
    throw primaryError;
  }
}

export async function listDistrictsWithCounts(filters: DistrictListFilters) {
  return withReadFallback("LIST_DISTRICTS_WITH_COUNTS", async (client) => {
    return client.district.findMany({
      where: {
        ...(filters.state ? { state: filters.state } : {}),
        ...(filters.isActive !== undefined ? { isActive: filters.isActive } : {})
      },
      include: {
        _count: {
          select: {
            leads: true,
            assignments: true
          }
        }
      },
      orderBy: [{ state: "asc" }, { name: "asc" }]
    });
  });
}

export async function getPublicDistrictsPayload() {
  const districts = await listPublicDistrictsWithFallback();

  if (!districts.length) {
    return {
      districts,
      mapping: {},
      states: []
    };
  }

  const mapping = districts.reduce<Record<string, PublicDistrict[]>>((acc, district) => {
    if (!acc[district.state]) {
      acc[district.state] = [];
    }
    acc[district.state].push(district);
    return acc;
  }, {});

  return {
    districts,
    mapping,
    states: Object.keys(mapping)
  };
}

async function listPublicDistricts(client: PrismaClient) {
  return client.district.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      state: true
    },
    orderBy: [{ state: "asc" }, { name: "asc" }]
  });
}

async function listPublicDistrictsWithFallback() {
  const now = Date.now();
  if (publicDistrictsCache && publicDistrictsCache.expiresAt > now) {
    return publicDistrictsCache.value;
  }

  try {
    const districts = await listPublicDistricts(prisma);
    publicDistrictsCache = {
      value: districts,
      expiresAt: now + PUBLIC_DISTRICTS_CACHE_TTL_MS
    };
    return districts;
  } catch (primaryError) {
    if (now - lastPublicDistrictsFailureLogAt > PUBLIC_DISTRICTS_FAILURE_LOG_INTERVAL_MS) {
      lastPublicDistrictsFailureLogAt = now;
      console.error("PUBLIC_DISTRICTS_PRIMARY_DB_FAILED", {
        reason: primaryError instanceof Error ? primaryError.message : "UNKNOWN_ERROR"
      });
    }

    if (publicDistrictsCache) {
      return publicDistrictsCache.value;
    }

    throw primaryError;
  }
}

export async function getDistrictAssignmentsPayload(districtId?: string) {
  const districts = await withReadFallback("GET_DISTRICT_ASSIGNMENTS_PAYLOAD", (client) =>
    client.district.findMany({
      where: districtId ? { id: districtId } : undefined,
      select: {
        id: true,
        name: true,
        state: true,
        isActive: true,
        assignments: {
          select: {
            id: true,
            assignedAt: true,
            user: {
              select: {
                id: true,
                fullName: true,
                email: true,
                phone: true,
                role: true,
                status: true
              }
            }
          }
        }
      },
      orderBy: [{ state: "asc" }, { name: "asc" }]
    })
  );

  return districts.map((district) => {
    const managers = district.assignments
      .filter((a) => a.user.role === "MANAGER")
      .map((a) => ({
        assignmentId: a.id,
        assignedAt: a.assignedAt,
        ...a.user
      }));

    const executives = district.assignments
      .filter((a) => a.user.role === "EXECUTIVE")
      .map((a) => ({
        assignmentId: a.id,
        assignedAt: a.assignedAt,
        ...a.user
      }));

    return {
      id: district.id,
      name: district.name,
      state: district.state,
      isActive: district.isActive,
      managers,
      executives
    };
  });
}

export async function replaceDistrictAssignments(
  districtId: string,
  managerIds: string[],
  executiveIds: string[]
) {
  const uniqueManagerIds = [...new Set(managerIds)];
  const uniqueExecutiveIds = [...new Set(executiveIds)];
  const overlap = uniqueManagerIds.filter((id) => uniqueExecutiveIds.includes(id));
  if (overlap.length) {
    throw new Error("Same user cannot be both manager and executive in the same request.");
  }

  const district = await prisma.district.findUnique({
    where: { id: districtId },
    select: {
      id: true,
      isActive: true
    }
  });
  if (!district) {
    throw new Error("District not found");
  }

  if (district.isActive && uniqueManagerIds.length === 0) {
    throw new Error(
      "At least one active District Manager assignment is required for an active district."
    );
  }

  const allIds = [...uniqueManagerIds, ...uniqueExecutiveIds];
  if (!allIds.length) {
    await prisma.userDistrictAssignment.deleteMany({
      where: {
        districtId,
        user: { role: { in: ["MANAGER", "EXECUTIVE"] } }
      }
    });
    return getDistrictAssignmentsPayload(districtId);
  }

  const users = await prisma.user.findMany({
    where: { id: { in: allIds } },
    select: { id: true, role: true }
  });

  const roleByUserId = Object.fromEntries(users.map((u) => [u.id, u.role]));

  const invalidManagers = uniqueManagerIds.filter((id) => roleByUserId[id] !== "MANAGER");
  const invalidExecutives = uniqueExecutiveIds.filter((id) => roleByUserId[id] !== "EXECUTIVE");

  if (invalidManagers.length || invalidExecutives.length) {
    throw new Error("Invalid mapping: user role mismatch for manager/executive assignments.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.userDistrictAssignment.deleteMany({
      where: {
        districtId,
        user: {
          role: { in: ["MANAGER", "EXECUTIVE"] }
        }
      }
    });

    await tx.userDistrictAssignment.createMany({
      data: [
        ...uniqueManagerIds.map((userId) => ({ districtId, userId })),
        ...uniqueExecutiveIds.map((userId) => ({ districtId, userId }))
      ],
      skipDuplicates: true
    });
  });

  return getDistrictAssignmentsPayload(districtId);
}

export async function getActiveUsersByRole(role: UserRole) {
  return withReadFallback("GET_ACTIVE_USERS_BY_ROLE", (client) =>
    client.user.findMany({
      where: {
        role,
        status: "ACTIVE"
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true
      },
      orderBy: { fullName: "asc" }
    })
  );
}
