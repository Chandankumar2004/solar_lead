import { PrismaClient } from "@prisma/client";
import { lookup } from "node:dns/promises";
import net from "node:net";
import { env } from "../config/env.js";

const DEFAULT_CONNECT_ATTEMPTS = 3;
const DEFAULT_CONNECT_RETRY_DELAY_MS = 1500;
const NETWORK_DIAGNOSTIC_TTL_MS = 30_000;
const TCP_PROBE_TIMEOUT_MS = 4_000;
const runtimeDatabaseUrl = (env.DATABASE_URL ?? "").trim();
const runtimeDirectUrl = (env.DIRECT_URL ?? "").trim();

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
  source: "DATABASE_URL";
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

function summarizeDatasource(rawUrl: string) {
  try {
    const parsed = new URL(rawUrl);
    const database = decodeURIComponent(parsed.pathname.replace(/^\/+/, "")) || null;
    return {
      source: "DATABASE_URL" as const,
      host: parsed.hostname,
      port: parsed.port || "5432",
      database,
      schema: parsed.searchParams.get("schema") ?? "public",
      hasSslMode: parsed.searchParams.has("sslmode"),
      hasPgbouncer: parsed.searchParams.has("pgbouncer")
    };
  } catch {
    return {
      source: "DATABASE_URL" as const,
      host: null,
      port: null,
      database: null,
      schema: null,
      hasSslMode: false,
      hasPgbouncer: false
    };
  }
}

const datasourceSummary = {
  ...summarizeDatasource(runtimeDatabaseUrl),
  hasDirectUrl: Boolean(runtimeDirectUrl)
};

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
let prismaLastNetworkDiagnostic: PrismaNetworkDiagnostic | null = null;
let prismaLastNetworkDiagnosticAt = 0;

export function isPrismaConnected() {
  return prismaConnected;
}

export function getPrismaConnectionState() {
  return {
    connected: prismaConnected,
    lastFailure: prismaLastFailure,
    networkDiagnostic: prismaLastNetworkDiagnostic
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

async function runDnsAndTcpDiagnostic(options?: { quiet?: boolean; force?: boolean }) {
  const quiet = options?.quiet === true;
  const force = options?.force === true;
  const now = Date.now();

  if (!force && prismaLastNetworkDiagnostic && now - prismaLastNetworkDiagnosticAt < NETWORK_DIAGNOSTIC_TTL_MS) {
    return prismaLastNetworkDiagnostic;
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
      message: "No database host found in DATABASE_URL"
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
      message: "No valid database port found in DATABASE_URL"
    };
  }

  prismaLastNetworkDiagnostic = {
    at: new Date().toISOString(),
    source: "DATABASE_URL",
    host,
    port,
    dns: dnsResult,
    tcp: tcpResult
  };
  prismaLastNetworkDiagnosticAt = now;

  if (!quiet) {
    console.info("PRISMA_NETWORK_DNS", {
      source: "DATABASE_URL",
      host,
      ok: dnsResult.ok,
      addresses: dnsResult.addresses,
      error: dnsResult.error
    });
    console.info("PRISMA_NETWORK_TCP", {
      source: "DATABASE_URL",
      host,
      port,
      ok: tcpResult.ok,
      remoteAddress: tcpResult.remoteAddress,
      remoteFamily: tcpResult.remoteFamily,
      error: tcpResult.error
    });
  }

  return prismaLastNetworkDiagnostic;
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
  const networkDiagnostic = await runDnsAndTcpDiagnostic({ quiet });
  if (!quiet && networkDiagnostic.dns.ok && !networkDiagnostic.tcp.ok) {
    console.error("PRISMA_NETWORK_REACHABILITY_ERROR", {
      reason: "DNS_RESOLVES_BUT_TCP_CONNECT_FAILS",
      source: "DATABASE_URL",
      host: networkDiagnostic.host,
      port: networkDiagnostic.port,
      dnsAddresses: networkDiagnostic.dns.addresses,
      tcpError: networkDiagnostic.tcp.error
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
