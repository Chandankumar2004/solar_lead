const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const projectRoot = path.resolve(__dirname, "..");
const mobileRoot = path.join(projectRoot, "apps", "mobile");
const logPath = path.join(projectRoot, "mobile-live.log");
const outFd = fs.openSync(logPath, "a");
const sdkRoot = "C:\\Users\\chand\\AppData\\Local\\Android\\Sdk";
const platformTools = `${sdkRoot}\\platform-tools`;
const startCommand =
  `set ANDROID_HOME=${sdkRoot}` +
  `&& set ANDROID_SDK_ROOT=${sdkRoot}` +
  `&& set PATH=%PATH%;${platformTools}` +
  "&& npx expo start --tunnel --clear";

const child = spawn(
  "cmd.exe",
  ["/c", startCommand],
  {
    cwd: mobileRoot,
    detached: true,
    stdio: ["ignore", outFd, outFd]
  }
);

child.unref();
console.log(`started_mobile_pid=${child.pid}`);
