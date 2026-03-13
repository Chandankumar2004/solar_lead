import { PrismaClient } from "@prisma/client";
import { env } from "../config/env.js";

const DEFAULT_APP_DB_SCHEMA = "public";
const DEFAULT_CONNECT_TIMEOUT_SECONDS = "15";
const DEFAULT_POOL_TIMEOUT_SECONDS = "30";
const DEFAULT_CONNECT_ATTEMPTS = 3;
const DEFAULT_CONNECT_RETRY_DELAY_MS = 1500;

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

    const host = parsed.hostname.toLowerCase();
    const isSupabasePooler = host.endsWith(".pooler.supabase.com");
    const isSupabaseDirect = host.startsWith("db.") && host.endsWith(".supabase.co");
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
      } else {
        parsed.searchParams.delete("pgbouncer");
        parsed.searchParams.delete("connection_limit");
      }
    }

    if ((isSupabasePooler || isSupabaseDirect) && !parsed.searchParams.get("sslmode")) {
      parsed.searchParams.set("sslmode", "require");
    }
    if (!parsed.searchParams.get("connect_timeout")) {
      parsed.searchParams.set("connect_timeout", DEFAULT_CONNECT_TIMEOUT_SECONDS);
    }
    if (!parsed.searchParams.get("pool_timeout")) {
      parsed.searchParams.set("pool_timeout", DEFAULT_POOL_TIMEOUT_SECONDS);
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
  priority: number;
};

function expandSupabasePoolerVariants(rawUrl: string) {
  const results = new Set<string>();
  if (!rawUrl.trim()) {
    return [];
  }

  results.add(rawUrl);

  try {
    const parsed = new URL(rawUrl);
    const isPostgres = parsed.protocol === "postgresql:" || parsed.protocol === "postgres:";
    if (!isPostgres) {
      return Array.from(results);
    }

    const match = parsed.hostname.toLowerCase().match(/^aws-(\d+)-([a-z0-9-]+)\.pooler\.supabase\.com$/);
    if (!match) {
      return Array.from(results);
    }

    const portVariants = new Set<string>([parsed.port || "5432"]);
    portVariants.add("5432");
    portVariants.add("6543");

    for (const port of portVariants) {
      const variant = new URL(rawUrl);
      variant.port = port;

      if (port === "6543") {
        if (!variant.searchParams.get("pgbouncer")) {
          variant.searchParams.set("pgbouncer", "true");
        }
        if (!variant.searchParams.get("connection_limit")) {
          variant.searchParams.set("connection_limit", "1");
        }
      } else {
        variant.searchParams.delete("pgbouncer");
        variant.searchParams.delete("connection_limit");
      }

      if (!variant.searchParams.get("sslmode")) {
        variant.searchParams.set("sslmode", "require");
      }

      results.add(variant.toString());
    }
  } catch {
    // Keep original URL only.
  }

  return Array.from(results);
}

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
  let priority = 0;
  if (databaseUrl) {
    for (const url of expandSupabasePoolerVariants(databaseUrl)) {
      candidates.push({
        source: "DATABASE_URL",
        rawUrl: url,
        score: scoreRuntimeUrl(url, "DATABASE_URL"),
        priority: priority++
      });
    }
  }
  // Keep DATABASE_URL as primary for runtime, but always keep DIRECT_URL as an alternate
  // candidate when it is provided and different. This allows automatic failover when
  // pooler connectivity is unstable in hosted environments.
  const allowDirectAsRuntimeCandidate = Boolean(directUrl) && directUrl !== databaseUrl;
  if (allowDirectAsRuntimeCandidate) {
    for (const url of expandSupabasePoolerVariants(directUrl)) {
      candidates.push({
        source: "DIRECT_URL",
        rawUrl: url,
        score: scoreRuntimeUrl(url, "DIRECT_URL"),
        priority: priority++
      });
    }
  }
  if (candidates.length === 0) {
    return { primary: null, alternates: [] as RuntimeCandidate[] };
  }

  candidates.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    // Stable preference: DATABASE_URL before DIRECT_URL when equal.
    if (a.source === b.source) {
      return a.priority - b.priority;
    }
    return a.source === "DATABASE_URL" ? -1 : 1;
  });

  return {
    primary: candidates[0] ?? null,
    alternates: candidates.slice(1)
  };
}

const runtimeChoice = pickRuntimeCandidates(runtimeDatabaseUrl, runtimeDirectUrl);
const rawPrismaUrl = runtimeChoice.primary?.rawUrl ?? "";
const prismaDatasourceUrl = normalizePrismaDatasourceUrl(rawPrismaUrl);
const runtimeAlternateCandidates = runtimeChoice.alternates
  .map((candidate) => ({
    source: candidate.source,
    rawUrl: candidate.rawUrl,
    normalizedUrl: normalizePrismaDatasourceUrl(candidate.rawUrl)
  }))
  .filter((candidate) => Boolean(candidate.normalizedUrl))
  .filter((candidate) => candidate.normalizedUrl !== prismaDatasourceUrl)
  .filter(
    (candidate, index, all) =>
      all.findIndex((entry) => entry.normalizedUrl === candidate.normalizedUrl) === index
  );

const prismaAlternateDatasourceUrl = runtimeAlternateCandidates[0]?.normalizedUrl ?? "";
const configuredSessionPoolerFallbackUrl = (process.env.DATABASE_URL_SESSION_FALLBACK ?? "").trim();
const normalizedConfiguredSessionPoolerFallbackUrl =
  deriveSupabaseSessionPoolerUrl(configuredSessionPoolerFallbackUrl) ||
  configuredSessionPoolerFallbackUrl;
const sessionPoolerFallbackWasNormalized =
  Boolean(configuredSessionPoolerFallbackUrl) &&
  configuredSessionPoolerFallbackUrl !== normalizedConfiguredSessionPoolerFallbackUrl;

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
  normalizedConfiguredSessionPoolerFallbackUrl || deriveSupabaseSessionPoolerUrl(prismaDatasourceUrl)
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

if (sessionPoolerFallbackWasNormalized) {
  console.info("PRISMA_SESSION_FALLBACK_NORMALIZED", {
    before: summarizeDatasource(configuredSessionPoolerFallbackUrl),
    after: summarizeDatasource(normalizedConfiguredSessionPoolerFallbackUrl)
  });
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
  !runtimeAlternateCandidates.some(
    (candidate) => candidate.normalizedUrl === prismaSessionPoolerDatasourceUrl
  )
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

const prismaAlternateFallbacks = runtimeAlternateCandidates.map((candidate) => ({
  source: candidate.source,
  normalizedUrl: candidate.normalizedUrl,
  client:
    candidate.normalizedUrl === prismaAlternateDatasourceUrl && prismaAuthFallback !== primaryPrismaClient
      ? prismaAuthFallback
      : new PrismaClient({
          datasources: {
            db: {
              url: candidate.normalizedUrl
            }
          }
        })
}));

export let prisma = primaryPrismaClient;
let prismaConnected = false;
let prismaLastFailure:
  | {
      at: string;
      reason: string;
      source: string | null;
      message: string;
    }
  | null = null;

export function isPrismaConnected() {
  return prismaConnected;
}

export function getPrismaConnectionState() {
  return {
    connected: prismaConnected,
    lastFailure: prismaLastFailure
  };
}

function summarizeConnectionError(error: unknown) {
  if (error && typeof error === "object") {
    const maybe = error as { name?: unknown; message?: unknown; code?: unknown };
    const name = typeof maybe.name === "string" ? maybe.name : "Error";
    const message = typeof maybe.message === "string" ? maybe.message : "Unknown connection error";
    const code = typeof maybe.code === "string" ? maybe.code : null;
    return { name, message, code };
  }
  return {
    name: "Error",
    message: typeof error === "string" ? error : "Unknown connection error",
    code: null
  };
}

type ConnectionCheck =
  | { ok: true }
  | { ok: false; source: string; error: unknown };

function resolveConnectAttempts() {
  const raw = Number(process.env.PRISMA_CONNECT_ATTEMPTS ?? "");
  if (Number.isFinite(raw) && raw >= 1 && raw <= 10) {
    return Math.floor(raw);
  }
  return DEFAULT_CONNECT_ATTEMPTS;
}

function resolveConnectRetryDelayMs() {
  const raw = Number(process.env.PRISMA_CONNECT_RETRY_DELAY_MS ?? "");
  if (Number.isFinite(raw) && raw >= 0 && raw <= 60_000) {
    return Math.floor(raw);
  }
  return DEFAULT_CONNECT_RETRY_DELAY_MS;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function canConnect(client: PrismaClient, sourceLabel: string): Promise<ConnectionCheck> {
  const maxAttempts = resolveConnectAttempts();
  const retryDelayMs = resolveConnectRetryDelayMs();
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await client.$queryRaw`SELECT 1`;
      return { ok: true };
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts && retryDelayMs > 0) {
        await sleep(retryDelayMs);
      }
    }
  }

  return { ok: false, source: sourceLabel, error: lastError };
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

export async function runPrismaStartupChecks(options?: { quiet?: boolean }): Promise<boolean> {
  const quiet = options?.quiet === true;
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
        if (!quiet) {
          console.error("PRISMA_SESSION_POOLER_FALLBACK_FAILED", {
            primarySource: primaryResult.source,
            source: sessionFallbackResult.source,
            error: summarizeConnectionError(sessionFallbackResult.error)
          });
        }
      }
    }

    if (primaryResult.ok || prisma !== primaryPrismaClient) {
      // Primary recovered or fallback already enabled.
    } else if (prismaAlternateFallbacks.length > 0) {
      let connectedFallback: (typeof prismaAlternateFallbacks)[number] | null = null;
      let lastFallbackResult: ConnectionCheck | null = null;
      const attemptedFallbacks: Array<{
        source: string;
        host: string | null;
        port: string | null;
        schema: string | null;
        pgbouncer: string | null;
        error: ReturnType<typeof summarizeConnectionError>;
      }> = [];

      for (const fallback of prismaAlternateFallbacks) {
        if (fallback.client === prisma) {
          continue;
        }

        const fallbackResult = await canConnect(fallback.client, fallback.source);
        if (fallbackResult.ok) {
          connectedFallback = fallback;
          break;
        }
        lastFallbackResult = fallbackResult;
        attemptedFallbacks.push({
          source: fallback.source,
          ...summarizeDatasource(fallback.normalizedUrl),
          error: summarizeConnectionError(fallbackResult.error)
        });
      }

      if (connectedFallback) {
        prisma = connectedFallback.client;
        console.warn("PRISMA_FAILOVER_ENABLED", {
          primarySource: primaryResult.source,
          source: connectedFallback.source,
          ...summarizeDatasource(connectedFallback.normalizedUrl)
        });
      } else {
        prismaConnected = false;
        prismaLastFailure = {
          at: new Date().toISOString(),
          reason: "DATABASE_CONNECTION_FAILED",
          source: primaryResult.source,
          message: summarizeConnectionError(primaryResult.error).message
        };
        if (!quiet) {
          console.error("PRISMA_INIT_ERROR", {
            reason: "DATABASE_CONNECTION_FAILED",
            primary: {
              source: primaryResult.source,
              error: summarizeConnectionError(primaryResult.error)
            },
            fallback: lastFallbackResult
              ? {
                  source: lastFallbackResult.source,
                  error: summarizeConnectionError(lastFallbackResult.error)
                }
              : null,
            attemptedFallbacks
          });
        }
        return false;
      }
    } else {
      prismaConnected = false;
      prismaLastFailure = {
        at: new Date().toISOString(),
        reason: "DATABASE_CONNECTION_FAILED",
        source: primaryResult.source,
        message: summarizeConnectionError(primaryResult.error).message
      };
      if (!quiet) {
        console.error("PRISMA_INIT_ERROR", {
          reason: "DATABASE_CONNECTION_FAILED",
          source: primaryResult.source,
          error: summarizeConnectionError(primaryResult.error)
        });
      }
      return false;
    }
  }

  prismaConnected = true;
  prismaLastFailure = null;

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
  return true;
}
