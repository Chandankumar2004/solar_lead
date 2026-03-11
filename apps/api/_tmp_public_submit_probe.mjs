import "dotenv/config";
import { prisma } from "./dist/lib/prisma.js";

async function run() {
  const district = await prisma.district.findFirst({
    where: { isActive: true },
    select: { id: true, name: true, state: true }
  });

  if (!district) {
    console.log("NO_ACTIVE_DISTRICT");
    return;
  }

  const statuses = await prisma.leadStatus.findMany({
    select: { id: true, name: true },
    orderBy: { orderIndex: "asc" }
  });

  const newStatus = statuses.find((s) => /new/i.test(s.name)) ?? null;
  const assignedStatus = statuses.find((s) => /assigned/i.test(s.name)) ?? null;

  const assignment = await prisma.userDistrictAssignment.findFirst({
    where: {
      districtId: district.id,
      user: {
        status: "ACTIVE",
        role: { in: ["EXECUTIVE", "MANAGER"] }
      }
    },
    select: { userId: true, user: { select: { role: true } } }
  });

  console.log(
    JSON.stringify(
      {
        district,
        newStatus,
        assignedStatus,
        assignment
      },
      null,
      2
    )
  );

  if (!newStatus || !assignedStatus || !assignment?.userId) {
    console.log("MISSING_STATUS_OR_ASSIGNMENT");
    return;
  }

  try {
    const createdLead = await prisma.lead.create({
      data: {
        name: "Probe Lead",
        phone: `9${Date.now().toString().slice(-9)}`,
        email: `probe+${Date.now()}@example.com`,
        monthlyBill: 499.99,
        districtId: district.id,
        state: district.state,
        installationType: "Commercial Rooftop",
        message: "Probe insert",
        currentStatusId: newStatus.id,
        assignedExecutiveId: assignment.user.role === "EXECUTIVE" ? assignment.userId : null,
        assignedManagerId: assignment.user.role === "MANAGER" ? assignment.userId : null,
        isOverdue: false,
        consentGiven: true,
        consentTimestamp: new Date(),
        statusHistory: {
          create: {
            toStatusId: newStatus.id,
            changedByUserId: assignment.userId,
            notes: "Probe create"
          }
        }
      },
      select: { id: true, externalId: true }
    });

    console.log("LEAD_CREATE_OK", createdLead);

    await prisma.lead.delete({ where: { id: createdLead.id } });
    console.log("LEAD_DELETE_OK");
  } catch (error) {
    console.error("LEAD_CREATE_ERROR", error);
  }
}

run()
  .catch((error) => {
    console.error("PROBE_ERROR", error);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
