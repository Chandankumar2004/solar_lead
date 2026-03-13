import { PrismaClient } from "@prisma/client";
import { lookup } from "node:dns/promises";
import net from "node:net";
import { env } from "../config/env.js";

const DEFAULT_CONNECT_ATTEMPTS = 3;
const DEFAULT_CONNECT_RETRY_DELAY_MS = 1500;
const NETWORK_DIAGNOSTIC_TTL_MS = 30_000;
const TCP_PROBE_TIMEOUT_MS = 4000;

type DatasourceSource = "DATABASE_URL" | "DIRECT_URL";

type PrismaFailureReason =
  | "DATABASE_CONNECTION_FAILED"
  | "AUTH_FAILURE"
  | "DNS_FAILURE"
  | "TCP_TIMEOUT"
  | "CONNECTION_REFUSED"
  | "SSL_MISMATCH";

type PrismaFailure = {
  at: string;
  reason: PrismaFailureReason;
  source: DatasourceSource;
  message: string;
  code: string | null;
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

const rawDatabaseUrl = env.DATABASE_URL.trim();
const rawDirectUrl = env.DIRECT_URL.trim();
const runtimeDatasourceSource: DatasourceSource = "DATABASE_URL";

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
      hasPgbouncer: parsed.searchParams.get("pgbouncer") === "true"
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

const databaseDatasourceSummary = summarizeDatasource(rawDatabaseUrl, "DATABASE_URL");
const directDatasourceSummary = summarizeDatasource(rawDirectUrl, "DIRECT_URL");

console.info("PRISMA_DATASOURCE_SELECTED", databaseDatasourceSummary);
console.info("PRISMA_DATASOURCE_CANDIDATES", {
  DATABASE_URL: databaseDatasourceSummary,
  DIRECT_URL: directDatasourceSummary
});

if (!databaseDatasourceSummary.hasSslMode) {
  console.error("PRISMA_DATASOURCE_CONFIG_ERROR", {
    reason: "DATABASE_URL_SSLMODE_MISSING",
    source: "DATABASE_URL",
    host: databaseDatasourceSummary.host,
    port: databaseDatasourceSummary.port
  });
  throw new Error("DATABASE_URL must include sslmode=require for Supabase.");
}

if (!databaseDatasourceSummary.hasPgbouncer) {
  console.error("PRISMA_DATASOURCE_CONFIG_ERROR", {
    reason: "DATABASE_URL_PGBOUNCER_FLAG_MISSING",
    source: "DATABASE_URL",
    host: databaseDatasourceSummary.host,
    port: databaseDatasourceSummary.port
  });
  throw new Error("DATABASE_URL must include pgbouncer=true when using Supabase pooler.");
}

if (!directDatasourceSummary.hasSslMode) {
  console.error("PRISMA_DATASOURCE_CONFIG_ERROR", {
    reason: "DIRECT_URL_SSLMODE_MISSING",
    source: "DIRECT_URL",
    host: directDatasourceSummary.host,
    port: directDatasourceSummary.port
  });
  throw new Error("DIRECT_URL must include sslmode=require for Supabase.");
}

if ((directDatasourceSummary.host ?? "").toLowerCase().includes("pooler.supabase.com")) {
  console.error("PRISMA_DIRECT_URL_CONFIG_ERROR", {
    reason: "DIRECT_URL_POINTS_TO_POOLER_HOST",
    directHost: directDatasourceSummary.host,
    directPort: directDatasourceSummary.port,
    expectedHostHint: "db.<project-ref>.supabase.co",
    expectedPortHint: "5432"
  });
  throw new Error(
    "DIRECT_URL must point to direct Supabase host (db.<project-ref>.supabase.co:5432), not pooler host."
  );
}

export const prisma = new PrismaClient();

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

function classifyConnectionFailure(
  failure: ReturnType<typeof summarizeConnectionError>,
  runtimeDiagnostic: PrismaNetworkDiagnostic
): PrismaFailureReason {
  const message = failure.message.toLowerCase();
  const code = (failure.code ?? "").toUpperCase();
  const dnsCode = (runtimeDiagnostic.dns.error?.code ?? "").toUpperCase();
  const tcpCode = (runtimeDiagnostic.tcp.error?.code ?? "").toUpperCase();

  if (code === "P1000" || message.includes("authentication failed")) {
    return "AUTH_FAILURE";
  }

  if (dnsCode === "ENOTFOUND" || dnsCode === "EAI_AGAIN") {
    return "DNS_FAILURE";
  }

  if (tcpCode === "ETIMEDOUT") {
    return "TCP_TIMEOUT";
  }

  if (tcpCode === "ECONNREFUSED") {
    return "CONNECTION_REFUSED";
  }

  if (
    message.includes("ssl") ||
    message.includes("tls") ||
    message.includes("certificate") ||
    message.includes("handshake")
  ) {
    return "SSL_MISMATCH";
  }

  return "DATABASE_CONNECTION_FAILED";
}

async function canConnect() {
  const maxAttempts = resolveConnectAttempts();
  const retryDelayMs = resolveConnectRetryDelayMs();
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await prisma.$connect();
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
      }
    });
  }

  const connectionResult = await canConnect();
  if (!connectionResult.ok) {
    const errorSummary = summarizeConnectionError(connectionResult.error);
    const reason = classifyConnectionFailure(errorSummary, runtimeDiagnostic);

    prismaConnected = false;
    prismaLastFailure = {
      at: new Date().toISOString(),
      reason,
      source: connectionResult.source,
      message: errorSummary.message,
      code: errorSummary.code
    };

    if (!quiet) {
      console.error("PRISMA_INIT_ERROR", {
        reason,
        source: connectionResult.source,
        error: errorSummary,
        network: runtimeDiagnostic
      });
    }
    return false;
  }

  prismaConnected = true;
  prismaLastFailure = null;
  return true;
}
