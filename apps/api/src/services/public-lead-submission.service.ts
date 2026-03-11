import { randomUUID } from "crypto";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../lib/errors.js";
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

let ensuredPublicSubmissionTable = false;

async function publicSubmissionTableExists() {
  const rows = await prisma.$queryRaw<Array<{ table_name: string | null }>>`
    SELECT to_regclass('public.public_lead_submissions')::text AS table_name
  `;
  return Boolean(rows[0]?.table_name);
}

async function ensurePublicSubmissionTable() {
  if (ensuredPublicSubmissionTable) {
    return;
  }

  const alreadyExists = await publicSubmissionTableExists();
  if (alreadyExists) {
    ensuredPublicSubmissionTable = true;
    return;
  }

  try {
    await prisma.$executeRawUnsafe(`
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
      )
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS idx_public_lead_submissions_phone
      ON public.public_lead_submissions(phone)
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS idx_public_lead_submissions_created_at
      ON public.public_lead_submissions(created_at DESC)
    `);
  } catch (error) {
    // If table appears in a concurrent request/deploy, continue.
    const existsAfterError = await publicSubmissionTableExists().catch(() => false);
    if (!existsAfterError) {
      throw error;
    }
  }

  ensuredPublicSubmissionTable = true;
}

async function savePublicSubmission(
  input: PublicLeadSubmissionInput
): Promise<PublicLeadSubmissionRecord> {
  await ensurePublicSubmissionTable();

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

  await prisma.$executeRaw`
    INSERT INTO public.public_lead_submissions (
      id,
      external_id,
      name,
      phone,
      email,
      monthly_bill,
      district_id,
      district_name,
      state,
      installation_type,
      message,
      consent_given,
      source_ip,
      recaptcha_score,
      utm_source,
      utm_medium,
      utm_campaign,
      utm_term,
      utm_content
    ) VALUES (
      ${id}::uuid,
      ${externalId}::uuid,
      ${input.name},
      ${input.phone},
      ${input.email ?? null},
      ${input.monthlyBill ?? null},
      ${district.id}::uuid,
      ${district.name},
      ${state},
      ${input.installationType ?? null},
      ${input.message ?? null},
      ${input.consentGiven},
      ${input.sourceIp ?? null},
      ${input.recaptchaScore ?? null},
      ${input.utmSource ?? null},
      ${input.utmMedium ?? null},
      ${input.utmCampaign ?? null},
      ${input.utmTerm ?? null},
      ${input.utmContent ?? null}
    )
  `;

  return { id, externalId };
}

async function updateSubmissionSmsState(input: {
  id: string;
  status: string;
  providerMessageId?: string | null;
  error?: string | null;
}) {
  await ensurePublicSubmissionTable();
  await prisma.$executeRaw`
    UPDATE public.public_lead_submissions
    SET
      sms_delivery_status = ${input.status},
      sms_provider_message_id = ${input.providerMessageId ?? null},
      sms_error = ${input.error ?? null},
      updated_at = now()
    WHERE id = ${input.id}::uuid
  `;
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

    await updateSubmissionSmsState({
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
    await updateSubmissionSmsState({
      id: record.id,
      status: "failed",
      error: message
    });
  }

  return record;
}

export async function countPublicSubmissionsByPhone(phone: string) {
  await ensurePublicSubmissionTable();
  const rows = await prisma.$queryRaw<Array<{ count: bigint | number }>>`
    SELECT COUNT(*)::bigint AS count
    FROM public.public_lead_submissions
    WHERE phone = ${phone}
  `;

  const value = rows[0]?.count ?? 0;
  if (typeof value === "bigint") {
    return Number(value);
  }
  return Number(value);
}
