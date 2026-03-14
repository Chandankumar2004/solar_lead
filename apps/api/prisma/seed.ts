import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import fs from "node:fs/promises";
import { PrismaClient } from "@prisma/client";

dotenv.config();

const prisma = new PrismaClient();

const REQUIRED_DEFAULT_LEAD_STATUSES = [
  {
    name: "New",
    description: "Initial state for newly captured lead",
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
    description: "Lead assigned to manager / field executive",
    orderIndex: 2,
    isTerminal: false,
    slaDurationHours: 8,
    colorCode: "#0F766E",
    requiresNote: false,
    requiresDocument: false,
    notifyCustomer: false
  },
  {
    name: "Field Visit Scheduled",
    description: "Field visit planned with customer",
    orderIndex: 3,
    isTerminal: false,
    slaDurationHours: 24,
    colorCode: "#0891B2",
    requiresNote: true,
    requiresDocument: false,
    notifyCustomer: true
  },
  {
    name: "Field Visit Done",
    description: "Field visit completed",
    orderIndex: 4,
    isTerminal: false,
    slaDurationHours: 72,
    colorCode: "#0D9488",
    requiresNote: true,
    requiresDocument: false,
    notifyCustomer: false
  },
  {
    name: "Documents Uploaded by Field Executive",
    description: "Field executive uploaded required documents",
    orderIndex: 5,
    isTerminal: false,
    slaDurationHours: 120,
    colorCode: "#7C3AED",
    requiresNote: true,
    requiresDocument: true,
    notifyCustomer: false
  },
  {
    name: "Token Amount Received (INR 1000)",
    description: "Token amount received from customer",
    orderIndex: 6,
    isTerminal: false,
    slaDurationHours: 96,
    colorCode: "#D97706",
    requiresNote: true,
    requiresDocument: false,
    notifyCustomer: false
  },
  {
    name: "Token Payment Verification Pending",
    description: "Token payment verification pending",
    orderIndex: 7,
    isTerminal: false,
    slaDurationHours: 48,
    colorCode: "#F59E0B",
    requiresNote: false,
    requiresDocument: false,
    notifyCustomer: false
  },
  {
    name: "Token Payment Verified",
    description: "Token payment verified",
    orderIndex: 8,
    isTerminal: false,
    slaDurationHours: 48,
    colorCode: "#15803D",
    requiresNote: false,
    requiresDocument: false,
    notifyCustomer: true
  },
  {
    name: "Verification Pending",
    description: "Internal verification pending",
    orderIndex: 9,
    isTerminal: false,
    slaDurationHours: 72,
    colorCode: "#4F46E5",
    requiresNote: false,
    requiresDocument: true,
    notifyCustomer: false
  },
  {
    name: "Verified",
    description: "Lead verified for loan stage",
    orderIndex: 10,
    isTerminal: false,
    slaDurationHours: 72,
    colorCode: "#4338CA",
    requiresNote: false,
    requiresDocument: false,
    notifyCustomer: true
  },
  {
    name: "Loan Application Initiated",
    description: "Loan application initiated",
    orderIndex: 11,
    isTerminal: false,
    slaDurationHours: 120,
    colorCode: "#1D4ED8",
    requiresNote: false,
    requiresDocument: true,
    notifyCustomer: false
  },
  {
    name: "Loan Approval Pending",
    description: "Loan approval pending",
    orderIndex: 12,
    isTerminal: false,
    slaDurationHours: 168,
    colorCode: "#2563EB",
    requiresNote: false,
    requiresDocument: false,
    notifyCustomer: false
  },
  {
    name: "Loan Disbursed",
    description: "Loan disbursed",
    orderIndex: 13,
    isTerminal: false,
    slaDurationHours: 240,
    colorCode: "#0EA5E9",
    requiresNote: false,
    requiresDocument: false,
    notifyCustomer: true
  },
  {
    name: "Loan Rejected",
    description: "Loan rejected by lender",
    orderIndex: 14,
    isTerminal: false,
    slaDurationHours: 240,
    colorCode: "#DC2626",
    requiresNote: true,
    requiresDocument: false,
    notifyCustomer: true
  },
  {
    name: "Installation Scheduled",
    description: "Installation scheduled",
    orderIndex: 15,
    isTerminal: false,
    slaDurationHours: 120,
    colorCode: "#0F766E",
    requiresNote: false,
    requiresDocument: false,
    notifyCustomer: true
  },
  {
    name: "Installation In Progress",
    description: "Installation in progress",
    orderIndex: 16,
    isTerminal: false,
    slaDurationHours: 120,
    colorCode: "#0D9488",
    requiresNote: false,
    requiresDocument: false,
    notifyCustomer: false
  },
  {
    name: "Installation Complete",
    description: "Installation completed",
    orderIndex: 17,
    isTerminal: true,
    slaDurationHours: null,
    colorCode: "#16A34A",
    requiresNote: true,
    requiresDocument: true,
    notifyCustomer: true
  },
  {
    name: "Closed (Lost)",
    description: "Lead closed as lost",
    orderIndex: 18,
    isTerminal: true,
    slaDurationHours: null,
    colorCode: "#DC2626",
    requiresNote: true,
    requiresDocument: false,
    notifyCustomer: false
  }
] as const;

const DEFAULT_TRANSITIONS: Array<[string, string]> = [
  ["New", "Assigned"],
  ["Assigned", "Field Visit Scheduled"],
  ["Field Visit Scheduled", "Field Visit Done"],
  ["Field Visit Done", "Documents Uploaded by Field Executive"],
  ["Documents Uploaded by Field Executive", "Token Amount Received (INR 1000)"],
  ["Token Amount Received (INR 1000)", "Token Payment Verification Pending"],
  ["Token Payment Verification Pending", "Token Payment Verified"],
  ["Token Payment Verified", "Verification Pending"],
  ["Verification Pending", "Verified"],
  ["Verified", "Loan Application Initiated"],
  ["Loan Application Initiated", "Loan Approval Pending"],
  ["Loan Approval Pending", "Loan Disbursed"],
  ["Loan Approval Pending", "Loan Rejected"],
  ["Loan Disbursed", "Installation Scheduled"],
  ["Installation Scheduled", "Installation In Progress"],
  ["Installation In Progress", "Installation Complete"],
  ["Loan Rejected", "Closed (Lost)"],
  ["New", "Closed (Lost)"],
  ["Assigned", "Closed (Lost)"],
  ["Field Visit Scheduled", "Closed (Lost)"],
  ["Field Visit Done", "Closed (Lost)"],
  ["Documents Uploaded by Field Executive", "Closed (Lost)"],
  ["Token Amount Received (INR 1000)", "Closed (Lost)"],
  ["Token Payment Verification Pending", "Closed (Lost)"],
  ["Token Payment Verified", "Closed (Lost)"],
  ["Verification Pending", "Closed (Lost)"],
  ["Verified", "Closed (Lost)"],
  ["Loan Application Initiated", "Closed (Lost)"],
  ["Loan Approval Pending", "Closed (Lost)"],
  ["Loan Disbursed", "Closed (Lost)"],
  ["Installation Scheduled", "Closed (Lost)"],
  ["Installation In Progress", "Closed (Lost)"]
];

type DistrictMappingFile = {
  districts?: Array<{
    id: string;
    name: string;
    state: string;
  }>;
};

async function loadDistrictsFromMappingFile() {
  const mappingUrl = new URL("../../web/public/districts.mapping.json", import.meta.url);
  try {
    const raw = await fs.readFile(mappingUrl, "utf8");
    const parsed = JSON.parse(raw) as DistrictMappingFile;
    const districts = Array.isArray(parsed.districts) ? parsed.districts : [];
    return districts.filter(
      (district) =>
        typeof district.id === "string" &&
        typeof district.name === "string" &&
        district.name.trim().length > 0 &&
        typeof district.state === "string" &&
        district.state.trim().length > 0
    );
  } catch (error) {
    console.warn("district_mapping_file_read_failed", error);
    return [];
  }
}

async function seedDistrictsFromMapping() {
  const districts = await loadDistrictsFromMappingFile();
  if (!districts.length) {
    return 0;
  }

  for (const district of districts) {
    await prisma.district.upsert({
      where: {
        name_state: {
          name: district.name,
          state: district.state
        }
      },
      update: {
        isActive: true
      },
      create: {
        id: district.id,
        name: district.name,
        state: district.state,
        isActive: true
      }
    });
  }

  return districts.length;
}

async function seedStatusesAndTransitions() {
  for (const status of REQUIRED_DEFAULT_LEAD_STATUSES) {
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

  const requiredOrder = REQUIRED_DEFAULT_LEAD_STATUSES.map((status) => status.name);
  const requiredNames = new Set(requiredOrder);
  const allStatuses = await prisma.leadStatus.findMany({
    select: { id: true, name: true, orderIndex: true, createdAt: true }
  });
  const trailingStatuses = allStatuses
    .filter((status) => !requiredNames.has(status.name))
    .sort((a, b) => {
      if (a.orderIndex !== b.orderIndex) return a.orderIndex - b.orderIndex;
      if (a.createdAt.getTime() !== b.createdAt.getTime()) {
        return a.createdAt.getTime() - b.createdAt.getTime();
      }
      return a.name.localeCompare(b.name);
    })
    .map((status) => status.name);
  const statusIdsByName = new Map(allStatuses.map((status) => [status.name, status.id]));
  const finalOrderedNames = [...requiredOrder, ...trailingStatuses];

  for (let index = 0; index < finalOrderedNames.length; index += 1) {
    const statusName = finalOrderedNames[index];
    const statusId = statusIdsByName.get(statusName);
    if (!statusId) continue;
    await prisma.leadStatus.update({
      where: { id: statusId },
      data: { orderIndex: index + 1 }
    });
  }

  const statuses = await prisma.leadStatus.findMany({
    where: { name: { in: REQUIRED_DEFAULT_LEAD_STATUSES.map((s) => s.name) } },
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
  const districtsSeeded = await seedDistrictsFromMapping();
  await seedStatusesAndTransitions();
  const superAdmin = await seedSuperAdmin();

  console.log("Seed complete");
  console.log({
    superAdminEmail: superAdmin.email,
    districtsSeeded,
    statusesSeeded: REQUIRED_DEFAULT_LEAD_STATUSES.length,
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
