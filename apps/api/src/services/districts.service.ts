import { prisma } from "../lib/prisma.js";
import { UserRole } from "../types.js";

type PublicDistrict = {
  id: string;
  name: string;
  state: string;
};

export async function getPublicDistrictsPayload() {
  const districts = await prisma.district.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      state: true
    },
    orderBy: [{ state: "asc" }, { name: "asc" }]
  });

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

export async function getDistrictAssignmentsPayload(districtId?: string) {
  const districts = await prisma.district.findMany({
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
  });

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
  return prisma.user.findMany({
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
  });
}
