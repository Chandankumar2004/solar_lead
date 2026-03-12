import { app } from "./app.js";
import { env } from "./config/env.js";
import { runPrismaStartupChecks } from "./lib/prisma.js";
import { runStartupHealthChecks } from "./lib/startup-health.js";
import { startSlaOverdueMonitor } from "./services/sla-overdue.service.js";

async function start() {
  app.listen(env.PORT, "0.0.0.0", () => {
    console.log(`API running on port ${env.PORT}`);
  });
  // Keep startup non-blocking for platform port detection.
  void runStartupHealthChecks();
  void runPrismaStartupChecks({ quiet: true }).then((connected) => {
    if (!connected) {
      console.warn("PRISMA_DEGRADED_MODE", {
        reason: "DATABASE_UNAVAILABLE_ON_STARTUP"
      });
    }
  });
  startSlaOverdueMonitor();
}

void start();
