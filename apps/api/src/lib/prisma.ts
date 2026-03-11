import { PrismaClient } from "@prisma/client";
import { env } from "../config/env.js";

const DEFAULT_APP_DB_SCHEMA = "public";

function normalizeOptionsParam(rawOptions: string) {
  const options = rawOptions.trim();
  if (!options) {
    return options;
  }

  // Normalize common search_path flags if present in connection options.
  const searchPathPattern = /search_path\s*=\s*([^\s,]+)/gi;
  if (searchPathPattern.test(options)) {
    return options.replace(searchPathPattern, `search_path=${DEFAULT_APP_DB_SCHEMA}`);
  }

  return options;
}

function normalizePrismaDatasourceUrl(rawUrl: string) {
  if (!rawUrl.trim()) {
    return rawUrl;
  }

  try {
    const parsed = new URL(rawUrl);
    const isPostgres = parsed.protocol === "postgresql:" || parsed.protocol === "postgres:";
    if (!isPostgres) {
      return rawUrl;
    }

    const isSupabasePooler = parsed.hostname.toLowerCase().endsWith(".pooler.supabase.com");
    if (isSupabasePooler) {
      if (!parsed.searchParams.get("pgbouncer")) {
        parsed.searchParams.set("pgbouncer", "true");
      }
      if (!parsed.searchParams.get("connection_limit")) {
        parsed.searchParams.set("connection_limit", "1");
      }
      if (!parsed.searchParams.get("sslmode")) {
        parsed.searchParams.set("sslmode", "require");
      }
    }

    const configuredSchema = (parsed.searchParams.get("schema") ?? "").trim();
    if (!configuredSchema) {
      parsed.searchParams.set("schema", DEFAULT_APP_DB_SCHEMA);
    } else if (configuredSchema.toLowerCase() !== DEFAULT_APP_DB_SCHEMA) {
      parsed.searchParams.set("schema", DEFAULT_APP_DB_SCHEMA);
    }

    const configuredCurrentSchema = (parsed.searchParams.get("currentSchema") ?? "").trim();
    if (configuredCurrentSchema && configuredCurrentSchema.toLowerCase() !== DEFAULT_APP_DB_SCHEMA) {
      parsed.searchParams.set("currentSchema", DEFAULT_APP_DB_SCHEMA);
    }

    const rawOptions = parsed.searchParams.get("options");
    if (rawOptions) {
      const normalizedOptions = normalizeOptionsParam(rawOptions);
      if (normalizedOptions !== rawOptions) {
        parsed.searchParams.set("options", normalizedOptions);
      }
    }

    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

const runtimeDatabaseUrl = (env.DATABASE_URL ?? "").trim();
const runtimeDirectUrl = (env.DIRECT_URL ?? "").trim();

type RuntimeCandidate = {
  source: "DATABASE_URL" | "DIRECT_URL";
  rawUrl: string;
  score: number;
};

function scoreRuntimeUrl(rawUrl: string) {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase();
    // Prefer Supabase pooler endpoints in hosted environments.
    if (host.endsWith(".pooler.supabase.com")) {
      return 2;
    }
    return 1;
  } catch {
    return 0;
  }
}

function pickRuntimeCandidates(databaseUrl: string, directUrl: string) {
  const candidates: RuntimeCandidate[] = [];
  if (databaseUrl) {
    candidates.push({
      source: "DATABASE_URL",
      rawUrl: databaseUrl,
      score: scoreRuntimeUrl(databaseUrl)
    });
  }
  if (directUrl) {
    candidates.push({
      source: "DIRECT_URL",
      rawUrl: directUrl,
      score: scoreRuntimeUrl(directUrl)
    });
  }
  if (candidates.length === 0) {
    return { primary: null, alternate: null };
  }

  candidates.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    // Stable preference: DATABASE_URL before DIRECT_URL when equal.
    if (a.source === b.source) {
      return 0;
    }
    return a.source === "DATABASE_URL" ? -1 : 1;
  });

  return {
    primary: candidates[0] ?? null,
    alternate: candidates[1] ?? null
  };
}

const runtimeChoice = pickRuntimeCandidates(runtimeDatabaseUrl, runtimeDirectUrl);
const rawPrismaUrl = runtimeChoice.primary?.rawUrl ?? "";
const prismaDatasourceUrl = normalizePrismaDatasourceUrl(rawPrismaUrl);
const alternateRawPrismaUrl = runtimeChoice.alternate?.rawUrl ?? "";
const prismaAlternateDatasourceUrl = normalizePrismaDatasourceUrl(alternateRawPrismaUrl);

function summarizeDatasource(rawUrl: string) {
  try {
    const parsed = new URL(rawUrl);
    return {
      host: parsed.hostname,
      port: parsed.port || "5432",
      schema: parsed.searchParams.get("schema") ?? null,
      pgbouncer: parsed.searchParams.get("pgbouncer") ?? null
    };
  } catch {
    return {
      host: null,
      port: null,
      schema: null,
      pgbouncer: null
    };
  }
}

if (runtimeChoice.primary) {
  console.info("PRISMA_DATASOURCE_SELECTED", {
    source: runtimeChoice.primary.source,
    ...summarizeDatasource(prismaDatasourceUrl)
  });
}

export const prisma = prismaDatasourceUrl
  ? new PrismaClient({
      datasources: {
        db: {
          url: prismaDatasourceUrl
        }
      }
    })
  : new PrismaClient();

export const prismaAuthFallback =
  prismaAlternateDatasourceUrl && prismaAlternateDatasourceUrl !== prismaDatasourceUrl
    ? new PrismaClient({
        datasources: {
          db: {
            url: prismaAlternateDatasourceUrl
          }
        }
      })
    : prisma;

async function checkAppUserTable() {
  try {
    const rows = await prisma.$queryRaw<Array<{ users: string | null; user: string | null }>>`
      SELECT
        to_regclass('public.users')::text AS users,
        to_regclass('public."User"')::text AS "user"
    `;
    const hasUsers = Boolean(rows[0]?.users);
    const hasUser = Boolean(rows[0]?.user);
    if (!hasUsers && !hasUser) {
      console.error("PRISMA_INIT_ERROR", {
        reason: "APP_USER_TABLE_NOT_FOUND",
        expectedTables: ["public.users", "public.\"User\""]
      });
    }
  } catch (error) {
    console.error("PRISMA_INIT_ERROR", {
      reason: "APP_TABLE_METADATA_CHECK_FAILED",
      error
    });
  }
}

export async function runPrismaStartupChecks() {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (error) {
    console.error("PRISMA_INIT_ERROR", {
      reason: "DATABASE_CONNECTION_FAILED",
      error
    });
    return;
  }

  try {
    const rows = await prisma.$queryRaw<
      Array<{
        currentSchema: string | null;
        searchPath: string | null;
      }>
    >`
      SELECT
        current_schema()::text AS "currentSchema",
        current_setting('search_path', true)::text AS "searchPath"
    `;
    const row = rows[0] ?? null;
    console.info("DB_SCHEMA_CONTEXT", {
      currentSchema: row?.currentSchema ?? null,
      searchPath: row?.searchPath ?? null
    });
  } catch (error) {
    console.error("DB_METADATA_CHECK_ERROR", {
      reason: "DB_SCHEMA_CONTEXT_READ_FAILED",
      error
    });
  }

  await checkAppUserTable();
}
