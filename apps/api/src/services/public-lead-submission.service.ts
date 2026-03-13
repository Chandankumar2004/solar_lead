import { randomUUID } from "crypto";
import { AppError } from "../lib/errors.js";
import { getSupabaseAdminClient } from "../lib/supabase.js";
import { sendCustomerNotification } from "./customer-notification-delivery.service.js";
import { prisma } from "../lib/prisma.js";
import { resolveLeadAutoAssignment } from "./lead-assignment.service.js";
import { assertValidTransition, getAssignedLeadStatus, getNewLeadStatus } from "./lead-status.service.js";

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
  districtName: string;
  mirroredLeadId?: string | null;
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

  const supabase = getRequiredSupabaseAdminClient();
  const districtLookup = await supabase
    .from("districts")
    .select("id, name, state")
    .eq("id", input.districtId)
    .maybeSingle();

  if (districtLookup.error) {
    throw new AppError(500, "DISTRICT_LOOKUP_FAILED", "Failed to resolve selected district", {
      reason: districtLookup.error.message,
      districtId: input.districtId
    });
  }

  const district = districtLookup.data;
  if (!district) {
    throw new AppError(400, "DISTRICT_NOT_FOUND", "Selected district not found");
  }

  const districtName = typeof district.name === "string" ? district.name.trim() : "";
  const districtState = typeof district.state === "string" ? district.state.trim() : "";
  if (!districtName || !districtState) {
    throw new AppError(
      500,
      "DISTRICT_DATA_INVALID",
      "Selected district is missing required district metadata",
      { districtId: input.districtId }
    );
  }

  const id = randomUUID();
  const externalId = randomUUID();
  const submittedState = input.state?.trim() ?? "";
  if (submittedState && submittedState.toLowerCase() !== districtState.toLowerCase()) {
    throw new AppError(
      400,
      "DISTRICT_STATE_MISMATCH",
      "Selected district and state do not match"
    );
  }

  const state = districtState;

  const { error } = await supabase.from("public_lead_submissions").insert({
    id,
    external_id: externalId,
    name: input.name,
    phone: input.phone,
    email: input.email ?? null,
    monthly_bill: input.monthlyBill ?? null,
    district_id: input.districtId,
    district_name: districtName,
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

  return { id, externalId, districtName };
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

function buildCustomerAckSms(input: { name: string; externalId: string; districtName: string }) {
  return `Thank you ${input.name} for choosing Solar Admin. Your solar consultation request is received. Ref ID: ${input.externalId}. Our ${input.districtName} team will contact you within 24 hours.`;
}

async function mirrorPublicSubmissionToLead(input: PublicLeadSubmissionInput) {
  const newStatus = await getNewLeadStatus();
  if (!newStatus) {
    console.error("public_submission_lead_mirror_failed", {
      reason: "NEW_STATUS_NOT_CONFIGURED",
      districtId: input.districtId,
      phone: input.phone
    });
    return null;
  }

  const assignedStatus = await getAssignedLeadStatus();
  const autoAssignment = await resolveLeadAutoAssignment(input.districtId);

  let currentStatusId = newStatus.id;
  let assignedExecutiveId: string | null = null;
  let assignedManagerId: string | null = null;
  let isOverdue = false;

  if (autoAssignment) {
    assignedExecutiveId = autoAssignment.assignedExecutiveId;
    assignedManagerId = autoAssignment.assignedManagerId;
    isOverdue = autoAssignment.flagged;

    if (assignedStatus) {
      const allowed = await assertValidTransition(newStatus.id, assignedStatus.id);
      if (allowed) {
        currentStatusId = assignedStatus.id;
      }
    }
  }

  const lead = await prisma.lead.create({
    data: {
      name: input.name,
      phone: input.phone,
      email: input.email ?? null,
      monthlyBill: input.monthlyBill ?? null,
      districtId: input.districtId,
      state: input.state?.trim() || null,
      installationType: input.installationType ?? null,
      message: input.message ?? "Public lead submission",
      currentStatusId,
      assignedExecutiveId,
      assignedManagerId,
      utmSource: input.utmSource ?? null,
      utmMedium: input.utmMedium ?? null,
      utmCampaign: input.utmCampaign ?? null,
      utmTerm: input.utmTerm ?? null,
      utmContent: input.utmContent ?? null,
      sourceIp: input.sourceIp ?? null,
      recaptchaScore: input.recaptchaScore ?? null,
      consentGiven: input.consentGiven,
      consentTimestamp: input.consentGiven ? new Date() : null,
      isOverdue
    },
    select: { id: true }
  });

  return lead.id;
}

export async function submitPublicLeadWithSms(input: PublicLeadSubmissionInput) {
  const record = await savePublicSubmission(input);
  let mirroredLeadId: string | null = null;

  try {
    mirroredLeadId = await mirrorPublicSubmissionToLead(input);
  } catch (error) {
    console.error("public_submission_lead_mirror_failed", {
      districtId: input.districtId,
      phone: input.phone,
      error
    });
  }

  try {
    const delivery = await sendCustomerNotification({
      channel: "SMS",
      recipient: input.phone,
      body: buildCustomerAckSms({
        name: input.name,
        externalId: record.externalId,
        districtName: record.districtName
      }),
      metadata: {
        refId: record.externalId,
        districtId: input.districtId,
        districtName: record.districtName
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

  return {
    ...record,
    mirroredLeadId
  };
}

export async function countPublicSubmissionsByPhone(phone: string) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    console.error("public_submission_duplicate_check_failed", {
      phone,
      error: "SUPABASE_ADMIN_NOT_CONFIGURED"
    });
    return 0;
  }

  try {
    await ensurePublicSubmissionTableAvailable();
  } catch (error) {
    console.error("public_submission_duplicate_check_failed", {
      phone,
      error
    });
    return 0;
  }

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

export async function countActiveLeadsByPhone(phone: string) {
  try {
    const count = await prisma.lead.count({
      where: {
        phone,
        currentStatus: {
          isTerminal: false
        }
      }
    });
    return count;
  } catch (error) {
    console.error("active_lead_duplicate_check_failed", {
      phone,
      error
    });
    return 0;
  }
}
