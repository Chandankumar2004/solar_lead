const path = require("node:path");
const { spawn } = require("node:child_process");

const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 1200;
const EPERM_RETRY_PATTERN =
  /(EPERM|operation not permitted, rename|query_engine.*\.tmp|Access is denied)/i;
const ENGINE_DOWNLOAD_RETRY_PATTERN =
  /(binaries\.prisma\.sh|query_engine.*\.sha256|schema-engine.*\.sha256|ECONNRESET|ECONNREFUSED|ETIMEDOUT)/i;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runGenerateOnce(apiDir, prismaCliPath) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [prismaCliPath, "generate", "--schema=./prisma/schema.prisma"],
      {
        cwd: apiDir,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"]
      }
    );

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });

    child.on("error", (error) => {
      resolve({
        exitCode: 1,
        output: `${stdout}\n${stderr}\n${String(error)}`.trim()
      });
    });

    child.on("close", (code) => {
      resolve({
        exitCode: code ?? 1,
        output: `${stdout}\n${stderr}`.trim()
      });
    });
  });
}

async function main() {
  const apiDir = path.resolve(__dirname, "..");
  const prismaCliPath = require.resolve("prisma/build/index.js", {
    paths: [apiDir]
  });
  const existingClientEntry = path.resolve(apiDir, "../../node_modules/.prisma/client/index.js");
  let lastOutput = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    if (attempt > 1) {
      console.warn(`PRISMA_GENERATE_RETRY attempt=${attempt}/${MAX_ATTEMPTS}`);
    }

    const { exitCode, output } = await runGenerateOnce(apiDir, prismaCliPath);
    lastOutput = output;
    if (exitCode === 0) {
      return;
    }

    const isRetryable =
      EPERM_RETRY_PATTERN.test(output) || ENGINE_DOWNLOAD_RETRY_PATTERN.test(output);
    if (!isRetryable) {
      process.exit(exitCode || 1);
    }

    if (attempt >= MAX_ATTEMPTS) {
      break;
    }

    const delay = BASE_DELAY_MS * attempt;
    console.warn(`PRISMA_GENERATE_RETRY_WAIT delay_ms=${delay}`);
    await sleep(delay);
  }

  if (EPERM_RETRY_PATTERN.test(lastOutput) || ENGINE_DOWNLOAD_RETRY_PATTERN.test(lastOutput)) {
    try {
      const exists = require("node:fs").existsSync(existingClientEntry);
      if (exists) {
        console.warn(
          "PRISMA_GENERATE_RETRY_FALLBACK: using existing generated client due persistent local lock or transient engine download failure"
        );
        return;
      }
    } catch {
      // Ignore and fail below.
    }
  }

  process.exit(1);
}

main().catch((error) => {
  console.error("PRISMA_GENERATE_RETRY_FATAL", error);
  process.exit(1);
});
