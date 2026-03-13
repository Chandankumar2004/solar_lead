import { app } from "./app.js";
import { runStartupHealthChecks } from "./lib/startup-health.js";
import { startSlaOverdueMonitor } from "./services/sla-overdue.service.js";

async function start() {
  const port = Number(process.env.PORT || 4000);
  app.listen(port, "0.0.0.0", () => {
    console.log(`API running on port ${port}`);
  });

  void runStartupHealthChecks();
  startSlaOverdueMonitor();
}

void start();
