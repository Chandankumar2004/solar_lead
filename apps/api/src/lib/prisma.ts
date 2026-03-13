import { PrismaClient } from "@prisma/client";
import { env } from "../config/env.js";

const DEFAULT_CONNECT_ATTEMPTS = 3;
const DEFAULT_CONNECT_RETRY_DELAY_MS = 1500;
const runtimeDatabaseUrl = (env.DATABASE_URL ?? "").trim();

type PrismaFailure = {
  at: string;
  reason: string;
  source: string | null;
  message: string;
};

function summarizeDatasource(rawUrl: string) {
  try {
    const parsed = new URL(rawUrl);
    return {
      source: "DATABASE_URL" as const,
      host: parsed.hostname,
      port: parsed.port || "5432",
      schema: parsed.searchParams.get("schema") ?? "public"
    };
  } catch {
    return {
      source: "DATABASE_URL" as const,
      host: null,
      port: null,
      schema: null
    };
  }
}

const datasourceSummary = summarizeDatasource(runtimeDatabaseUrl);

console.info("PRISMA_DATASOURCE_SELECTED", datasourceSummary);

export const prisma = new PrismaClient({
  datasources: {
    db: {
      url: runtimeDatabaseUrl
    }
  }
});

let prismaConnected = false;
let prismaLastFailure: PrismaFailure | null = null;

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

async function canConnect() {
  const maxAttempts = resolveConnectAttempts();
  const retryDelayMs = resolveConnectRetryDelayMs();
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { ok: true as const };
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts && retryDelayMs > 0) {
        await sleep(retryDelayMs);
      }
    }
  }

  return {
    ok: false as const,
    source: "DATABASE_URL",
    error: lastError
  };
}

export async function runPrismaStartupChecks(options?: { quiet?: boolean }): Promise<boolean> {
  const quiet = options?.quiet === true;
  const connectionResult = await canConnect();

  if (!connectionResult.ok) {
    const failure = summarizeConnectionError(connectionResult.error);
    prismaConnected = false;
    prismaLastFailure = {
      at: new Date().toISOString(),
      reason: "DATABASE_CONNECTION_FAILED",
      source: connectionResult.source,
      message: failure.message
    };
    if (!quiet) {
      console.error("PRISMA_INIT_ERROR", {
        reason: "DATABASE_CONNECTION_FAILED",
        source: connectionResult.source,
        datasource: datasourceSummary,
        error: failure
      });
    }
    return false;
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
      source: "DATABASE_URL",
      currentSchema: row?.currentSchema ?? null,
      searchPath: row?.searchPath ?? null
    });
  } catch (error) {
    if (!quiet) {
      console.error("DB_METADATA_CHECK_ERROR", {
        reason: "DB_SCHEMA_CONTEXT_READ_FAILED",
        source: "DATABASE_URL",
        error: summarizeConnectionError(error)
      });
    }
  }

  return true;
}
