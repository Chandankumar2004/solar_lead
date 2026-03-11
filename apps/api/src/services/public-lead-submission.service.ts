import { randomUUID } from "crypto";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../lib/errors.js";
import { getSupabaseAdminClient } from "../lib/supabase.js";
import { sendCustomerNotification } from "./customer-notification-delivery.service.js";

export type PublicLeadSubmissionInput = {
  name: string;
  phone: string;
  email?: string;
  monthlyBill?: number;
  districtId: string;
  state?: string;
  installationType?: string;
  message?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmTerm?: string;
  utmContent?: string;
  recaptchaScore?: number;
  consentGiven: boolean;
  sourceIp?: string | null;
};

type PublicLeadSubmissionRecord = {
  id: string;
  externalId: string;
};

let verifiedPublicSubmissionTable = false;

function getRequiredSupabaseAdminClient() {
  const client = getSupabaseAdminClient();
  if (!client) {
    throw new AppError(
      500,
      "SUPABASE_ADMIN_NOT_CONFIGURED",
      "Supabase admin client is not configured on backend"
    );
  }
  return client;
}

async function ensurePublicSubmissionTableAvailable() {
  if (verifiedPublicSubmissionTable) {
    return;
  }

  const supabase = getRequiredSupabaseAdminClient();
  const { error } = await supabase
    .from("public_lead_submissions")
    .select("id", { head: true, count: "exact" })
    .limit(1);

  if (error) {
    throw new AppError(
      500,
      "PUBLIC_SUBMISSIONS_TABLE_UNAVAILABLE",
      "Public submissions table is unavailable",
      { reason: error.message }
    );
  }

  verifiedPublicSubmissionTable = true;
}

async function savePublicSubmission(
  input: PublicLeadSubmissionInput
): Promise<PublicLeadSubmissionRecord> {
  await ensurePublicSubmissionTableAvailable();

  const district = await prisma.district.findUnique({
    where: { id: input.districtId },
    select: {
      id: true,
      name: true,
      state: true
    }
  });

  if (!district) {
    throw new AppError(400, "DISTRICT_NOT_FOUND", "Selected district not found");
  }

  const id = randomUUID();
  const externalId = randomUUID();
  const state = (input.state?.trim() || district.state).trim();

  const supabase = getRequiredSupabaseAdminClient();
  const { error } = await supabase.from("public_lead_submissions").insert({
    id,
    external_id: externalId,
    name: input.name,
    phone: input.phone,
    email: input.email ?? null,
    monthly_bill: input.monthlyBill ?? null,
    district_id: district.id,
    district_name: district.name,
    state,
    installation_type: input.installationType ?? null,
    message: input.message ?? null,
    consent_given: input.consentGiven,
    source_ip: input.sourceIp ?? null,
    recaptcha_score: input.recaptchaScore ?? null,
    utm_source: input.utmSource ?? null,
    utm_medium: input.utmMedium ?? null,
    utm_campaign: input.utmCampaign ?? null,
    utm_term: input.utmTerm ?? null,
    utm_content: input.utmContent ?? null
  });

  if (error) {
    throw new AppError(500, "PUBLIC_SUBMISSION_INSERT_FAILED", "Lead submission failed", {
      reason: error.message
    });
  }

  return { id, externalId };
}

async function updateSubmissionSmsState(input: {
  id: string;
  status: string;
  providerMessageId?: string | null;
  error?: string | null;
}) {
  await ensurePublicSubmissionTableAvailable();
  const supabase = getRequiredSupabaseAdminClient();
  const { error } = await supabase
    .from("public_lead_submissions")
    .update({
      sms_delivery_status: input.status,
      sms_provider_message_id: input.providerMessageId ?? null,
      sms_error: input.error ?? null,
      updated_at: new Date().toISOString()
    })
    .eq("id", input.id);

  if (error) {
    throw new AppError(500, "PUBLIC_SUBMISSION_SMS_UPDATE_FAILED", "Failed to update SMS status", {
      reason: error.message
    });
  }
}

async function updateSubmissionSmsStateBestEffort(input: {
  id: string;
  status: string;
  providerMessageId?: string | null;
  error?: string | null;
}) {
  try {
    await updateSubmissionSmsState(input);
  } catch (error) {
    console.error("public_submission_sms_state_update_failed", {
      submissionId: input.id,
      status: input.status,
      error
    });
  }
}

function buildCustomerAckSms(externalId: string) {
  return `Thanks for your solar consultation request. Ref ID: ${externalId}. Our district team will contact you shortly.`;
}

export async function submitPublicLeadWithSms(input: PublicLeadSubmissionInput) {
  const record = await savePublicSubmission(input);

  try {
    const delivery = await sendCustomerNotification({
      channel: "SMS",
      recipient: input.phone,
      body: buildCustomerAckSms(record.externalId),
      metadata: {
        refId: record.externalId,
        districtId: input.districtId
      }
    });

    await updateSubmissionSmsStateBestEffort({
      id: record.id,
      status: "sent",
      providerMessageId: delivery.providerMessageId
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "SMS delivery failed";
    console.error("public_lead_sms_failed", {
      submissionId: record.id,
      externalId: record.externalId,
      error: message
    });
    await updateSubmissionSmsStateBestEffort({
      id: record.id,
      status: "failed",
      error: message
    });
  }

  return record;
}

export async function countPublicSubmissionsByPhone(phone: string) {
  await ensurePublicSubmissionTableAvailable();
  const supabase = getRequiredSupabaseAdminClient();
  const { count, error } = await supabase
    .from("public_lead_submissions")
    .select("id", { head: true, count: "exact" })
    .eq("phone", phone);

  if (error) {
    console.error("public_submission_duplicate_check_failed", {
      phone,
      error: error.message
    });
    return 0;
  }
  return Number(count ?? 0);
}
