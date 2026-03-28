import { Request, Response, Router } from "express";
import { z } from "zod";
import { created, ok } from "../lib/http.js";
import { validateBody, validateQuery } from "../middleware/validate.js";
import { publicLeadSubmissionRateLimit } from "../middleware/rate-limit.js";
import { createAuditLog, requestIp } from "../services/audit-log.service.js";
import { AppError } from "../lib/errors.js";
import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import { getPublicDistrictsPayload } from "../services/districts.service.js";
import { resolveRecaptchaSecret, verifyRecaptchaToken } from "../services/recaptcha.service.js";
import {
  countActiveLeadsByPhone,
  submitPublicLeadWithSms
} from "../services/public-lead-submission.service.js";
import {
  applyLeadChannelOptOutByContact,
  containsStopKeyword,
  markLeadSmsDndByPhone,
  unsubscribeFromToken
} from "../services/customer-communication-preferences.service.js";

export const publicRouter = Router();

const NAME_REGEX = /^[A-Za-z]+(?: [A-Za-z]+)*$/;
const INDIAN_MOBILE_REGEX = /^[6-9]\d{9}$/;
const INSTALLATION_TYPES = ["Residential", "Industrial", "Agricultural", "Other"] as const;

const monthlyBillSchema = z.preprocess(
  (value) => {
    if (value === "" || value === null || value === undefined) {
      return null;
    }
    if (typeof value === "string") {
      const parsed = Number(value);
      return Number.isNaN(parsed) ? value : parsed;
    }
    return value;
  },
  z
    .number({ invalid_type_error: "monthly bill must be a valid number" })
    .int("monthly bill must be a whole number")
    .min(
      env.PUBLIC_LEAD_MIN_MONTHLY_BILL_INR,
      `monthly bill must be at least INR ${env.PUBLIC_LEAD_MIN_MONTHLY_BILL_INR}`
    )
    .max(1_000_000, "monthly bill too large")
);

const publicLeadSubmissionSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "name must be at least 2 characters")
    .max(120)
    .regex(NAME_REGEX, "name must contain alphabets and spaces only"),
  phone: z.string().trim().regex(INDIAN_MOBILE_REGEX, "phone must be a valid 10-digit Indian mobile number"),
  email: z.string().trim().email("email must be valid"),
  monthlyBill: monthlyBillSchema.optional(),
  monthly_bill: monthlyBillSchema.optional(),
  districtId: z.string().uuid().optional(),
  district_id: z.string().uuid().optional(),
  state: z.string().trim().min(2).max(100),
  installationType: z.enum(INSTALLATION_TYPES).optional(),
  installation_type: z.enum(INSTALLATION_TYPES).optional(),
  message: z.string().trim().max(500).optional(),
  utmSource: z.string().trim().max(100).optional(),
  utm_source: z.string().trim().max(100).optional(),
  utmMedium: z.string().trim().max(100).optional(),
  utm_medium: z.string().trim().max(100).optional(),
  utmCampaign: z.string().trim().max(100).optional(),
  utm_campaign: z.string().trim().max(100).optional(),
  utmTerm: z.string().trim().max(100).optional(),
  utm_term: z.string().trim().max(100).optional(),
  utmContent: z.string().trim().max(100).optional(),
  utm_content: z.string().trim().max(100).optional(),
  recaptchaScore: z.number().min(0).max(1).optional(),
  recaptcha_score: z.number().min(0).max(1).optional(),
  recaptchaToken: z.string().min(10).optional(),
  recaptcha_token: z.string().min(10).optional(),
  consentGiven: z.boolean().optional(),
  consent_given: z.boolean().optional()
})
  .superRefine((data, ctx) => {
    if (!data.districtId && !data.district_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["districtId"],
        message: "districtId or district_id is required"
      });
    }
    if (data.monthlyBill === undefined && data.monthly_bill === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["monthlyBill"],
        message: "monthly bill is required"
      });
    }
    if (!data.installationType && !data.installation_type) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["installationType"],
        message: "installation type is required"
      });
    }
    if ((data.consentGiven ?? data.consent_given) !== true) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["consentGiven"],
        message: "consent for SMS, Email, and WhatsApp communication is required"
      });
    }
  })
  .transform((data) => ({
    name: data.name,
    phone: data.phone,
    email: data.email.trim(),
    monthlyBill: data.monthlyBill ?? data.monthly_bill,
    districtId: data.districtId ?? data.district_id!,
    state: data.state.trim(),
    installationType: data.installationType ?? data.installation_type!,
    message: data.message?.trim() || undefined,
    utmSource: data.utmSource ?? data.utm_source,
    utmMedium: data.utmMedium ?? data.utm_medium,
    utmCampaign: data.utmCampaign ?? data.utm_campaign,
    utmTerm: data.utmTerm ?? data.utm_term,
    utmContent: data.utmContent ?? data.utm_content,
    recaptchaScore: data.recaptchaScore ?? data.recaptcha_score,
    recaptchaToken: data.recaptchaToken ?? data.recaptcha_token,
    consentGiven: true
  }));

const duplicatePhoneQuerySchema = z.object({
  phone: z.string().trim().regex(INDIAN_MOBILE_REGEX, "phone must be a valid 10-digit Indian mobile number")
});

const unsubscribeTokenQuerySchema = z.object({
  token: z.string().trim().min(20)
});

const unsubscribeTokenBodySchema = z.object({
  token: z.string().trim().min(20)
});

const stopOptOutBodySchema = z
  .object({
    channel: z.enum(["EMAIL", "WHATSAPP", "SMS"]),
    email: z.string().trim().email().optional(),
    phone: z.string().trim().min(6).optional(),
    message: z.string().trim().max(500).optional(),
    source: z.string().trim().min(2).max(120).optional(),
    secret: z.string().trim().optional()
  })
  .superRefine((value, ctx) => {
    if (value.channel === "EMAIL" && !value.email) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["email"],
        message: "email is required when channel=EMAIL"
      });
    }
    if ((value.channel === "WHATSAPP" || value.channel === "SMS") && !value.phone) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["phone"],
        message: "phone is required for WHATSAPP/SMS channel"
      });
    }
    if (value.message && !containsStopKeyword(value.message)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["message"],
        message: "message must contain STOP/UNSUBSCRIBE intent"
      });
    }
  });

function parseBooleanEnv(raw: string | undefined): boolean | null {
  if (typeof raw !== "string") {
    return null;
  }

  const normalized = raw.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return null;
}

const enforceRecaptchaOnPublicLead =
  parseBooleanEnv(process.env.RECAPTCHA_ENFORCE_PUBLIC_LEAD) ?? env.NODE_ENV === "production";

publicRouter.get("/districts", async (_req: Request, res: Response) => {
  const payload = await getPublicDistrictsPayload();
  return ok(res, payload, "District list and mapping fetched");
});

publicRouter.get("/district-mapping", async (_req: Request, res: Response) => {
  const payload = await getPublicDistrictsPayload();
  return ok(res, payload, "District mapping fetched");
});

publicRouter.get("/metrics/installations", async (_req: Request, res: Response) => {
  const statuses = await prisma.leadStatus.findMany({
    where: {
      name: {
        equals: "Installation Complete",
        mode: "insensitive"
      }
    },
    select: { id: true }
  });

  if (statuses.length === 0) {
    return ok(
      res,
      {
        count: null
      },
      "Installations metric unavailable"
    );
  }

  const count = await prisma.lead.count({
    where: {
      currentStatusId: {
        in: statuses.map((status) => status.id)
      }
    }
  });

  return ok(
    res,
    {
      count
    },
    "Installations metric fetched"
  );
});

publicRouter.get(
  "/leads/duplicate-check",
  validateQuery(duplicatePhoneQuerySchema),
  async (req: Request, res: Response) => {
    const query = req.query as z.infer<typeof duplicatePhoneQuerySchema>;
    const count = await countActiveLeadsByPhone(query.phone);

    return ok(
      res,
      {
        phone: query.phone,
        isDuplicate: count > 0,
        count
      },
      "Duplicate phone check completed"
    );
  }
);

function assertCommunicationWebhookAuthorized(req: Request, bodySecret?: string) {
  const configuredSecret = env.COMMUNICATION_WEBHOOK_SECRET?.trim();
  if (!configuredSecret) {
    throw new AppError(
      503,
      "COMMUNICATION_WEBHOOK_NOT_CONFIGURED",
      "Communication webhook secret is not configured"
    );
  }

  const providedSecret =
    req.headers["x-communication-webhook-secret"]?.toString().trim() ||
    bodySecret?.trim() ||
    "";

  if (providedSecret !== configuredSecret) {
    throw new AppError(401, "UNAUTHORIZED", "Invalid communication webhook secret");
  }
}

publicRouter.get(
  "/communications/unsubscribe",
  validateQuery(unsubscribeTokenQuerySchema),
  async (req: Request, res: Response) => {
    const { token } = req.query as unknown as z.infer<typeof unsubscribeTokenQuerySchema>;
    const updated = await unsubscribeFromToken({
      token,
      ipAddress: requestIp(req)
    });

    return ok(
      res,
      {
        leadId: updated.id,
        emailOptOut: updated.emailOptOut,
        whatsappOptOut: updated.whatsappOptOut,
        optOutTimestamp: updated.optOutTimestamp,
        optOutSource: updated.optOutSource
      },
      "Communication preferences updated"
    );
  }
);

publicRouter.post(
  "/communications/unsubscribe",
  validateBody(unsubscribeTokenBodySchema),
  async (req: Request, res: Response) => {
    const { token } = req.body as z.infer<typeof unsubscribeTokenBodySchema>;
    const updated = await unsubscribeFromToken({
      token,
      ipAddress: requestIp(req)
    });

    return ok(
      res,
      {
        leadId: updated.id,
        emailOptOut: updated.emailOptOut,
        whatsappOptOut: updated.whatsappOptOut,
        optOutTimestamp: updated.optOutTimestamp,
        optOutSource: updated.optOutSource
      },
      "Communication preferences updated"
    );
  }
);

publicRouter.post(
  "/communications/stop",
  validateBody(stopOptOutBodySchema),
  async (req: Request, res: Response) => {
    const body = req.body as z.infer<typeof stopOptOutBodySchema>;
    assertCommunicationWebhookAuthorized(req, body.secret);

    if (body.channel === "SMS") {
      const updated = await markLeadSmsDndByPhone({
        phone: body.phone!,
        source: body.source ?? "STOP_WEBHOOK",
        ipAddress: requestIp(req)
      });
      return ok(
        res,
        {
          leadId: updated.id,
          smsDndStatus: updated.smsDndStatus,
          optOutTimestamp: updated.optOutTimestamp,
          optOutSource: updated.optOutSource
        },
        "SMS DND preference updated"
      );
    }

    const updated = await applyLeadChannelOptOutByContact({
      channel: body.channel,
      email: body.email,
      phone: body.phone,
      source: body.source ?? "STOP_WEBHOOK",
      ipAddress: requestIp(req)
    });

    return ok(
      res,
      {
        leadId: updated.id,
        emailOptOut: updated.emailOptOut,
        whatsappOptOut: updated.whatsappOptOut,
        optOutTimestamp: updated.optOutTimestamp,
        optOutSource: updated.optOutSource
      },
      "Communication preferences updated"
    );
  }
);

async function createPublicLead(req: Request, res: Response) {
  const payload = req.body as z.infer<typeof publicLeadSubmissionSchema>;

  const shouldVerifyRecaptcha = enforceRecaptchaOnPublicLead && Boolean(resolveRecaptchaSecret());
  const rawRecaptchaToken = payload.recaptchaToken?.trim() ?? "";
  if (shouldVerifyRecaptcha) {
    if (!rawRecaptchaToken) {
      throw new AppError(
        400,
        "RECAPTCHA_TOKEN_REQUIRED",
        "Lead submission failed. Please refresh and try again."
      );
    }

    const recaptchaResult = await verifyRecaptchaToken({
      token: rawRecaptchaToken,
      expectedAction: "public_lead_submit",
      remoteIp: requestIp(req)
    });

    if (!recaptchaResult.ok) {
      if (recaptchaResult.reason === "SECRET_MISSING") {
        console.error("RECAPTCHA_CONFIG_ERROR", {
          reason: recaptchaResult.reason,
          requestId: req.requestId ?? null
        });
        throw new AppError(
          500,
          "RECAPTCHA_CONFIG_ERROR",
          "Lead submission failed. Please try again later."
        );
      }

      if (recaptchaResult.reason === "VERIFY_REQUEST_FAILED") {
        throw new AppError(
          502,
          "RECAPTCHA_VERIFY_FAILED",
          "Lead submission failed. Please try again."
        );
      }

      throw new AppError(
        400,
        "RECAPTCHA_VERIFICATION_FAILED",
        "Lead submission failed. Please refresh and try again."
      );
    }

    payload.recaptchaScore = recaptchaResult.score ?? undefined;
  }

  const submission = await submitPublicLeadWithSms({
    name: payload.name,
    phone: payload.phone,
    email: payload.email,
    monthlyBill: payload.monthlyBill,
    districtId: payload.districtId,
    state: payload.state,
    installationType: payload.installationType,
    message: payload.message,
    utmSource: payload.utmSource,
    utmMedium: payload.utmMedium,
    utmCampaign: payload.utmCampaign,
    utmTerm: payload.utmTerm,
    utmContent: payload.utmContent,
    recaptchaScore: payload.recaptchaScore,
    consentGiven: payload.consentGiven,
    sourceIp: requestIp(req)
  });

  try {
    await createAuditLog({
      action: "PUBLIC_LEAD_SUBMITTED",
      entityType: "public_lead_submission",
      entityId: submission.id,
      detailsJson: {
        submissionId: submission.id,
        externalId: submission.externalId,
        mirroredLeadId: submission.mirroredLeadId ?? null,
        districtId: payload.districtId,
        phone: payload.phone,
        email: payload.email ?? null,
        recaptchaTokenPresent: Boolean(payload.recaptchaToken),
        consentGiven: payload.consentGiven
      },
      ipAddress: requestIp(req)
    });
  } catch (error) {
    console.error("PUBLIC_LEAD_AUDIT_LOG_FAILED", {
      submissionId: submission.id,
      requestId: req.requestId ?? null,
      error
    });
  }

  return created(
    res,
    {
      id: submission.id,
      externalId: submission.externalId
    },
    "Consultation request submitted"
  );
}

publicRouter.post(
  "/leads",
  publicLeadSubmissionRateLimit,
  validateBody(publicLeadSubmissionSchema),
  async (req: Request, res: Response) => {
    return createPublicLead(req, res);
  }
);

publicRouter.post(
  "/lead-submission",
  publicLeadSubmissionRateLimit,
  validateBody(publicLeadSubmissionSchema),
  async (req: Request, res: Response) => {
    return createPublicLead(req, res);
  }
);
