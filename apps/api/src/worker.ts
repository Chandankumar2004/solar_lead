import { env } from "./config/env.js";
import { ensureRedisConnection, redis } from "./lib/redis.js";
import { isNotificationQueueEnabled } from "./workers/notification.worker.js";
import "./services/notification.service.js";

async function startWorker() {
  const redisReady = await ensureRedisConnection(redis);
  if (!redisReady) {
    console.warn("notification_worker_start_degraded", {
      reason: "REDIS_UNAVAILABLE_OR_NOT_CONFIGURED"
    });
  }

  console.info("notification_worker_started", {
    queueEnabled: isNotificationQueueEnabled(),
    queueName: env.BULL_NOTIFICATION_QUEUE
  });
}

void startWorker();
