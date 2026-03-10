import { app } from "./app.js";
import { env } from "./config/env.js";
import { runStartupHealthChecks } from "./lib/startup-health.js";

async function start() {
  app.listen(env.PORT, "0.0.0.0", () => {
    console.log(`API running on port ${env.PORT}`);
  });
  // Keep startup non-blocking for platform port detection.
  void runStartupHealthChecks();
}

void start();
