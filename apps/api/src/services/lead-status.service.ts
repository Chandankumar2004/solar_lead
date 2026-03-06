import { prisma } from "../lib/prisma.js";

export async function assertValidTransition(
  fromStatusId: string,
  toStatusId: string
) {
  const allowed = await prisma.leadStatusTransition.findFirst({
    where: {
      fromStatusId,
      toStatusId
    }
  });
  return Boolean(allowed);
}

async function findFirstStatusByNames(names: string[]) {
  const statuses = await prisma.leadStatus.findMany({
    where: {
      OR: names.map((name) => ({
        name: { equals: name, mode: "insensitive" }
      }))
    },
    select: {
      id: true,
      name: true
    }
  });

  if (!statuses.length) return null;

  for (const candidate of names) {
    const exact = statuses.find(
      (status) => status.name.toLowerCase() === candidate.toLowerCase()
    );
    if (exact) return exact;
  }

  return statuses[0];
}

export async function getNewLeadStatus() {
  return findFirstStatusByNames(["New", "New Lead"]);
}

export async function getAssignedLeadStatus() {
  return findFirstStatusByNames(["Assigned", "Assigned Lead"]);
}

export async function getTokenPaymentVerifiedStatus() {
  return findFirstStatusByNames([
    "Token Payment Verified",
    "Token Verified",
    "Payment Verified"
  ]);
}
