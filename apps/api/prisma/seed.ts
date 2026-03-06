import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";

dotenv.config();

const prisma = new PrismaClient();

const DEFAULT_LEAD_STATUSES = [
  {
    name: "New Lead",
    description: "Newly captured lead",
    orderIndex: 1,
    isTerminal: false,
    slaDurationHours: 4,
    colorCode: "#2563EB",
    requiresNote: false,
    requiresDocument: false,
    notifyCustomer: false
  },
  {
    name: "Assigned",
    description: "Lead has been auto-assigned",
    orderIndex: 2,
    isTerminal: false,
    slaDurationHours: 8,
    colorCode: "#0F766E",
    requiresNote: false,
    requiresDocument: false,
    notifyCustomer: false
  },
  {
    name: "Contacted",
    description: "First call completed",
    orderIndex: 3,
    isTerminal: false,
    slaDurationHours: 24,
    colorCode: "#7C3AED",
    requiresNote: true,
    requiresDocument: false,
    notifyCustomer: false
  },
  {
    name: "Site Visit Scheduled",
    description: "Site visit planned",
    orderIndex: 4,
    isTerminal: false,
    slaDurationHours: 72,
    colorCode: "#0891B2",
    requiresNote: true,
    requiresDocument: false,
    notifyCustomer: true
  },
  {
    name: "Site Visit Completed",
    description: "Survey done",
    orderIndex: 5,
    isTerminal: false,
    slaDurationHours: 120,
    colorCode: "#0D9488",
    requiresNote: true,
    requiresDocument: true,
    notifyCustomer: false
  },
  {
    name: "Quotation Shared",
    description: "Quote sent to customer",
    orderIndex: 6,
    isTerminal: false,
    slaDurationHours: 168,
    colorCode: "#CA8A04",
    requiresNote: true,
    requiresDocument: true,
    notifyCustomer: true
  },
  {
    name: "Token Payment Verified",
    description: "Token payment verified by admin/manager",
    orderIndex: 7,
    isTerminal: false,
    slaDurationHours: 240,
    colorCode: "#15803D",
    requiresNote: false,
    requiresDocument: false,
    notifyCustomer: true
  },
  {
    name: "Won",
    description: "Lead converted",
    orderIndex: 8,
    isTerminal: true,
    slaDurationHours: null,
    colorCode: "#16A34A",
    requiresNote: true,
    requiresDocument: true,
    notifyCustomer: true
  },
  {
    name: "Lost",
    description: "Lead dropped",
    orderIndex: 9,
    isTerminal: true,
    slaDurationHours: null,
    colorCode: "#DC2626",
    requiresNote: true,
    requiresDocument: false,
    notifyCustomer: false
  }
] as const;

const DEFAULT_TRANSITIONS: Array<[string, string]> = [
  ["New Lead", "Assigned"],
  ["New Lead", "Token Payment Verified"],
  ["Assigned", "Contacted"],
  ["Assigned", "Token Payment Verified"],
  ["Contacted", "Site Visit Scheduled"],
  ["Contacted", "Token Payment Verified"],
  ["Site Visit Scheduled", "Site Visit Completed"],
  ["Site Visit Scheduled", "Token Payment Verified"],
  ["Site Visit Completed", "Quotation Shared"],
  ["Site Visit Completed", "Token Payment Verified"],
  ["Quotation Shared", "Token Payment Verified"],
  ["Token Payment Verified", "Won"],
  ["Token Payment Verified", "Lost"],
  ["Quotation Shared", "Won"],
  ["Quotation Shared", "Lost"],
  ["Assigned", "Lost"],
  ["New Lead", "Lost"],
  ["Contacted", "Lost"],
  ["Site Visit Scheduled", "Lost"],
  ["Site Visit Completed", "Lost"]
];

async function seedStatusesAndTransitions() {
  for (const status of DEFAULT_LEAD_STATUSES) {
    await prisma.leadStatus.upsert({
      where: { name: status.name },
      update: {
        description: status.description,
        orderIndex: status.orderIndex,
        isTerminal: status.isTerminal,
        slaDurationHours: status.slaDurationHours,
        colorCode: status.colorCode,
        requiresNote: status.requiresNote,
        requiresDocument: status.requiresDocument,
        notifyCustomer: status.notifyCustomer
      },
      create: { ...status }
    });
  }

  const statuses = await prisma.leadStatus.findMany({
    where: { name: { in: DEFAULT_LEAD_STATUSES.map((s) => s.name) } },
    select: { id: true, name: true }
  });
  const byName = Object.fromEntries(statuses.map((s) => [s.name, s.id]));

  for (const [fromName, toName] of DEFAULT_TRANSITIONS) {
    const fromId = byName[fromName];
    const toId = byName[toName];
    if (!fromId || !toId) continue;

    await prisma.leadStatusTransition.upsert({
      where: {
        fromStatusId_toStatusId: {
          fromStatusId: fromId,
          toStatusId: toId
        }
      },
      update: {},
      create: {
        fromStatusId: fromId,
        toStatusId: toId
      }
    });
  }
}

async function seedSuperAdmin() {
  const password = process.env.SEED_SUPER_ADMIN_PASSWORD;
  if (!password) {
    throw new Error("SEED_SUPER_ADMIN_PASSWORD is required in apps/api/.env");
  }

  const email = process.env.SEED_SUPER_ADMIN_EMAIL ?? "chandan32005c@gmail.com";
  const fullName = process.env.SEED_SUPER_ADMIN_NAME ?? "Super Admin";
  const phone = process.env.SEED_SUPER_ADMIN_PHONE ?? null;
  const employeeId = process.env.SEED_SUPER_ADMIN_EMPLOYEE_ID ?? "SA-001";

  const passwordHash = await bcrypt.hash(password, 12);

  const existingByEmployeeId = await prisma.user.findUnique({
    where: { employeeId },
    select: { id: true }
  });

  if (existingByEmployeeId) {
    return prisma.user.update({
      where: { id: existingByEmployeeId.id },
      data: {
        email,
        fullName,
        phone,
        employeeId,
        role: "SUPER_ADMIN",
        status: "ACTIVE",
        passwordHash
      }
    });
  }

  const superAdmin = await prisma.user.upsert({
    where: { email },
    update: {
      fullName,
      phone,
      employeeId,
      role: "SUPER_ADMIN",
      status: "ACTIVE",
      passwordHash
    },
    create: {
      email,
      fullName,
      phone,
      employeeId,
      role: "SUPER_ADMIN",
      status: "ACTIVE",
      passwordHash
    }
  });

  return superAdmin;
}

async function main() {
  await seedStatusesAndTransitions();
  const superAdmin = await seedSuperAdmin();

  console.log("Seed complete");
  console.log({
    superAdminEmail: superAdmin.email,
    statusesSeeded: DEFAULT_LEAD_STATUSES.length,
    transitionsSeeded: DEFAULT_TRANSITIONS.length
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
