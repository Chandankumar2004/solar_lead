import { Redis } from "ioredis";
import { env } from "../config/env.js";

export const redis = new Redis(env.REDIS_URL, {
  lazyConnect: true,
  enableOfflineQueue: false,
  maxRetriesPerRequest: 1,
  connectTimeout: 1000,
  retryStrategy: () => null
});

redis.on("error", (error) => {
  console.warn("redis_unavailable", error instanceof Error ? error.message : error);
});
