-- Enforce at most one verified token payment per lead across all payment methods.
-- This closes race conditions where multiple pending rows could be reviewed as VERIFIED.
CREATE UNIQUE INDEX IF NOT EXISTS "payments_lead_id_verified_unique"
  ON "payments"("lead_id")
  WHERE "status" = 'verified'::"PaymentStatus";
