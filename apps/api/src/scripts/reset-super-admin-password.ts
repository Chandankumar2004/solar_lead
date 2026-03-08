import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";

dotenv.config();

const prisma = new PrismaClient();
const BCRYPT_WORK_FACTOR = 12;

function stripWrappingQuotes(raw: string) {
  const trimmed = raw.trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

async function main() {
  const password = stripWrappingQuotes(process.env.SEED_SUPER_ADMIN_PASSWORD ?? "");
  if (!password) {
    throw new Error("SEED_SUPER_ADMIN_PASSWORD is required");
  }

  const email = stripWrappingQuotes(
    process.env.SEED_SUPER_ADMIN_EMAIL ?? "chandan32005c@gmail.com"
  ).toLowerCase();
  const fullName = stripWrappingQuotes(process.env.SEED_SUPER_ADMIN_NAME ?? "Super Admin") || "Super Admin";
  const phoneRaw = stripWrappingQuotes(process.env.SEED_SUPER_ADMIN_PHONE ?? "");
  const phone = phoneRaw.length > 0 ? phoneRaw : null;
  const employeeId = stripWrappingQuotes(process.env.SEED_SUPER_ADMIN_EMPLOYEE_ID ?? "SA-001") || "SA-001";

  const passwordHash = await bcrypt.hash(password, BCRYPT_WORK_FACTOR);

  const existingByEmployeeId = await prisma.user.findUnique({
    where: { employeeId },
    select: { id: true }
  });

  if (existingByEmployeeId) {
    const user = await prisma.user.update({
      where: { id: existingByEmployeeId.id },
      data: {
        email,
        fullName,
        phone,
        employeeId,
        role: "SUPER_ADMIN",
        status: "ACTIVE",
        passwordHash
      },
      select: { id: true, email: true, employeeId: true, status: true, role: true }
    });
    console.log("SUPER_ADMIN_PASSWORD_RESET_OK");
    console.log(user);
    return;
  }

  const user = await prisma.user.upsert({
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
    },
    select: { id: true, email: true, employeeId: true, status: true, role: true }
  });

  console.log("SUPER_ADMIN_PASSWORD_RESET_OK");
  console.log(user);
}

main()
  .catch((error) => {
    console.error("SUPER_ADMIN_PASSWORD_RESET_FAILED", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
