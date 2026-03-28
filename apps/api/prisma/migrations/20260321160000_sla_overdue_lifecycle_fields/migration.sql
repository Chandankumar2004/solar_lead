ALTER TABLE "leads"
  ADD COLUMN IF NOT EXISTS "status_updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT NOW();

ALTER TABLE "leads"
  ADD COLUMN IF NOT EXISTS "overdue_at" TIMESTAMPTZ(3);

WITH latest_status_entry AS (
  SELECT DISTINCT ON ("lead_id")
    "lead_id",
    "created_at"
  FROM "lead_status_history"
  ORDER BY "lead_id", "created_at" DESC
)
UPDATE "leads" AS "l"
SET "status_updated_at" = COALESCE("latest_status_entry"."created_at", "l"."created_at")
FROM latest_status_entry
WHERE "l"."id" = "latest_status_entry"."lead_id";

UPDATE "leads" AS "l"
SET "status_updated_at" = "l"."created_at"
WHERE NOT EXISTS (
  SELECT 1
  FROM "lead_status_history" AS "h"
  WHERE "h"."lead_id" = "l"."id"
);

UPDATE "leads"
SET "overdue_at" = COALESCE("overdue_at", "updated_at")
WHERE "is_overdue" = TRUE
  AND "overdue_at" IS NULL;

CREATE INDEX IF NOT EXISTS "idx_leads_is_overdue" ON "leads"("is_overdue");
CREATE INDEX IF NOT EXISTS "idx_leads_status_updated_at" ON "leads"("status_updated_at");
CREATE INDEX IF NOT EXISTS "idx_leads_is_overdue_status_updated_at" ON "leads"("is_overdue", "status_updated_at");
