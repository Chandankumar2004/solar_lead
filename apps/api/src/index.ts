import { app } from "./app.js";
import { env } from "./config/env.js";
import { isPrismaConnected, runPrismaStartupChecks } from "./lib/prisma.js";
import { runStartupHealthChecks } from "./lib/startup-health.js";
import { startSlaOverdueMonitor } from "./services/sla-overdue.service.js";

const DEFAULT_PRISMA_RETRY_INTERVAL_MS = 30_000;

function resolvePrismaRetryIntervalMs() {
  const raw = Number(process.env.PRISMA_RETRY_INTERVAL_MS ?? "");
  if (Number.isFinite(raw) && raw >= 5_000) {
    return raw;
  }
  return DEFAULT_PRISMA_RETRY_INTERVAL_MS;
}

function startPrismaReconnectLoop() {
  const retryIntervalMs = resolvePrismaRetryIntervalMs();
  let inFlight = false;
  let attempts = 0;

  const run = async () => {
    if (inFlight || isPrismaConnected()) {
      return;
    }

    inFlight = true;
    attempts += 1;

    try {
      const connected = await runPrismaStartupChecks({
        // Log detailed failure periodically while still retrying.
        quiet: attempts % 5 !== 0
      });

      if (connected) {
        console.info("PRISMA_RECOVERED", {
          attempts,
          retryIntervalMs
        });
        attempts = 0;
      } else if (attempts === 1 || attempts % 5 === 0) {
        console.warn("PRISMA_RETRY_PENDING", {
          attempts,
          retryIntervalMs
        });
      }
    } finally {
      inFlight = false;
    }
  };

  void run();
  setInterval(() => {
    void run();
  }, retryIntervalMs);
}

async function start() {
  app.listen(env.PORT, "0.0.0.0", () => {
    console.log(`API running on port ${env.PORT}`);
  });
  // Keep startup non-blocking for platform port detection.
  void runStartupHealthChecks();
  void runPrismaStartupChecks({ quiet: false }).then((connected) => {
    if (!connected) {
      console.warn("PRISMA_DEGRADED_MODE", {
        reason: "DATABASE_UNAVAILABLE_ON_STARTUP"
      });
    }
  });
  startPrismaReconnectLoop();
  startSlaOverdueMonitor();
}

void start();
