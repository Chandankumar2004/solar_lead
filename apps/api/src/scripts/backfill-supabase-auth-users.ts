import dotenv from "dotenv";
import { prisma } from "../lib/prisma.js";
import { ensureSupabaseAuthUserForAppUser } from "../services/supabase-auth.service.js";

dotenv.config();

type CliOptions = {
  dryRun: boolean;
  limit: number | null;
};

type BackfillUser = {
  id: string;
  email: string;
  fullName: string;
  passwordHash: string;
};

type Summary = {
  scanned: number;
  created: number;
  existing: number;
  wouldCreate: number;
  failed: number;
};

const BATCH_SIZE = 100;
const MAX_FAILURE_EXAMPLES = 20;

function parseCliOptions(argv: string[]): CliOptions {
  const args = new Set(argv);
  const dryRun = args.has("--dry-run");

  let limit: number | null = null;
  for (const arg of argv) {
    if (!arg.startsWith("--limit=")) {
      continue;
    }
    const parsed = Number(arg.slice("--limit=".length));
    if (Number.isFinite(parsed) && parsed > 0) {
      limit = Math.floor(parsed);
    }
  }

  return { dryRun, limit };
}

async function loadUserBatch(cursorId: string | null, take: number) {
  return prisma.user.findMany({
    take,
    ...(cursorId
      ? {
          skip: 1,
          cursor: { id: cursorId }
        }
      : {}),
    orderBy: { id: "asc" },
    select: {
      id: true,
      email: true,
      fullName: true,
      passwordHash: true
    }
  });
}

function usage() {
  console.info("Usage: pnpm --filter @solar/api auth:backfill-supabase -- [--dry-run] [--limit=N]");
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    usage();
    return;
  }

  const options = parseCliOptions(args);
  const summary: Summary = {
    scanned: 0,
    created: 0,
    existing: 0,
    wouldCreate: 0,
    failed: 0
  };
  const failures: Array<{ userId: string; email: string; reason: string; message: string }> = [];

  console.info("SUPABASE_AUTH_BACKFILL_START", {
    dryRun: options.dryRun,
    limit: options.limit
  });

  let cursorId: string | null = null;
  let completed = false;

  while (!completed) {
    const remaining =
      options.limit === null ? BATCH_SIZE : Math.max(0, options.limit - summary.scanned);
    if (remaining <= 0) {
      break;
    }

    const users = await loadUserBatch(cursorId, Math.min(BATCH_SIZE, remaining));
    if (users.length === 0) {
      break;
    }

    for (const user of users as BackfillUser[]) {
      summary.scanned += 1;

      if (options.dryRun) {
        const lookup = await ensureSupabaseAuthUserForAppUser({
          appUserId: user.id,
          email: user.email,
          fullName: user.fullName,
          createIfMissing: false,
          syncExisting: false
        });

        if (lookup.ok) {
          summary.existing += 1;
        } else if (lookup.reason === "NOT_FOUND") {
          summary.wouldCreate += 1;
        } else {
          summary.failed += 1;
          if (failures.length < MAX_FAILURE_EXAMPLES) {
            failures.push({
              userId: user.id,
              email: user.email,
              reason: lookup.reason,
              message: lookup.message
            });
          }
        }
      } else {
        const synced = await ensureSupabaseAuthUserForAppUser({
          appUserId: user.id,
          email: user.email,
          fullName: user.fullName,
          passwordHash: user.passwordHash,
          createIfMissing: true,
          syncExisting: true
        });

        if (synced.ok) {
          if (synced.created) {
            summary.created += 1;
          } else {
            summary.existing += 1;
          }
        } else {
          summary.failed += 1;
          if (failures.length < MAX_FAILURE_EXAMPLES) {
            failures.push({
              userId: user.id,
              email: user.email,
              reason: synced.reason,
              message: synced.message
            });
          }
        }
      }

      if (options.limit !== null && summary.scanned >= options.limit) {
        completed = true;
        break;
      }
    }

    cursorId = users[users.length - 1]?.id ?? null;
  }

  console.info("SUPABASE_AUTH_BACKFILL_SUMMARY", summary);
  if (failures.length > 0) {
    console.error("SUPABASE_AUTH_BACKFILL_FAILURES", failures);
  }

  if (summary.failed > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error("SUPABASE_AUTH_BACKFILL_FATAL", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
