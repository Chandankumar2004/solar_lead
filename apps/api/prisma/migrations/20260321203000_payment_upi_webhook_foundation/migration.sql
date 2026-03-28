-- Extend payments for gateway/webhook-aware UPI collection.
ALTER TABLE "payments"
  ADD COLUMN IF NOT EXISTS "provider" TEXT,
  ADD COLUMN IF NOT EXISTS "upi_id" TEXT,
  ADD COLUMN IF NOT EXISTS "gateway_request_id" TEXT,
  ADD COLUMN IF NOT EXISTS "gateway_status" TEXT,
  ADD COLUMN IF NOT EXISTS "webhook_reference_id" TEXT,
  ADD COLUMN IF NOT EXISTS "provider_payload" JSONB,
  ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Additional query support indexes for payment reconciliation.
CREATE INDEX IF NOT EXISTS "payments_status_method_idx" ON "payments"("status", "method");
CREATE INDEX IF NOT EXISTS "payments_provider_idx" ON "payments"("provider");
CREATE INDEX IF NOT EXISTS "payments_gateway_order_id_idx" ON "payments"("gateway_order_id");
CREATE INDEX IF NOT EXISTS "payments_gateway_payment_id_idx" ON "payments"("gateway_payment_id");
CREATE INDEX IF NOT EXISTS "payments_gateway_request_id_idx" ON "payments"("gateway_request_id");
CREATE INDEX IF NOT EXISTS "payments_webhook_reference_id_idx" ON "payments"("webhook_reference_id");

-- Enforce one verified UPI gateway token payment per lead.
CREATE UNIQUE INDEX IF NOT EXISTS "payments_lead_id_upi_gateway_verified_unique"
  ON "payments"("lead_id")
  WHERE "method" = 'upi_gateway'::"PaymentMethod"
    AND "status" = 'verified'::"PaymentStatus";

-- Idempotent webhook event persistence for payment providers.
CREATE TABLE IF NOT EXISTS "payment_webhook_events" (
  "id" UUID NOT NULL,
  "provider" TEXT NOT NULL,
  "event_id" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "payment_id" UUID,
  "lead_id" UUID,
  "gateway_order_id" TEXT,
  "gateway_payment_id" TEXT,
  "signature" TEXT,
  "payload" JSONB NOT NULL,
  "processed" BOOLEAN NOT NULL DEFAULT false,
  "processing_note" TEXT,
  "processed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payment_webhook_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "payment_webhook_events_event_id_key"
  ON "payment_webhook_events"("event_id");
CREATE INDEX IF NOT EXISTS "payment_webhook_events_provider_event_type_idx"
  ON "payment_webhook_events"("provider", "event_type");
CREATE INDEX IF NOT EXISTS "payment_webhook_events_payment_id_idx"
  ON "payment_webhook_events"("payment_id");
CREATE INDEX IF NOT EXISTS "payment_webhook_events_lead_id_idx"
  ON "payment_webhook_events"("lead_id");
CREATE INDEX IF NOT EXISTS "payment_webhook_events_gateway_order_id_idx"
  ON "payment_webhook_events"("gateway_order_id");
CREATE INDEX IF NOT EXISTS "payment_webhook_events_gateway_payment_id_idx"
  ON "payment_webhook_events"("gateway_payment_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'payment_webhook_events_payment_id_fkey'
  ) THEN
    ALTER TABLE "payment_webhook_events"
      ADD CONSTRAINT "payment_webhook_events_payment_id_fkey"
      FOREIGN KEY ("payment_id") REFERENCES "payments"("id")
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'payment_webhook_events_lead_id_fkey'
  ) THEN
    ALTER TABLE "payment_webhook_events"
      ADD CONSTRAINT "payment_webhook_events_lead_id_fkey"
      FOREIGN KEY ("lead_id") REFERENCES "leads"("id")
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;
END
$$;
