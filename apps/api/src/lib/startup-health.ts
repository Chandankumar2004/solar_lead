import { getPrismaConnectionState, runPrismaStartupChecks } from "./prisma.js";

export async function runStartupHealthChecks(): Promise<boolean> {
  const connected = await runPrismaStartupChecks({ quiet: false });
  if (connected) {
    console.info("STARTUP_HEALTH_OK", {
      reason: "PRISMA_DB_PROBE_OK"
    });
    return true;
  }

  console.error("STARTUP_HEALTH_ERROR", {
    reason: "PRISMA_DB_PROBE_FAILED",
    prisma: getPrismaConnectionState()
  });
  return false;
}
