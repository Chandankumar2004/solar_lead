-- Add missing enum value used by notification delivery.
ALTER TYPE "NotificationChannel" ADD VALUE IF NOT EXISTS 'push';

-- Add enum required by user_device_tokens.
DO $$
BEGIN
  CREATE TYPE "DevicePlatform" AS ENUM ('WEB', 'ANDROID', 'IOS');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

-- Keep lead_statuses aligned with the Prisma schema.
ALTER TABLE "lead_statuses"
  ADD COLUMN IF NOT EXISTS "sla_duration_hours" INTEGER;

-- Create table used to store device push tokens.
CREATE TABLE IF NOT EXISTS "user_device_tokens" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "token" TEXT NOT NULL,
  "platform" "DevicePlatform" NOT NULL,
  "device_id" TEXT,
  "app_version" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "user_device_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "user_device_tokens_token_key"
  ON "user_device_tokens"("token");

CREATE UNIQUE INDEX IF NOT EXISTS "user_device_tokens_user_id_token_key"
  ON "user_device_tokens"("user_id", "token");

CREATE INDEX IF NOT EXISTS "user_device_tokens_user_id_platform_idx"
  ON "user_device_tokens"("user_id", "platform");

DO $$
BEGIN
  ALTER TABLE "user_device_tokens"
    ADD CONSTRAINT "user_device_tokens_user_id_fkey"
    FOREIGN KEY ("user_id")
    REFERENCES "users"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;
