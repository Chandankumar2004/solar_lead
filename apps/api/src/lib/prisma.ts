import { PrismaClient } from "@prisma/client";
import { lookup } from "node:dns/promises";
import net from "node:net";
import { env } from "../config/env.js";

const DEFAULT_CONNECT_ATTEMPTS = 3;
const DEFAULT_CONNECT_RETRY_DELAY_MS = 1500;
const NETWORK_DIAGNOSTIC_TTL_MS = 30_000;
const TCP_PROBE_TIMEOUT_MS = 4_000;
const rawDatabaseUrl = (env.DATABASE_URL ?? "").trim();
const rawDirectUrl = (env.DIRECT_URL ?? "").trim();

type DatasourceSource = "DATABASE_URL" | "DIRECT_URL";

type PrismaFailure = {
  at: string;
  reason: string;
  source: string | null;
  message: string;
};

type NetworkErrorSummary = {
  code: string | null;
  name: string;
  message: string;
};

type PrismaNetworkDiagnostic = {
  at: string;
  source: DatasourceSource;
  host: string | null;
  port: number | null;
  dns: {
    ok: boolean;
    addresses: Array<{ address: string; family: number }>;
    error: NetworkErrorSummary | null;
  };
  tcp: {
    ok: boolean;
    remoteAddress: string | null;
    remoteFamily: string | null;
    error: NetworkErrorSummary | null;
  };
};

type DatasourceSummary = {
  source: DatasourceSource;
  host: string | null;
  port: string | null;
  database: string | null;
  schema: string | null;
  hasSslMode: boolean;
  hasPgbouncer: boolean;
};

function isTruthyEnv(value: string | undefined) {
  if (typeof value !== "string") {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function ensureSslModeRequire(rawUrl: string, source: DatasourceSource) {
  if (!rawUrl) {
    return rawUrl;
  }

  try {
    const parsed = new URL(rawUrl);
    if (parsed.searchParams.has("sslmode")) {
      return rawUrl;
    }

    parsed.searchParams.set("sslmode", "require");
    const normalized = parsed.toString();
    console.warn("PRISMA_DATASOURCE_SSLMODE_NORMALIZED", {
      source,
      host: parsed.hostname,
      port: parsed.port || "5432",
      reason: "ADDED_SSLMODE_REQUIRE"
    });
    return normalized;
  } catch {
    return rawUrl;
  }
}

function logNetworkDiagnostic(diagnostic: PrismaNetworkDiagnostic) {
  console.info("PRISMA_NETWORK_DNS", {
    source: diagnostic.source,
    host: diagnostic.host,
    ok: diagnostic.dns.ok,
    addresses: diagnostic.dns.addresses,
    error: diagnostic.dns.error
  });
  console.info("PRISMA_NETWORK_TCP", {
    source: diagnostic.source,
    host: diagnostic.host,
    port: diagnostic.port,
    ok: diagnostic.tcp.ok,
    remoteAddress: diagnostic.tcp.remoteAddress,
    remoteFamily: diagnostic.tcp.remoteFamily,
    error: diagnostic.tcp.error
  });
}

function summarizeDatasource(rawUrl: string, source: DatasourceSource): DatasourceSummary {
  try {
    const parsed = new URL(rawUrl);
    const database = decodeURIComponent(parsed.pathname.replace(/^\/+/, "")) || null;
    return {
      source,
      host: parsed.hostname,
      port: parsed.port || "5432",
      database,
      schema: parsed.searchParams.get("schema") ?? "public",
      hasSslMode: parsed.searchParams.has("sslmode"),
      hasPgbouncer: parsed.searchParams.has("pgbouncer")
    };
  } catch {
    return {
      source,
      host: null,
      port: null,
      database: null,
      schema: null,
      hasSslMode: false,
      hasPgbouncer: false
    };
  }
}

const runtimeDatabaseUrl = ensureSslModeRequire(rawDatabaseUrl, "DATABASE_URL");
const runtimeDirectUrl = rawDirectUrl;

const databaseDatasourceSummary = summarizeDatasource(runtimeDatabaseUrl, "DATABASE_URL");
const directDatasourceSummary = summarizeDatasource(runtimeDirectUrl, "DIRECT_URL");
const useDirectRuntime = isTruthyEnv(process.env.PRISMA_RUNTIME_USE_DIRECT_URL) && Boolean(runtimeDirectUrl);
const runtimeDatasourceSource: DatasourceSource = useDirectRuntime ? "DIRECT_URL" : "DATABASE_URL";
const runtimeDatasourceUrl = useDirectRuntime ? runtimeDirectUrl : runtimeDatabaseUrl;
const runtimeDatasourceSummary =
  runtimeDatasourceSource === "DIRECT_URL" ? directDatasourceSummary : databaseDatasourceSummary;

console.info("PRISMA_DATASOURCE_SELECTED", {
  ...runtimeDatasourceSummary,
  hasDirectUrl: Boolean(runtimeDirectUrl),
  runtimeSource: runtimeDatasourceSource
});
console.info("PRISMA_DATASOURCE_CANDIDATES", {
  DATABASE_URL: databaseDatasourceSummary,
  DIRECT_URL: directDatasourceSummary
});

if ((directDatasourceSummary.host ?? "").toLowerCase().includes("pooler.supabase.com")) {
  console.error("PRISMA_DIRECT_URL_CONFIG_ERROR", {
    reason: "DIRECT_URL_POINTS_TO_POOLER_HOST",
    directHost: directDatasourceSummary.host,
    directPort: directDatasourceSummary.port,
    expectedHostHint: "db.onblngbhnigulspucvwg.supabase.co",
    expectedPortHint: "5432"
  });
}

export const prisma = new PrismaClient({
  datasources: {
    db: {
      url: runtimeDatasourceUrl
    }
  }
});

let prismaConnected = false;
let prismaLastFailure: PrismaFailure | null = null;
let prismaLastNetworkDiagnostic: PrismaNetworkDiagnostic | null = null;
const prismaLastNetworkDiagnostics: Record<DatasourceSource, PrismaNetworkDiagnostic | null> = {
  DATABASE_URL: null,
  DIRECT_URL: null
};
const prismaLastNetworkDiagnosticAtBySource: Record<DatasourceSource, number> = {
  DATABASE_URL: 0,
  DIRECT_URL: 0
};

export function isPrismaConnected() {
  return prismaConnected;
}

export function getPrismaConnectionState() {
  return {
    connected: prismaConnected,
    lastFailure: prismaLastFailure,
    networkDiagnostic: prismaLastNetworkDiagnostic,
    networkDiagnostics: prismaLastNetworkDiagnostics,
    runtimeSource: runtimeDatasourceSource
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

function summarizeNetworkError(error: unknown): NetworkErrorSummary {
  if (error && typeof error === "object") {
    const maybe = error as { name?: unknown; message?: unknown; code?: unknown };
    return {
      code: typeof maybe.code === "string" ? maybe.code : null,
      name: typeof maybe.name === "string" ? maybe.name : "Error",
      message: typeof maybe.message === "string" ? maybe.message : "Unknown network error"
    };
  }
  return {
    code: null,
    name: "Error",
    message: typeof error === "string" ? error : "Unknown network error"
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

function parsePort(rawPort: string | null) {
  if (!rawPort) {
    return null;
  }
  const parsed = Number(rawPort);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65_535) {
    return null;
  }
  return Math.floor(parsed);
}

async function runDnsAndTcpDiagnostic(
  source: DatasourceSource,
  datasourceSummary: DatasourceSummary,
  options?: { quiet?: boolean; force?: boolean }
) {
  const quiet = options?.quiet === true;
  const force = options?.force === true;
  const now = Date.now();

  const cachedDiagnostic = prismaLastNetworkDiagnostics[source];
  const cachedAt = prismaLastNetworkDiagnosticAtBySource[source];
  if (!force && cachedDiagnostic && now - cachedAt < NETWORK_DIAGNOSTIC_TTL_MS) {
    if (!quiet) {
      logNetworkDiagnostic(cachedDiagnostic);
    }
    return cachedDiagnostic;
  }

  const host = datasourceSummary.host;
  const port = parsePort(datasourceSummary.port);

  const dnsResult: PrismaNetworkDiagnostic["dns"] = {
    ok: false,
    addresses: [],
    error: null
  };
  const tcpResult: PrismaNetworkDiagnostic["tcp"] = {
    ok: false,
    remoteAddress: null,
    remoteFamily: null,
    error: null
  };

  if (host) {
    try {
      const addresses = await lookup(host, { all: true, verbatim: true });
      dnsResult.ok = addresses.length > 0;
      dnsResult.addresses = addresses.map((entry) => ({
        address: entry.address,
        family: entry.family
      }));
    } catch (error) {
      dnsResult.error = summarizeNetworkError(error);
    }
  } else {
    dnsResult.error = {
      code: "EINVALIDHOST",
      name: "InvalidHost",
      message: `No database host found in ${source}`
    };
  }

  if (host && port) {
    const tcpProbe = await new Promise<PrismaNetworkDiagnostic["tcp"]>((resolve) => {
      const socket = net.createConnection({ host, port });
      let settled = false;

      const finish = (payload: PrismaNetworkDiagnostic["tcp"]) => {
        if (settled) {
          return;
        }
        settled = true;
        socket.destroy();
        resolve(payload);
      };

      socket.setTimeout(TCP_PROBE_TIMEOUT_MS);
      socket.once("connect", () => {
        finish({
          ok: true,
          remoteAddress: socket.remoteAddress ?? null,
          remoteFamily: socket.remoteFamily ?? null,
          error: null
        });
      });
      socket.once("timeout", () => {
        finish({
          ok: false,
          remoteAddress: null,
          remoteFamily: null,
          error: {
            code: "ETIMEDOUT",
            name: "TimeoutError",
            message: `TCP probe timed out after ${TCP_PROBE_TIMEOUT_MS}ms`
          }
        });
      });
      socket.once("error", (error) => {
        finish({
          ok: false,
          remoteAddress: null,
          remoteFamily: null,
          error: summarizeNetworkError(error)
        });
      });
    });

    tcpResult.ok = tcpProbe.ok;
    tcpResult.remoteAddress = tcpProbe.remoteAddress;
    tcpResult.remoteFamily = tcpProbe.remoteFamily;
    tcpResult.error = tcpProbe.error;
  } else {
    tcpResult.error = {
      code: "EINVALIDPORT",
      name: "InvalidPort",
      message: `No valid database port found in ${source}`
    };
  }

  const diagnostic: PrismaNetworkDiagnostic = {
    at: new Date().toISOString(),
    source,
    host,
    port,
    dns: dnsResult,
    tcp: tcpResult
  };
  prismaLastNetworkDiagnostics[source] = diagnostic;
  prismaLastNetworkDiagnosticAtBySource[source] = now;
  if (source === runtimeDatasourceSource) {
    prismaLastNetworkDiagnostic = diagnostic;
  }

  if (!quiet) {
    logNetworkDiagnostic(diagnostic);
  }

  return diagnostic;
}

async function runAllDatasourceDiagnostics(options?: { quiet?: boolean; force?: boolean }) {
  const databaseDiagnostic = await runDnsAndTcpDiagnostic("DATABASE_URL", databaseDatasourceSummary, options);
  const directDiagnostic = await runDnsAndTcpDiagnostic("DIRECT_URL", directDatasourceSummary, options);
  return {
    DATABASE_URL: databaseDiagnostic,
    DIRECT_URL: directDiagnostic
  } as const;
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
    source: runtimeDatasourceSource,
    error: lastError
  };
}

export async function runPrismaStartupChecks(options?: { quiet?: boolean }): Promise<boolean> {
  const quiet = options?.quiet === true;
  const diagnostics = await runAllDatasourceDiagnostics({ quiet, force: !quiet });
  const runtimeDiagnostic = diagnostics[runtimeDatasourceSource];
  prismaLastNetworkDiagnostic = runtimeDiagnostic;

  if (!quiet) {
    console.info("PRISMA_NETWORK_COMPARISON", {
      DATABASE_URL: {
        host: diagnostics.DATABASE_URL.host,
        port: diagnostics.DATABASE_URL.port,
        dnsOk: diagnostics.DATABASE_URL.dns.ok,
        tcpOk: diagnostics.DATABASE_URL.tcp.ok,
        tcpErrorCode: diagnostics.DATABASE_URL.tcp.error?.code ?? null
      },
      DIRECT_URL: {
        host: diagnostics.DIRECT_URL.host,
        port: diagnostics.DIRECT_URL.port,
        dnsOk: diagnostics.DIRECT_URL.dns.ok,
        tcpOk: diagnostics.DIRECT_URL.tcp.ok,
        tcpErrorCode: diagnostics.DIRECT_URL.tcp.error?.code ?? null
      },
      runtimeSource: runtimeDatasourceSource
    });
  }

  if (!quiet && runtimeDiagnostic.dns.ok && !runtimeDiagnostic.tcp.ok) {
    console.error("PRISMA_NETWORK_REACHABILITY_ERROR", {
      reason: "DNS_RESOLVES_BUT_TCP_CONNECT_FAILS",
      source: runtimeDatasourceSource,
      host: runtimeDiagnostic.host,
      port: runtimeDiagnostic.port,
      dnsAddresses: runtimeDiagnostic.dns.addresses,
      tcpError: runtimeDiagnostic.tcp.error
    });
  }

  if (
    !quiet &&
    runtimeDatasourceSource === "DATABASE_URL" &&
    !diagnostics.DATABASE_URL.tcp.ok &&
    diagnostics.DIRECT_URL.tcp.ok
  ) {
    console.warn("PRISMA_RUNTIME_SWITCH_AVAILABLE", {
      reason: "POOLER_UNREACHABLE_BUT_DIRECT_REACHABLE",
      currentRuntimeSource: runtimeDatasourceSource,
      recommendedRuntimeSource: "DIRECT_URL",
      enableWith: "PRISMA_RUNTIME_USE_DIRECT_URL=true"
    });
  }

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
        datasource: runtimeDatasourceSummary,
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
      source: runtimeDatasourceSource,
      currentSchema: row?.currentSchema ?? null,
      searchPath: row?.searchPath ?? null
    });
  } catch (error) {
    if (!quiet) {
      console.error("DB_METADATA_CHECK_ERROR", {
        reason: "DB_SCHEMA_CONTEXT_READ_FAILED",
        source: runtimeDatasourceSource,
        error: summarizeConnectionError(error)
      });
    }
  }

  return true;
}
