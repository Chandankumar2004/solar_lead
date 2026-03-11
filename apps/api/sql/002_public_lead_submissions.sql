CREATE TABLE IF NOT EXISTS public.public_lead_submissions (
  id UUID PRIMARY KEY,
  external_id UUID NOT NULL UNIQUE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NULL,
  monthly_bill NUMERIC(12, 2) NULL,
  district_id UUID NOT NULL,
  district_name TEXT NOT NULL,
  state TEXT NOT NULL,
  installation_type TEXT NULL,
  message TEXT NULL,
  consent_given BOOLEAN NOT NULL DEFAULT false,
  source_ip TEXT NULL,
  recaptcha_score NUMERIC(5, 4) NULL,
  utm_source TEXT NULL,
  utm_medium TEXT NULL,
  utm_campaign TEXT NULL,
  utm_term TEXT NULL,
  utm_content TEXT NULL,
  sms_delivery_status TEXT NULL,
  sms_provider_message_id TEXT NULL,
  sms_error TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_public_lead_submissions_phone
  ON public.public_lead_submissions(phone);

CREATE INDEX IF NOT EXISTS idx_public_lead_submissions_created_at
  ON public.public_lead_submissions(created_at DESC);
