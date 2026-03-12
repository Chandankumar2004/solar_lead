import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../lib/errors.js";
import type { AuthUser } from "../types.js";

export type LeadAccessActor = Pick<AuthUser, "id" | "role">;

function managerDistrictScope(userId: string): Prisma.LeadWhereInput {
  return {
    district: {
      assignments: {
        some: {
          userId,
          user: {
            role: "MANAGER",
            status: "ACTIVE"
          }
        }
      }
    }
  };
}

export function buildLeadAccessScope(user: LeadAccessActor): Prisma.LeadWhereInput | null {
  if (user.role === "SUPER_ADMIN" || user.role === "ADMIN") {
    return null;
  }

  if (user.role === "MANAGER") {
    return {
      OR: [
        { assignedManagerId: user.id },
        managerDistrictScope(user.id)
      ]
    };
  }

  return {
    assignedExecutiveId: user.id
  };
}

export function scopeLeadWhere(
  user: LeadAccessActor,
  baseWhere?: Prisma.LeadWhereInput
): Prisma.LeadWhereInput {
  const scope = buildLeadAccessScope(user);
  if (!scope) {
    return baseWhere ?? {};
  }
  if (!baseWhere || Object.keys(baseWhere).length === 0) {
    return scope;
  }
  return {
    AND: [baseWhere, scope]
  };
}

export async function assertDistrictAccessForLeadCreation(
  user: LeadAccessActor,
  districtId: string
) {
  if (user.role === "SUPER_ADMIN" || user.role === "ADMIN") {
    return;
  }

  const assignment = await prisma.userDistrictAssignment.findFirst({
    where: {
      userId: user.id,
      districtId,
      user: {
        role: user.role,
        status: "ACTIVE"
      }
    },
    select: { id: true }
  });

  if (!assignment) {
    throw new AppError(
      403,
      "FORBIDDEN",
      "You are not mapped to this district and cannot create leads here"
    );
  }
}

export async function assertLeadAccess(user: LeadAccessActor, leadId: string) {
  const where = scopeLeadWhere(user, { id: leadId });
  const lead = await prisma.lead.findFirst({
    where,
    select: { id: true }
  });
  if (!lead) {
    throw new AppError(404, "NOT_FOUND", "Lead not found");
  }
}
