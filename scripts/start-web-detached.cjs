const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const projectRoot = path.resolve(__dirname, "..");
const logPath = path.join(projectRoot, "web-live.log");
const outFd = fs.openSync(logPath, "a");

const child = spawn("cmd.exe", ["/c", "pnpm --filter @solar/web dev -p 3200"], {
  cwd: projectRoot,
  detached: true,
  stdio: ["ignore", outFd, outFd]
});

child.unref();
console.log(`started_web_pid=${child.pid}`);
