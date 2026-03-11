import { Request, Response, Router } from "express";
import { z } from "zod";
import { created, ok } from "../lib/http.js";
import { validateBody, validateQuery } from "../middleware/validate.js";
import { publicLeadSubmissionRateLimit } from "../middleware/rate-limit.js";
import { createAuditLog, requestIp } from "../services/audit-log.service.js";
import { AppError } from "../lib/errors.js";
import { getPublicDistrictsPayload } from "../services/districts.service.js";
import { resolveRecaptchaSecret, verifyRecaptchaToken } from "../services/recaptcha.service.js";
import {
  countLeadsByPhone,
  countPublicSubmissionsByPhone,
  submitPublicLeadWithSms
} from "../services/public-lead-submission.service.js";

export const publicRouter = Router();

const publicLeadSubmissionSchema = z.object({
  name: z.string().min(2).max(120),
  phone: z.string().min(8).max(20),
  email: z.string().email().optional(),
  monthlyBill: z.number().positive().optional(),
  monthly_bill: z.number().positive().optional(),
  districtId: z.string().uuid().optional(),
  district_id: z.string().uuid().optional(),
  state: z.string().min(2).max(100).optional(),
  installationType: z.string().min(2).max(100).optional(),
  installation_type: z.string().min(2).max(100).optional(),
  message: z.string().max(1000).optional(),
  utmSource: z.string().max(100).optional(),
  utm_source: z.string().max(100).optional(),
  utmMedium: z.string().max(100).optional(),
  utm_medium: z.string().max(100).optional(),
  utmCampaign: z.string().max(100).optional(),
  utm_campaign: z.string().max(100).optional(),
  utmTerm: z.string().max(100).optional(),
  utm_term: z.string().max(100).optional(),
  utmContent: z.string().max(100).optional(),
  utm_content: z.string().max(100).optional(),
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
  })
  .transform((data) => ({
    name: data.name,
    phone: data.phone,
    email: data.email,
    monthlyBill: data.monthlyBill ?? data.monthly_bill,
    districtId: data.districtId ?? data.district_id!,
    state: data.state,
    installationType: data.installationType ?? data.installation_type,
    message: data.message,
    utmSource: data.utmSource ?? data.utm_source,
    utmMedium: data.utmMedium ?? data.utm_medium,
    utmCampaign: data.utmCampaign ?? data.utm_campaign,
    utmTerm: data.utmTerm ?? data.utm_term,
    utmContent: data.utmContent ?? data.utm_content,
    recaptchaScore: data.recaptchaScore ?? data.recaptcha_score,
    recaptchaToken: data.recaptchaToken ?? data.recaptcha_token,
    consentGiven: data.consentGiven ?? data.consent_given ?? false
  }));

const duplicatePhoneQuerySchema = z.object({
  phone: z.string().min(8).max(20)
});

publicRouter.get("/districts", async (_req, res) => {
  const payload = await getPublicDistrictsPayload();
  return ok(res, payload, "District list and mapping fetched");
});

publicRouter.get("/district-mapping", async (_req, res) => {
  const payload = await getPublicDistrictsPayload();
  return ok(res, payload, "District mapping fetched");
});

publicRouter.get(
  "/leads/duplicate-check",
  validateQuery(duplicatePhoneQuerySchema),
  async (req, res) => {
    const query = req.query as z.infer<typeof duplicatePhoneQuerySchema>;
    const leadCount = await countLeadsByPhone(query.phone);
    let publicSubmissionCount = 0;
    try {
      publicSubmissionCount = await countPublicSubmissionsByPhone(query.phone);
    } catch (error) {
      console.error("PUBLIC_DUPLICATE_CHECK_FALLBACK", {
        phone: query.phone,
        error
      });
    }
    const count = leadCount + publicSubmissionCount;

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

async function createPublicLead(req: Request, res: Response) {
  const payload = req.body as z.infer<typeof publicLeadSubmissionSchema>;

  const shouldVerifyRecaptcha = Boolean(resolveRecaptchaSecret());
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
  async (req, res) => {
    return createPublicLead(req, res);
  }
);

publicRouter.post(
  "/lead-submission",
  publicLeadSubmissionRateLimit,
  validateBody(publicLeadSubmissionSchema),
  async (req, res) => {
    return createPublicLead(req, res);
  }
);
