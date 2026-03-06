import { randomBytes } from "node:crypto";

const bytes = Number(process.argv[2] || 64);
if (!Number.isFinite(bytes) || bytes < 32) {
  console.error("Usage: node src/scripts/generate-jwt-secret.js [bytes>=32]");
  process.exit(1);
}

console.log(randomBytes(bytes).toString("hex"));

