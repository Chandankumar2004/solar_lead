import bcrypt from "bcryptjs";
import { prisma } from "./prisma.js";
import { ensureSupabaseAuthUserForAppUser } from "../services/supabase-auth.service.js";

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

function nonEmpty(raw: string | undefined | null) {
  const value = stripWrappingQuotes(raw ?? "");
  return value.length > 0 ? value : null;
}

export async function bootstrapSeedSuperAdmin() {
  const email = nonEmpty(process.env.SEED_SUPER_ADMIN_EMAIL)?.toLowerCase();
  const password = nonEmpty(process.env.SEED_SUPER_ADMIN_PASSWORD);
  if (!email || !password) {
    return;
  }

  const fullName = nonEmpty(process.env.SEED_SUPER_ADMIN_NAME) ?? "Super Admin";
  const phone = nonEmpty(process.env.SEED_SUPER_ADMIN_PHONE);
  const employeeId = nonEmpty(process.env.SEED_SUPER_ADMIN_EMPLOYEE_ID) ?? "SA-001";

  try {
    const passwordHash = await bcrypt.hash(password, BCRYPT_WORK_FACTOR);
    const existingByEmployeeId = await prisma.user.findUnique({
      where: { employeeId },
      select: { id: true }
    });

    const appUser = existingByEmployeeId
      ? await prisma.user.update({
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
          select: { id: true, email: true, fullName: true }
        })
      : await prisma.user.upsert({
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
          select: { id: true, email: true, fullName: true }
        });

    const synced = await ensureSupabaseAuthUserForAppUser({
      appUserId: appUser.id,
      email: appUser.email,
      fullName: appUser.fullName,
      password,
      createIfMissing: true,
      syncExisting: true
    });

    if (!synced.ok) {
      console.error("SUPER_ADMIN_BOOTSTRAP_AUTH_SYNC_FAILED", {
        reason: synced.reason,
        message: synced.message,
        email: appUser.email,
        appUserId: appUser.id
      });
      return;
    }

    console.info("SUPER_ADMIN_BOOTSTRAP_OK", {
      email: appUser.email,
      appUserId: appUser.id,
      supabaseUserId: synced.supabaseUserId,
      created: synced.created
    });
  } catch (error) {
    console.error("SUPER_ADMIN_BOOTSTRAP_FAILED", { error });
  }
}
