-- CreateTable
CREATE TABLE "assignment_configs" (
    "id" UUID NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'GLOBAL',
    "max_active_leads_per_executive" INTEGER NOT NULL DEFAULT 50,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assignment_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "assignment_configs_scope_key" ON "assignment_configs"("scope");

-- AlterTable
ALTER TABLE "leads"
ADD COLUMN "no_executive_available" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "leads_no_executive_available_idx" ON "leads"("no_executive_available");

-- Seed default global assignment config if absent.
INSERT INTO "assignment_configs" ("id", "scope", "max_active_leads_per_executive", "created_at", "updated_at")
VALUES ('00000000-0000-0000-0000-000000000001', 'GLOBAL', 50, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("scope") DO NOTHING;
