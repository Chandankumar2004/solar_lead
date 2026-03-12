import { createRedisConnection } from "./redis.js";

const redisConnection = createRedisConnection();

if (!redisConnection) {
  console.warn("bull_queue_disabled", {
    reason: "REDIS_CONNECTION_UNAVAILABLE"
  });
}

export const bullConnection = redisConnection;
