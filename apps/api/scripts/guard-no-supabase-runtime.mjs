import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const ROOT_DIR = path.resolve(process.cwd(), "src");
const BLOCKED_PATTERNS = [/supabase_migrations/i, /schema_migrations/i];
const ALLOWED_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs"]);

async function walk(dir, files = []) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(fullPath, files);
      continue;
    }
    const ext = path.extname(entry.name).toLowerCase();
    if (ALLOWED_EXTENSIONS.has(ext)) {
      files.push(fullPath);
    }
  }
  return files;
}

function toPosix(p) {
  return p.split(path.sep).join("/");
}

async function main() {
  const files = await walk(ROOT_DIR);
  const violations = [];

  for (const filePath of files) {
    const content = await readFile(filePath, "utf8");
    for (const pattern of BLOCKED_PATTERNS) {
      if (pattern.test(content)) {
        violations.push({ filePath, pattern: pattern.source });
        break;
      }
    }
  }

  if (violations.length > 0) {
    console.error("AUTH_GUARD_ERROR", {
      reason: "SUPABASE_METADATA_RUNTIME_REFERENCE_BLOCKED",
      violations: violations.map((v) => ({
        file: toPosix(path.relative(process.cwd(), v.filePath)),
        pattern: v.pattern
      }))
    });
    process.exit(1);
  }

  console.info("AUTH_GUARD_OK", {
    reason: "NO_SUPABASE_METADATA_RUNTIME_REFERENCE"
  });
}

void main();
