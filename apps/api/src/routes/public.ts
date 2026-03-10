import { Request, Response, Router } from "express";
import { z } from "zod";
import { created, ok } from "../lib/http.js";
import { validateBody, validateQuery } from "../middleware/validate.js";
import { publicLeadSubmissionRateLimit } from "../middleware/rate-limit.js";
import { prisma } from "../lib/prisma.js";
import { resolveLeadAutoAssignment } from "../services/lead-assignment.service.js";
import { createAuditLog, requestIp } from "../services/audit-log.service.js";
import { AppError } from "../lib/errors.js";
import { getPublicDistrictsPayload } from "../services/districts.service.js";
import { resolveRecaptchaSecret, verifyRecaptchaToken } from "../services/recaptcha.service.js";
import {
  assertValidTransition,
  getAssignedLeadStatus,
  getNewLeadStatus
} from "../services/lead-status.service.js";
import {
  notifyActiveAdmins,
  queueLeadStatusCustomerNotification,
  triggerNewLeadNotification,
  triggerOverdueLeadNotification
} from "../services/notification.service.js";

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
    const leadCount = await prisma.lead.count({ where: { phone: query.phone } });

    return ok(
      res,
      {
        phone: query.phone,
        isDuplicate: leadCount > 0,
        count: leadCount
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

  const newStatus = await getNewLeadStatus();
  if (!newStatus) {
    throw new AppError(
      400,
      "NO_STATUS_CONFIG",
      'Lead status "New" (or "New Lead") is not configured'
    );
  }

  const assignedStatus = await getAssignedLeadStatus();
  if (!assignedStatus) {
    throw new AppError(
      400,
      "NO_STATUS_CONFIG",
      'Lead status "Assigned" is not configured'
    );
  }

  const autoAssignment = await resolveLeadAutoAssignment(payload.districtId);
  if (!autoAssignment) {
    throw new AppError(
      400,
      "NO_ASSIGNEE_AVAILABLE",
      "No active executive or district manager is available for this district"
    );
  }

  const isNewToAssignedAllowed = await assertValidTransition(
    newStatus.id,
    assignedStatus.id
  );
  if (!isNewToAssignedAllowed) {
    throw new AppError(
      400,
      "AUTO_ASSIGN_TRANSITION_NOT_ALLOWED",
      'Transition "New -> Assigned" is not allowed in lead status transition config'
    );
  }

  const historyActorUserId =
    autoAssignment.assignedExecutiveId ?? autoAssignment.assignedManagerId;
  if (!historyActorUserId) {
    throw new AppError(500, "ASSIGNMENT_STATE_INVALID", "Lead assignment actor missing");
  }

  const autoAssignmentNote =
    autoAssignment.mode === "EXECUTIVE"
      ? "Auto-assigned to field executive"
      : `Auto-assigned to district manager. ${autoAssignment.fallbackReason}`;

  const lead = await prisma.$transaction(async (tx) => {
    const createdLead = await tx.lead.create({
      data: {
        name: payload.name,
        phone: payload.phone,
        email: payload.email,
        monthlyBill: payload.monthlyBill,
        districtId: payload.districtId,
        state: payload.state,
        installationType: payload.installationType,
        message: payload.message,
        currentStatusId: newStatus.id,
        assignedExecutiveId: autoAssignment.assignedExecutiveId,
        assignedManagerId: autoAssignment.assignedManagerId,
        isOverdue: autoAssignment.flagged,
        utmSource: payload.utmSource,
        utmMedium: payload.utmMedium,
        utmCampaign: payload.utmCampaign,
        utmTerm: payload.utmTerm,
        utmContent: payload.utmContent,
        sourceIp: requestIp(req),
        recaptchaScore: payload.recaptchaScore,
        consentGiven: payload.consentGiven,
        consentTimestamp: payload.consentGiven ? new Date() : null,
        statusHistory: {
          create: {
            toStatusId: newStatus.id,
            changedByUserId: historyActorUserId,
            notes: "Lead created via public submission"
          }
        }
      }
    });

    return tx.lead.update({
      where: { id: createdLead.id },
      data: {
        currentStatusId: assignedStatus.id,
        statusHistory: {
          create: {
            fromStatusId: newStatus.id,
            toStatusId: assignedStatus.id,
            changedByUserId: historyActorUserId,
            notes: autoAssignmentNote
          }
        }
      }
    });
  });

  await triggerNewLeadNotification({
    leadId: lead.id,
    externalId: lead.externalId,
    assignedExecutiveId: autoAssignment.assignedExecutiveId,
    assignedManagerId: autoAssignment.assignedManagerId
  });

  await queueLeadStatusCustomerNotification({
    leadId: lead.id,
    toStatusId: assignedStatus.id,
    changedByUserId: historyActorUserId,
    transitionNotes: autoAssignmentNote
  });

  let alertedAdminIds: string[] = [];
  if (autoAssignment.flagged) {
    alertedAdminIds = await notifyActiveAdmins(
      "Executive unavailable in district",
      `Lead ${lead.externalId} was assigned to a district manager because no active executive was available.`
    );
  }

  await createAuditLog({
    action: "PUBLIC_LEAD_SUBMITTED",
    entityType: "lead",
    entityId: lead.id,
    detailsJson: {
      leadId: lead.id,
      externalId: lead.externalId,
      districtId: lead.districtId,
      initialStatusId: newStatus.id,
      assignedStatusId: assignedStatus.id,
      assignedExecutiveId: autoAssignment.assignedExecutiveId,
      assignedManagerId: autoAssignment.assignedManagerId,
      assignmentMode: autoAssignment.mode,
      flagged: autoAssignment.flagged,
      recaptchaTokenPresent: Boolean(payload.recaptchaToken)
    },
    ipAddress: requestIp(req)
  });

  await createAuditLog({
    action: "LEAD_AUTO_ASSIGNED",
    entityType: "lead",
    entityId: lead.id,
    detailsJson: {
      leadId: lead.id,
      externalId: lead.externalId,
      fromStatusId: newStatus.id,
      toStatusId: assignedStatus.id,
      assignedExecutiveId: autoAssignment.assignedExecutiveId,
      assignedManagerId: autoAssignment.assignedManagerId,
      assignmentMode: autoAssignment.mode,
      flagged: autoAssignment.flagged
    },
    ipAddress: requestIp(req)
  });

  if (autoAssignment.flagged) {
    await createAuditLog({
      action: "LEAD_AUTO_ASSIGNMENT_FALLBACK",
      entityType: "lead",
      entityId: lead.id,
      detailsJson: {
        leadId: lead.id,
        externalId: lead.externalId,
        fallbackReason: autoAssignment.fallbackReason,
        alertedAdminIds
      },
      ipAddress: requestIp(req)
    });

    await triggerOverdueLeadNotification({
      leadId: lead.id,
      reason: autoAssignment.fallbackReason
    });
  }

  return created(
    res,
    {
      id: lead.id,
      externalId: lead.externalId
    },
    "Lead submitted"
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
