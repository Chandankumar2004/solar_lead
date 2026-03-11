const { spawnSync } = require("node:child_process");

const isRecursiveRun =
  process.env.npm_command === "recursive" ||
  process.env.npm_config_recursive === "true";

if (isRecursiveRun) {
  process.exit(0);
}

const workspaceTargets = ["@solar/shared", "@solar/api", "@solar/web", "@solar/mobile"];

for (const target of workspaceTargets) {
  const result =
    process.platform === "win32"
      ? spawnSync("cmd.exe", ["/d", "/s", "/c", `pnpm --filter ${target} typecheck`], {
          stdio: "inherit",
          shell: false
        })
      : spawnSync("pnpm", ["--filter", target, "typecheck"], {
          stdio: "inherit",
          shell: false
        });

  if (result.error) {
    console.error("TYPECHECK_WORKSPACES_FAILED", {
      target,
      reason: result.error.message
    });
    process.exit(1);
  }

  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }
}
