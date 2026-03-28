-- Consent + opt-out compliance fields
ALTER TABLE "leads"
  ADD COLUMN IF NOT EXISTS "consent_ip_address" TEXT,
  ADD COLUMN IF NOT EXISTS "email_opt_out" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "whatsapp_opt_out" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "sms_dnd_status" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "opt_out_timestamp" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "opt_out_source" TEXT;

CREATE INDEX IF NOT EXISTS "leads_email_opt_out_idx" ON "leads"("email_opt_out");
CREATE INDEX IF NOT EXISTS "leads_whatsapp_opt_out_idx" ON "leads"("whatsapp_opt_out");
CREATE INDEX IF NOT EXISTS "leads_sms_dnd_status_idx" ON "leads"("sms_dnd_status");

ALTER TABLE "public_lead_submissions"
  ADD COLUMN IF NOT EXISTS "consent_timestamp" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "consent_ip_address" TEXT;
