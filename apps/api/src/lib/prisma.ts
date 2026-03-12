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
      const configuredPort = parsed.port || "6543";
      // Keep caller-selected pooler mode:
      // - 6543 transaction pooler (requires pgbouncer=true)
      // - 5432 session pooler
      if (!parsed.port) {
        parsed.port = configuredPort;
      }
      if (configuredPort === "6543") {
        if (!parsed.searchParams.get("pgbouncer")) {
          parsed.searchParams.set("pgbouncer", "true");
        }
        if (!parsed.searchParams.get("connection_limit")) {
          parsed.searchParams.set("connection_limit", "1");
        }
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
const isHostedRuntime =
  env.NODE_ENV === "production" ||
  process.env.RENDER === "true" ||
  Boolean(process.env.RENDER_EXTERNAL_URL);

type RuntimeCandidate = {
  source: "DATABASE_URL" | "DIRECT_URL";
  rawUrl: string;
  score: number;
};

function scoreRuntimeUrl(rawUrl: string, source: RuntimeCandidate["source"]) {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase();
    const port = parsed.port || "5432";
    const isSupabasePooler = host.endsWith(".pooler.supabase.com");

    // Runtime app traffic should use DATABASE_URL (pooler-first).
    if (source === "DATABASE_URL") {
      if (isSupabasePooler) {
        // Prefer canonical Supabase pooler port for runtime.
        return port === "5432" ? 25 : 30;
      }
      return 20;
    }

    // DIRECT_URL is intended primarily for migrations and acts as runtime fallback only.
    if (source === "DIRECT_URL") {
      if (isSupabasePooler) {
        return 15;
      }
      return isHostedRuntime ? 10 : 12;
    }

    return 0;
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
      score: scoreRuntimeUrl(databaseUrl, "DATABASE_URL")
    });
  }
  const allowDirectAsRuntimeCandidate = Boolean(directUrl) && (!isHostedRuntime || !databaseUrl);
  if (allowDirectAsRuntimeCandidate) {
    candidates.push({
      source: "DIRECT_URL",
      rawUrl: directUrl,
      score: scoreRuntimeUrl(directUrl, "DIRECT_URL")
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
const configuredSessionPoolerFallbackUrl = (process.env.DATABASE_URL_SESSION_FALLBACK ?? "").trim();

function deriveSupabaseSessionPoolerUrl(rawUrl: string) {
  if (!rawUrl.trim()) {
    return "";
  }

  try {
    const parsed = new URL(rawUrl);
    const isPostgres = parsed.protocol === "postgresql:" || parsed.protocol === "postgres:";
    const isSupabasePooler = parsed.hostname.toLowerCase().endsWith(".pooler.supabase.com");
    if (!isPostgres || !isSupabasePooler) {
      return "";
    }

    // Session pooler fallback for environments where transaction pooler connectivity is unstable.
    parsed.port = "5432";
    parsed.searchParams.delete("pgbouncer");
    parsed.searchParams.delete("connection_limit");
    if (!parsed.searchParams.get("sslmode")) {
      parsed.searchParams.set("sslmode", "require");
    }
    if (!parsed.searchParams.get("schema")) {
      parsed.searchParams.set("schema", DEFAULT_APP_DB_SCHEMA);
    }
    return parsed.toString();
  } catch {
    return "";
  }
}

const prismaSessionPoolerDatasourceUrl = normalizePrismaDatasourceUrl(
  configuredSessionPoolerFallbackUrl || deriveSupabaseSessionPoolerUrl(prismaDatasourceUrl)
);

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
  if (rawPrismaUrl && prismaDatasourceUrl && rawPrismaUrl !== prismaDatasourceUrl) {
    console.info("PRISMA_DATASOURCE_NORMALIZED", {
      source: runtimeChoice.primary.source,
      before: summarizeDatasource(rawPrismaUrl),
      after: summarizeDatasource(prismaDatasourceUrl)
    });
  }

  console.info("PRISMA_DATASOURCE_SELECTED", {
    source: runtimeChoice.primary.source,
    ...summarizeDatasource(prismaDatasourceUrl)
  });

  const summary = summarizeDatasource(prismaDatasourceUrl);
  if (
    runtimeChoice.primary.source === "DATABASE_URL" &&
    summary.host?.toLowerCase().endsWith(".pooler.supabase.com") &&
    summary.port === "5432"
  ) {
    console.warn("PRISMA_DATASOURCE_WARNING", {
      reason: "SUPABASE_POOLER_USING_5432",
      recommendedPort: "6543"
    });
  }
}

const primaryPrismaClient = prismaDatasourceUrl
  ? new PrismaClient({
      datasources: {
        db: {
          url: prismaDatasourceUrl
        }
      }
    })
  : new PrismaClient();

const prismaSessionPoolerFallback =
  prismaSessionPoolerDatasourceUrl &&
  prismaSessionPoolerDatasourceUrl !== prismaDatasourceUrl &&
  prismaSessionPoolerDatasourceUrl !== prismaAlternateDatasourceUrl
    ? new PrismaClient({
        datasources: {
          db: {
            url: prismaSessionPoolerDatasourceUrl
          }
        }
      })
    : null;

if (prismaSessionPoolerFallback) {
  console.info("PRISMA_SESSION_FALLBACK_CANDIDATE", {
    source: configuredSessionPoolerFallbackUrl
      ? "DATABASE_URL_SESSION_FALLBACK"
      : "DERIVED_SESSION_POOLER",
    ...summarizeDatasource(prismaSessionPoolerDatasourceUrl)
  });
}

export const prismaAuthFallback =
  prismaAlternateDatasourceUrl && prismaAlternateDatasourceUrl !== prismaDatasourceUrl
    ? new PrismaClient({
        datasources: {
          db: {
            url: prismaAlternateDatasourceUrl
          }
        }
      })
    : primaryPrismaClient;

export let prisma = primaryPrismaClient;

type ConnectionCheck =
  | { ok: true }
  | { ok: false; source: string; error: unknown };

async function canConnect(client: PrismaClient, sourceLabel: string): Promise<ConnectionCheck> {
  try {
    await client.$queryRaw`SELECT 1`;
    return { ok: true };
  } catch (error) {
    return { ok: false, source: sourceLabel, error };
  }
}

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
  const primaryResult = await canConnect(prisma, runtimeChoice.primary?.source ?? "PRIMARY");
  if (!primaryResult.ok) {
    if (prismaSessionPoolerFallback) {
      const sessionFallbackResult = await canConnect(
        prismaSessionPoolerFallback,
        "DATABASE_URL_SESSION_POOLER"
      );
      if (sessionFallbackResult.ok) {
        prisma = prismaSessionPoolerFallback;
        console.warn("PRISMA_FAILOVER_ENABLED", {
          primarySource: primaryResult.source,
          source: "DATABASE_URL_SESSION_POOLER",
          ...summarizeDatasource(prismaSessionPoolerDatasourceUrl)
        });
      } else {
        console.error("PRISMA_SESSION_POOLER_FALLBACK_FAILED", {
          primarySource: primaryResult.source,
          source: sessionFallbackResult.source,
          error: sessionFallbackResult.error
        });
      }
    }

    if (primaryResult.ok || prisma !== primaryPrismaClient) {
      // Primary recovered or fallback already enabled.
    } else if (prismaAuthFallback !== prisma) {
      const fallbackSource = runtimeChoice.alternate?.source ?? "ALTERNATE";
      const fallbackResult = await canConnect(prismaAuthFallback, fallbackSource);
      if (fallbackResult.ok) {
        prisma = prismaAuthFallback;
        console.warn("PRISMA_FAILOVER_ENABLED", {
          primarySource: primaryResult.source,
          source: fallbackSource,
          ...summarizeDatasource(prismaAlternateDatasourceUrl)
        });
      } else {
        console.error("PRISMA_INIT_ERROR", {
          reason: "DATABASE_CONNECTION_FAILED",
          primary: {
            source: primaryResult.source,
            error: primaryResult.error
          },
          fallback: {
            source: fallbackResult.source,
            error: fallbackResult.error
          }
        });
        return;
      }
    } else {
      console.error("PRISMA_INIT_ERROR", {
        reason: "DATABASE_CONNECTION_FAILED",
        source: primaryResult.source,
        error: primaryResult.error
      });
      return;
    }
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
