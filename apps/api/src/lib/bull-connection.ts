import { ConnectionOptions } from "bullmq";
import { env } from "../config/env.js";

const redisUrl = new URL(env.REDIS_URL);
const usesTls = redisUrl.protocol === "rediss:";

const parsedDb = redisUrl.pathname && redisUrl.pathname !== "/"
  ? Number(redisUrl.pathname.slice(1))
  : undefined;

export const bullConnection: ConnectionOptions = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port || (usesTls ? "6380" : "6379")),
  username: redisUrl.username ? decodeURIComponent(redisUrl.username) : undefined,
  password: redisUrl.password ? decodeURIComponent(redisUrl.password) : undefined,
  ...(Number.isFinite(parsedDb as number) ? { db: parsedDb } : {}),
  ...(usesTls ? { tls: {} } : {})
};
