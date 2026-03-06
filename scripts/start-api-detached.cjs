const { spawn } = require("child_process");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");

const child = spawn("cmd.exe", ["/c", "pnpm --filter @solar/api dev"], {
  cwd: projectRoot,
  detached: true,
  stdio: "ignore"
});

child.unref();
console.log(`started_api_pid=${child.pid}`);
