import { app } from "./app.js";
import { env } from "./config/env.js";
import { runPrismaStartupChecks } from "./lib/prisma.js";

async function start() {
  await runPrismaStartupChecks();
  app.listen(env.PORT, "0.0.0.0", () => {
    console.log(`API running on port ${env.PORT}`);
  });
}

void start();
