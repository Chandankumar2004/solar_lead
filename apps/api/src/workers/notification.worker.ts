import { createRequire } from "module";
import { env } from "../config/env.js";
import { bullConnection } from "../lib/bull-connection.js";
import type {
  CustomerNotificationJobPayload,
  InAppNotificationJobPayload
} from "../services/notification.service.js";

type JobLike = {
  id?: string | number;
  name: string;
  data: unknown;
  attemptsMade: number;
  opts: {
    attempts?: number;
  };
};

type QueueLike = {
  add(name: string, data: unknown, options?: Record<string, unknown>): Promise<unknown>;
};

type WorkerLike = {
  on(event: string, listener: (payload: unknown) => void): unknown;
};

type BullModule = {
  Queue: new (name: string, options: Record<string, unknown>) => QueueLike;
  Worker: new (
    name: string,
    processor: (job: JobLike) => Promise<void>,
    options: Record<string, unknown>
  ) => WorkerLike;
};

const require = createRequire(import.meta.url);

function loadBullModule() {
  try {
    return require("bullmq") as BullModule;
  } catch (error) {
    console.warn("bullmq_dependency_missing", {
      reason: "bullmq_not_installed",
      error
    });
    return null;
  }
}

const bullModule = loadBullModule();

const IN_APP_JOB = "in_app_notification";
const CUSTOMER_JOB = "customer_notification";

const queueName = env.BULL_NOTIFICATION_QUEUE;
const customerAttempts = Math.max(1, Math.min(3, env.REDIS_MAX_RETRIES));
const inAppAttempts = Math.max(1, Math.min(3, env.REDIS_MAX_RETRIES));

const defaultJobOptions = {
  attempts: customerAttempts,
  backoff: {
    type: "exponential",
    delay: 5_000
  },
  removeOnComplete: 500,
  removeOnFail: 1_000
};

type NotificationJobHandlers = {
  inApp?: (payload: InAppNotificationJobPayload) => Promise<void>;
  customer?: (
    payload: CustomerNotificationJobPayload,
    context: { attemptsMade: number; maxAttempts: number }
  ) => Promise<void>;
};

const handlers: NotificationJobHandlers = {};

export const notificationQueue = bullConnection
  ? bullModule
    ? new bullModule.Queue(queueName, {
        connection: bullConnection,
        defaultJobOptions
      })
    : null
  : null;

let worker: WorkerLike | null = null;

function resolveMaxAttempts(job: JobLike) {
  if (typeof job.opts.attempts === "number" && job.opts.attempts > 0) {
    return job.opts.attempts;
  }
  return customerAttempts;
}

function ensureWorkerStarted() {
  const loadedBullModule = bullModule;
  if (!loadedBullModule || !notificationQueue || !bullConnection || worker) {
    return;
  }
  if (!handlers.inApp || !handlers.customer) {
    return;
  }

  worker = new loadedBullModule.Worker(
    queueName,
    async (job: JobLike) => {
      if (job.name === IN_APP_JOB) {
        await handlers.inApp!(job.data as InAppNotificationJobPayload);
        return;
      }

      if (job.name === CUSTOMER_JOB) {
        await handlers.customer!(job.data as CustomerNotificationJobPayload, {
          attemptsMade: job.attemptsMade,
          maxAttempts: resolveMaxAttempts(job)
        });
        return;
      }

      console.warn("unknown_notification_job", {
        name: job.name,
        id: job.id
      });
    },
    {
      connection: bullConnection,
      concurrency: 8
    }
  );

  worker.on("error", (error: unknown) => {
    console.error("notification_worker_error", {
      error
    });
  });
}

export function registerNotificationJobHandlers(next: NotificationJobHandlers) {
  if (next.inApp) {
    handlers.inApp = next.inApp;
  }
  if (next.customer) {
    handlers.customer = next.customer;
  }
  ensureWorkerStarted();
}

export function isNotificationQueueEnabled() {
  return Boolean(notificationQueue);
}

export async function enqueueInAppNotificationJob(payload: InAppNotificationJobPayload) {
  if (!notificationQueue) {
    return false;
  }

  try {
    await notificationQueue.add(IN_APP_JOB, payload, {
      attempts: inAppAttempts,
      backoff: {
        type: "exponential",
        delay: 2_000
      }
    });
    return true;
  } catch (error) {
    console.error("enqueue_in_app_notification_failed", {
      error
    });
    return false;
  }
}

export async function enqueueCustomerNotificationJob(
  payload: CustomerNotificationJobPayload
) {
  if (!notificationQueue) {
    return false;
  }

  try {
    await notificationQueue.add(CUSTOMER_JOB, payload, {
      attempts: customerAttempts,
      backoff: {
        type: "exponential",
        delay: 5_000
      }
    });
    return true;
  } catch (error) {
    console.error("enqueue_customer_notification_failed", {
      leadId: payload.leadId,
      logId: payload.logId,
      error
    });
    return false;
  }
}
