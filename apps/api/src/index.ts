import { app } from "./app.js";
import { env } from "./config/env.js";
import { bootstrapSeedSuperAdmin } from "./lib/bootstrap-super-admin.js";
import { runPrismaStartupChecks } from "./lib/prisma.js";

async function start() {
  app.listen(env.PORT, "0.0.0.0", () => {
    console.log(`API running on port ${env.PORT}`);
  });
  // Keep startup non-blocking for platform port detection; DB checks still log issues.
  void runPrismaStartupChecks();
  // Ensure the configured super-admin account is always mapped for Supabase Auth login.
  void bootstrapSeedSuperAdmin();
}

void start();
