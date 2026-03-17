import { app } from "./app.js";
import { env } from "./config/env.js";
import { runStartupHealthChecks } from "./lib/startup-health.js";
import { startSlaOverdueMonitor } from "./services/sla-overdue.service.js";

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

  void runStartupHealthChecks();
  startSlaOverdueMonitor();
}

void start();
