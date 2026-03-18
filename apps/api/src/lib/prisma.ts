import { PrismaClient } from "@prisma/client";

type PrismaFailure = {
  at: string;
  message: string;
  code: string | null;
};

const globalForPrisma = globalThis as typeof globalThis & { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ["error"]
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

let prismaConnected = false;
let prismaLastFailure: PrismaFailure | null = null;

function summarizeConnectionError(error: unknown) {
  if (error && typeof error === "object") {
    const maybe = error as { name?: unknown; message?: unknown; code?: unknown };
    return {
      name: typeof maybe.name === "string" ? maybe.name : "Error",
      message: typeof maybe.message === "string" ? maybe.message : "Unknown connection error",
      code: typeof maybe.code === "string" ? maybe.code : null
    };
  }

  return {
    name: "Error",
    message: typeof error === "string" ? error : "Unknown connection error",
    code: null
  };
}

export function isPrismaConnected() {
  return prismaConnected;
}

export function getPrismaConnectionState() {
  return {
    connected: prismaConnected,
    lastFailure: prismaLastFailure
  };
}

export async function runPrismaStartupChecks(): Promise<boolean> {
  try {
    await prisma.$connect();
    await prisma.$queryRawUnsafe("SELECT 1");

    prismaConnected = true;
    prismaLastFailure = null;

    console.info("PRISMA_CONNECTION_OK", { source: "DATABASE_URL" });
    return true;
  } catch (error) {
    const connectionError = summarizeConnectionError(error);

    prismaConnected = false;
    prismaLastFailure = {
      at: new Date().toISOString(),
      message: connectionError.message,
      code: connectionError.code
    };

    console.error("PRISMA_CONNECTION_FAILED", {
      source: "DATABASE_URL",
      error: connectionError
    });

    return false;
  }
}
