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

    const configuredSchema = (parsed.searchParams.get("schema") ?? "").trim();
    if (!configuredSchema) {
      parsed.searchParams.set("schema", DEFAULT_APP_DB_SCHEMA);
    } else if (configuredSchema.toLowerCase() !== DEFAULT_APP_DB_SCHEMA) {
      console.error("DB_METADATA_CHECK_ERROR", {
        reason: "DATABASE_URL_SCHEMA_OVERRIDE",
        fromSchema: configuredSchema,
        toSchema: DEFAULT_APP_DB_SCHEMA
      });
      parsed.searchParams.set("schema", DEFAULT_APP_DB_SCHEMA);
    }

    const configuredCurrentSchema = (parsed.searchParams.get("currentSchema") ?? "").trim();
    if (configuredCurrentSchema && configuredCurrentSchema.toLowerCase() !== DEFAULT_APP_DB_SCHEMA) {
      console.error("DB_METADATA_CHECK_ERROR", {
        reason: "DATABASE_URL_CURRENT_SCHEMA_OVERRIDE",
        fromSchema: configuredCurrentSchema,
        toSchema: DEFAULT_APP_DB_SCHEMA
      });
      parsed.searchParams.set("currentSchema", DEFAULT_APP_DB_SCHEMA);
    }

    const rawOptions = parsed.searchParams.get("options");
    if (rawOptions) {
      const normalizedOptions = normalizeOptionsParam(rawOptions);
      if (normalizedOptions !== rawOptions) {
        console.error("DB_METADATA_CHECK_ERROR", {
          reason: "DATABASE_URL_SEARCH_PATH_OVERRIDE",
          toSchema: DEFAULT_APP_DB_SCHEMA
        });
        parsed.searchParams.set("options", normalizedOptions);
      }
    }

    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

const runtimeDatabaseUrl = (env.DATABASE_URL ?? process.env.DATABASE_URL ?? "").trim();
const runtimeDirectUrl = (process.env.DIRECT_URL ?? "").trim();
const rawPrismaUrl = runtimeDatabaseUrl || runtimeDirectUrl;
const prismaDatasourceUrl = normalizePrismaDatasourceUrl(rawPrismaUrl);
const alternateRawPrismaUrl =
  runtimeDatabaseUrl && runtimeDirectUrl
    ? rawPrismaUrl === runtimeDatabaseUrl
      ? runtimeDirectUrl
      : runtimeDatabaseUrl
    : "";
const prismaAlternateDatasourceUrl = normalizePrismaDatasourceUrl(alternateRawPrismaUrl);

if (runtimeDatabaseUrl) {
  console.info("DB_SCHEMA_CONTEXT", {
    reason: "USING_DATABASE_URL_FOR_RUNTIME"
  });
} else if (runtimeDirectUrl) {
  console.info("DB_SCHEMA_CONTEXT", {
    reason: "USING_DIRECT_URL_FALLBACK_FOR_RUNTIME"
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

if (prismaAuthFallback !== prisma) {
  console.info("DB_SCHEMA_CONTEXT", {
    reason: "ALTERNATE_RUNTIME_DATASOURCE_AVAILABLE_FOR_AUTH"
  });
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
