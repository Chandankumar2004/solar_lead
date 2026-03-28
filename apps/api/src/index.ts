import { app } from "./app.js";
import { env } from "./config/env.js";
import { runStartupHealthChecks } from "./lib/startup-health.js";
import { startSlaOverdueMonitor } from "./services/sla-overdue.service.js";

const STARTUP_HEALTH_RETRY_MS = 30_000;

async function initializeSlaMonitor() {
  const healthy = await runStartupHealthChecks();
  if (healthy) {
    startSlaOverdueMonitor();
    console.info("SLA_MONITOR_STARTED", {
      reason: "PRISMA_READY"
    });
    return;
  }

  console.warn("SLA_MONITOR_DELAYED", {
    reason: "PRISMA_NOT_READY",
    retryMs: STARTUP_HEALTH_RETRY_MS
  });

  setTimeout(() => {
    void initializeSlaMonitor();
  }, STARTUP_HEALTH_RETRY_MS);
}

async function start() {
  const port = env.PORT;
  console.info("API_STARTUP", {
    env: env.NODE_ENV,
    port,
    redis: env.REDIS_URL ? "configured" : "disabled"
  });
  app.listen(port, "0.0.0.0", () => {
    console.log(`API running on port ${port}`);
  });

  void initializeSlaMonitor();
}

void start();
