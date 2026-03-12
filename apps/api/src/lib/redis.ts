import { createRequire } from "module";
import { env } from "../config/env.js";

type RedisClient = {
  status: string;
  connect(): Promise<void>;
  on(event: string, listener: (error: unknown) => void): unknown;
};

type RedisConstructor = new (
  url: string,
  options: Record<string, unknown>
) => RedisClient;

const require = createRequire(import.meta.url);

const defaultRedisOptions: Record<string, unknown> = {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  lazyConnect: true
};

function loadRedisConstructor() {
  try {
    const moduleExports = require("ioredis") as
      | RedisConstructor
      | { default?: RedisConstructor };
    return ("default" in moduleExports
      ? moduleExports.default
      : moduleExports) as RedisConstructor;
  } catch (error) {
    console.warn("redis_dependency_missing", {
      reason: "ioredis_not_installed",
      error
    });
    return null;
  }
}

function createRedisClient() {
  if (!env.REDIS_URL) {
    return null;
  }

  const Redis = loadRedisConstructor();
  if (!Redis) {
    return null;
  }

  const client = new Redis(env.REDIS_URL, defaultRedisOptions);
  client.on("error", (error) => {
    console.error("redis_connection_error", {
      error
    });
  });

  return client;
}

export const redis = createRedisClient();

export function createRedisConnection() {
  if (!env.REDIS_URL) {
    return null;
  }

  const Redis = loadRedisConstructor();
  if (!Redis) {
    return null;
  }

  return new Redis(env.REDIS_URL, defaultRedisOptions);
}

export async function ensureRedisConnection(client: RedisClient | null = redis) {
  if (!client) {
    return false;
  }

  if (client.status === "ready") {
    return true;
  }

  if (client.status === "wait" || client.status === "end") {
    await client.connect();
    return true;
  }

  if (client.status === "connecting") {
    return true;
  }

  if (client.status === "reconnecting") {
    return true;
  }

  return false;
}
