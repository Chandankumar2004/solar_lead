import { Prisma } from "@prisma/client";
import { Request, Response, Router } from "express";
import { z } from "zod";
import { createLeadSchema, transitionLeadSchema } from "@solar/shared";
import { allowRoles } from "../middleware/rbac.js";
import { created, ok } from "../lib/http.js";
import { prisma } from "../lib/prisma.js";
import { resolveLeadAutoAssignment } from "../services/lead-assignment.service.js";
import {
  assertValidTransition,
  getAssignedLeadStatus,
  getNewLeadStatus
} from "../services/lead-status.service.js";
import {
  notifyActiveAdmins,
  notifyUsers,
  queueLeadStatusCustomerNotification,
  triggerNewLeadNotification,
  triggerOverdueLeadNotification
} from "../services/notification.service.js";
import { createAuditLog, requestIp } from "../services/audit-log.service.js";
import { validateBody, validateParams, validateQuery } from "../middleware/validate.js";
import { AppError } from "../lib/errors.js";
import {
  assertDistrictAccessForLeadCreation,
  scopeLeadWhere
} from "../services/lead-access.service.js";

export const leadsRouter = Router();

const leadIdParamSchema = z.object({
  id: z.string().uuid()
});

const internalNoteBodySchema = z.object({
  note: z.string().trim().min(3).max(2000)
});

const leadTransitionSchema = transitionLeadSchema
  .extend({
    overrideReason: z.string().trim().min(5).max(500).optional(),
    override_reason: z.string().trim().min(5).max(500).optional()
  })
  .transform((value) => ({
    nextStatusId: value.nextStatusId,
    notes: value.notes,
    overrideReason: value.overrideReason ?? value.override_reason
  }));

const optionalBooleanQuery = z.preprocess(
  (input) => {
    if (input === undefined) return undefined;
    if (typeof input === "boolean") return input;
    if (typeof input === "string") {
      const normalized = input.trim().toLowerCase();
      if (normalized === "true") return true;
      if (normalized === "false") return false;
    }
    return input;
  },
  z.boolean().optional()
);

const listLeadsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(10),
    search: z.string().trim().optional(),
    q: z.string().trim().optional(),
    status: z.string().trim().optional(),
    statusIds: z.string().trim().optional(),
    statusId: z.string().uuid().optional(),
    districtId: z.string().uuid().optional(),
    districtIds: z.string().trim().optional(),
    district: z.string().uuid().optional(),
    state: z.string().trim().optional(),
    execId: z.string().uuid().optional(),
    assignedExecutiveId: z.string().uuid().optional(),
    type: z.string().trim().optional(),
    installationType: z.string().trim().optional(),
    source: z.string().trim().optional(),
    utmSource: z.string().trim().optional(),
    isOverdue: optionalBooleanQuery,
    overdue: optionalBooleanQuery,
    dateFrom: z.string().trim().optional(),
    dateTo: z.string().trim().optional()
  })
  .transform((value) => ({
    page: value.page,
    pageSize: value.pageSize,
    search: value.search || value.q || undefined,
    statusIds: value.statusIds || undefined,
    status: value.statusId || value.status || undefined,
    districtId: value.districtId || value.district || undefined,
    districtIds: value.districtIds || undefined,
    state: value.state || undefined,
    execId: value.execId || value.assignedExecutiveId || undefined,
    type: value.type || value.installationType || undefined,
    source: value.source || value.utmSource || undefined,
    isOverdue:
      value.isOverdue !== undefined ? value.isOverdue : value.overdue,
    dateFrom: value.dateFrom,
    dateTo: value.dateTo
  }));

const nullablePositiveNumber = z.preprocess(
  (input) => {
    if (input === undefined) return undefined;
    if (input === null || input === "") return null;
    if (typeof input === "string") {
      const parsed = Number(input);
      return Number.isNaN(parsed) ? input : parsed;
    }
    return input;
  },
  z.union([z.number().positive(), z.null()]).optional()
);

const patchLeadSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    phone: z.string().trim().min(8).max(20).optional(),
    email: z.union([z.string().trim().email(), z.literal(""), z.null()]).optional(),
    monthlyBill: nullablePositiveNumber,
    monthly_bill: nullablePositiveNumber,
    districtId: z.string().uuid().optional(),
    district_id: z.string().uuid().optional(),
    state: z.union([z.string().trim().min(2).max(100), z.literal(""), z.null()]).optional(),
    installationType: z.string().trim().min(2).max(100).optional(),
    installation_type: z.string().trim().min(2).max(100).optional(),
    message: z.union([z.string().trim().max(1000), z.literal(""), z.null()]).optional(),
    assignedExecutiveId: z.union([z.string().uuid(), z.null()]).optional(),
    assigned_executive_id: z.union([z.string().uuid(), z.null()]).optional(),
    assignedManagerId: z.union([z.string().uuid(), z.null()]).optional(),
    assigned_manager_id: z.union([z.string().uuid(), z.null()]).optional(),
    isOverdue: z.boolean().optional(),
    is_overdue: z.boolean().optional(),
    reassignmentReason: z.string().trim().min(5).max(500).optional(),
    reassignment_reason: z.string().trim().min(5).max(500).optional()
  })
  .superRefine((value, ctx) => {
    if (Object.keys(value).length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [],
        message: "At least one field is required"
      });
    }
  })
  .transform((value) => ({
    name: value.name,
    phone: value.phone,
    email:
      value.email === undefined ? undefined : value.email === "" ? null : value.email,
    monthlyBill:
      value.monthlyBill !== undefined ? value.monthlyBill : value.monthly_bill,
    districtId: value.districtId ?? value.district_id,
    state: value.state === undefined ? undefined : value.state === "" ? null : value.state,
    installationType: value.installationType ?? value.installation_type,
    message:
      value.message === undefined ? undefined : value.message === "" ? null : value.message,
    assignedExecutiveId:
      value.assignedExecutiveId !== undefined
        ? value.assignedExecutiveId
        : value.assigned_executive_id,
    assignedManagerId:
      value.assignedManagerId !== undefined
        ? value.assignedManagerId
        : value.assigned_manager_id,
    isOverdue:
      value.isOverdue !== undefined ? value.isOverdue : value.is_overdue,
    reassignmentReason:
      value.reassignmentReason !== undefined
        ? value.reassignmentReason
        : value.reassignment_reason
  }));

function emptyToUndefined(input: unknown) {
  if (input === undefined || input === null) return undefined;
  if (typeof input !== "string") return input;
  const trimmed = input.trim();
  return trimmed === "" ? undefined : trimmed;
}

const optionalPositiveNumber = z.preprocess(
  (input) => {
    const normalized = emptyToUndefined(input);
    if (normalized === undefined) return undefined;
    if (typeof normalized === "number") return normalized;
    const parsed = Number(normalized);
    return Number.isNaN(parsed) ? normalized : parsed;
  },
  z.number().positive().optional()
);

const optionalNonNegativeNumber = z.preprocess(
  (input) => {
    const normalized = emptyToUndefined(input);
    if (normalized === undefined) return undefined;
    if (typeof normalized === "number") return normalized;
    if (typeof normalized === "string") {
      const parsed = Number(normalized.trim());
      return Number.isNaN(parsed) ? normalized : parsed;
    }
    return normalized;
  },
  z.number().min(0).optional()
);

const optionalBoolean = z.preprocess(
  (input) => {
    if (input === undefined) return undefined;
    if (typeof input === "boolean") return input;
    if (typeof input === "string") {
      const normalized = input.trim().toLowerCase();
      if (normalized === "true") return true;
      if (normalized === "false") return false;
    }
    return input;
  },
  z.boolean().optional()
);

const INSTALLATION_TYPE_OPTIONS = [
  "Residential",
  "Industrial",
  "Agricultural",
  "Other"
] as const;

const GENDER_OPTIONS = ["Male", "Female", "Other"] as const;
const PROPERTY_OWNERSHIP_OPTIONS = ["Owned", "Rented", "Leased"] as const;
const ROOF_TYPE_OPTIONS = ["RCC", "Tin", "Other"] as const;
const CONNECTION_TYPE_OPTIONS = ["Single Phase", "Three Phase"] as const;
const SHADOW_FREE_AREA_OPTIONS = ["Yes", "Partial", "No"] as const;
const SITE_PHOTO_REQUIRED_MIN = 3;
const SITE_PHOTO_ALLOWED_MAX = 10;
const SITE_PHOTO_CATEGORY_PREFIXES = ["site_photo", "site_photograph"] as const;

function resolveAllowedOption(
  input: unknown,
  allowed: readonly string[]
) {
  if (typeof input !== "string") {
    return input;
  }
  const trimmed = input.trim();
  if (!trimmed) {
    return undefined;
  }
  const match = allowed.find((value) => value.toLowerCase() === trimmed.toLowerCase());
  return match ?? trimmed;
}

function decimalToNumber(value: Prisma.Decimal | null | undefined) {
  return value === null || value === undefined ? undefined : Number(value);
}

function resolveShadowFreeAreaInput(input: unknown) {
  if (typeof input !== "string") return input;
  const normalized = input.trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized === "yes") return 1;
  if (normalized === "partial") return 0.5;
  if (normalized === "no") return 0;
  return input;
}

function sitePhotoCategoryFilter(): Prisma.StringFilter[] {
  return SITE_PHOTO_CATEGORY_PREFIXES.map((prefix) => ({
    startsWith: prefix,
    mode: "insensitive"
  }));
}

const customerDetailsBodySchema = z.object({
  fullName: z.preprocess(emptyToUndefined, z.string().min(2).max(120).optional()),
  dateOfBirth: z.preprocess(
    emptyToUndefined,
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "dateOfBirth must be YYYY-MM-DD").optional()
  ),
  gender: z.preprocess(
    (input) => resolveAllowedOption(emptyToUndefined(input), GENDER_OPTIONS),
    z.enum(GENDER_OPTIONS).optional()
  ),
  fatherHusbandName: z.preprocess(emptyToUndefined, z.string().max(120).optional()),
  aadhaarNumber: z.preprocess(
    (input) => {
      const normalized = emptyToUndefined(input);
      if (normalized === undefined) return undefined;
      if (typeof normalized !== "string") return normalized;
      return normalized.replace(/\D/g, "");
    },
    z.string().regex(/^\d{12}$/, "aadhaarNumber must be 12 digits").optional()
  ),
  panNumber: z.preprocess(
    (input) => {
      const normalized = emptyToUndefined(input);
      if (normalized === undefined) return undefined;
      if (typeof normalized !== "string") return normalized;
      return normalized.toUpperCase().replace(/\s/g, "");
    },
    z
      .string()
      .regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, "panNumber must match PAN format")
      .optional()
  ),
  addressLine1: z.preprocess(emptyToUndefined, z.string().max(200).optional()),
  addressLine2: z.preprocess(emptyToUndefined, z.string().max(200).optional()),
  villageLocality: z.preprocess(emptyToUndefined, z.string().max(120).optional()),
  pincode: z.preprocess(
    emptyToUndefined,
    z.string().regex(/^\d{6}$/, "pincode must be 6 digits").optional()
  ),
  districtId: z.preprocess(emptyToUndefined, z.string().uuid().optional()),
  alternatePhone: z.preprocess(emptyToUndefined, z.string().max(20).optional()),
  propertyOwnership: z.preprocess(
    (input) => resolveAllowedOption(emptyToUndefined(input), PROPERTY_OWNERSHIP_OPTIONS),
    z.enum(PROPERTY_OWNERSHIP_OPTIONS).optional()
  ),
  installationType: z.preprocess(
    (input) => resolveAllowedOption(emptyToUndefined(input), INSTALLATION_TYPE_OPTIONS),
    z.enum(INSTALLATION_TYPE_OPTIONS).optional()
  ),
  roofArea: optionalPositiveNumber,
  recommendedCapacity: optionalPositiveNumber,
  shadowFreeArea: z.preprocess(resolveShadowFreeAreaInput, optionalNonNegativeNumber),
  roofType: z.preprocess(
    (input) => resolveAllowedOption(emptyToUndefined(input), ROOF_TYPE_OPTIONS),
    z.enum(ROOF_TYPE_OPTIONS).optional()
  ),
  verifiedMonthlyBill: optionalPositiveNumber,
  connectionType: z.preprocess(
    (input) => resolveAllowedOption(emptyToUndefined(input), CONNECTION_TYPE_OPTIONS),
    z.enum(CONNECTION_TYPE_OPTIONS).optional()
  ),
  consumerNumber: z.preprocess(emptyToUndefined, z.string().max(100).optional()),
  discomName: z.preprocess(emptyToUndefined, z.string().max(120).optional()),
  bankAccountNumber: z.preprocess(
    (input) => {
      const normalized = emptyToUndefined(input);
      if (normalized === undefined) return undefined;
      if (typeof normalized !== "string") return normalized;
      return normalized.replace(/\s/g, "");
    },
    z.string().min(6).max(34).optional()
  ),
  bankName: z.preprocess(emptyToUndefined, z.string().max(120).optional()),
  ifscCode: z.preprocess(
    (input) => {
      const normalized = emptyToUndefined(input);
      if (normalized === undefined) return undefined;
      if (typeof normalized !== "string") return normalized;
      return normalized.toUpperCase().replace(/\s/g, "");
    },
    z
      .string()
      .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "ifscCode must be valid IFSC")
      .optional()
  ),
  accountHolderName: z.preprocess(emptyToUndefined, z.string().max(120).optional()),
  loanRequired: optionalBoolean,
  loanAmountRequired: optionalPositiveNumber,
  preferredLender: z.preprocess(emptyToUndefined, z.string().max(120).optional())
});

function parseDateOnly(value: string | undefined) {
  if (!value) return undefined;
  return new Date(`${value}T00:00:00.000Z`);
}

function canEditCustomerDetails(role: string, isTerminal: boolean) {
  if (!isTerminal) return true;
  return role === "SUPER_ADMIN" || role === "ADMIN";
}

function maskSensitiveLast4(value: string | null | undefined) {
  if (!value) return null;
  const compact = value.replace(/\s/g, "");
  if (!compact) return null;
  if (compact.length <= 4) return compact;
  return `${"*".repeat(compact.length - 4)}${compact.slice(-4)}`;
}

function canViewUnmaskedSensitiveLeadData(role: string) {
  return role === "SUPER_ADMIN" || role === "ADMIN";
}

type CustomerDetailResponseOptions = {
  includeSensitiveFields?: boolean;
};

function toCustomerDetailResponse(detail: {
  id: string;
  fullName: string;
  dateOfBirth: Date | null;
  gender: string | null;
  fatherHusbandName: string | null;
  aadhaarEncrypted: string | null;
  panEncrypted: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  villageLocality: string | null;
  pincode: string | null;
  districtId: string | null;
  alternatePhone: string | null;
  propertyOwnership: string | null;
  roofArea: Prisma.Decimal | null;
  recommendedCapacity: Prisma.Decimal | null;
  shadowFreeArea: Prisma.Decimal | null;
  roofType: string | null;
  verifiedMonthlyBill: Prisma.Decimal | null;
  connectionType: string | null;
  consumerNumber: string | null;
  discomName: string | null;
  bankAccountEncrypted: string | null;
  bankName: string | null;
  ifscCode: string | null;
  accountHolderName: string | null;
  loanRequired: boolean;
  loanAmountRequired: Prisma.Decimal | null;
  preferredLender: string | null;
  createdAt: Date;
  updatedAt: Date;
}, options: CustomerDetailResponseOptions = {}) {
  const includeSensitiveFields = options.includeSensitiveFields ?? false;
  const panNumber = detail.panEncrypted ? detail.panEncrypted.toUpperCase() : null;
  return {
    id: detail.id,
    fullName: detail.fullName,
    dateOfBirth: detail.dateOfBirth ? detail.dateOfBirth.toISOString().slice(0, 10) : null,
    gender: detail.gender,
    fatherHusbandName: detail.fatherHusbandName,
    aadhaarMasked: maskSensitiveLast4(detail.aadhaarEncrypted),
    panNumber: includeSensitiveFields ? panNumber : null,
    panMasked: maskSensitiveLast4(panNumber),
    addressLine1: detail.addressLine1,
    addressLine2: detail.addressLine2,
    villageLocality: detail.villageLocality,
    pincode: detail.pincode,
    districtId: detail.districtId,
    alternatePhone: detail.alternatePhone,
    propertyOwnership: detail.propertyOwnership,
    roofArea: detail.roofArea ? Number(detail.roofArea) : null,
    recommendedCapacity: detail.recommendedCapacity ? Number(detail.recommendedCapacity) : null,
    shadowFreeArea: detail.shadowFreeArea ? Number(detail.shadowFreeArea) : null,
    roofType: detail.roofType,
    verifiedMonthlyBill: detail.verifiedMonthlyBill ? Number(detail.verifiedMonthlyBill) : null,
    connectionType: detail.connectionType,
    consumerNumber: detail.consumerNumber,
    discomName: detail.discomName,
    bankAccountMasked: maskSensitiveLast4(detail.bankAccountEncrypted),
    bankName: detail.bankName,
    ifscCode: detail.ifscCode,
    accountHolderName: detail.accountHolderName,
    loanRequired: detail.loanRequired,
    loanAmountRequired: detail.loanAmountRequired ? Number(detail.loanAmountRequired) : null,
    preferredLender: detail.preferredLender,
    createdAt: detail.createdAt,
    updatedAt: detail.updatedAt
  };
}

type CustomerDetailResponseInput = Parameters<typeof toCustomerDetailResponse>[0];

type LeadResponseLike = {
  customerDetail?: CustomerDetailResponseInput | null;
  [key: string]: unknown;
};

const LEAD_INTERNAL_NOTE_ACTION = "LEAD_INTERNAL_NOTE_ADDED";

function canAccessInternalNotes(role: string) {
  return (
    role === "SUPER_ADMIN" ||
    role === "ADMIN" ||
    role === "MANAGER" ||
    role === "EXECUTIVE"
  );
}

function sanitizeLeadResponseForRole<T extends LeadResponseLike | null>(lead: T, role: string): T {
  if (!lead || typeof lead !== "object") {
    return lead;
  }

  const includeSensitiveFields = canViewUnmaskedSensitiveLeadData(role);
  return {
    ...lead,
    customerDetail: lead.customerDetail
      ? toCustomerDetailResponse(lead.customerDetail, { includeSensitiveFields })
      : null
  } as T;
}

function toInternalNoteResponse(entry: {
  id: string;
  createdAt: Date;
  detailsJson: Prisma.JsonValue | null;
  actorUser: { id: string; fullName: string; email: string } | null;
}) {
  const details =
    entry.detailsJson && typeof entry.detailsJson === "object"
      ? (entry.detailsJson as Record<string, unknown>)
      : {};
  const noteValue = typeof details.note === "string" ? details.note : "";
  return {
    id: entry.id,
    note: noteValue,
    createdAt: entry.createdAt,
    actor: entry.actorUser
      ? {
          id: entry.actorUser.id,
          fullName: entry.actorUser.fullName,
          email: entry.actorUser.email
        }
      : null
  };
}

async function fetchLeadInternalNotes(leadId: string) {
  const entries = await prisma.auditLog.findMany({
    where: {
      entityType: "lead",
      entityId: leadId,
      action: LEAD_INTERNAL_NOTE_ACTION
    },
    orderBy: { createdAt: "desc" },
    include: {
      actorUser: {
        select: {
          id: true,
          fullName: true,
          email: true
        }
      }
    }
  });

  return entries.map(toInternalNoteResponse);
}

async function fetchLeadActivityLog(leadId: string, role: string) {
  const activityWhere: Prisma.AuditLogWhereInput = {
    OR: [
      { entityType: "lead", entityId: leadId },
      {
        detailsJson: {
          path: ["leadId"],
          equals: leadId
        }
      }
    ]
  };

  if (!canAccessInternalNotes(role)) {
    activityWhere.NOT = {
      action: LEAD_INTERNAL_NOTE_ACTION
    };
  }

  const logs = await prisma.auditLog.findMany({
    where: activityWhere,
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      actorUser: {
        select: {
          id: true,
          fullName: true,
          email: true
        }
      }
    }
  });

  return logs.map((entry) => ({
    id: entry.id,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    details: entry.detailsJson,
    ipAddress: entry.ipAddress,
    createdAt: entry.createdAt,
    actor: entry.actorUser
      ? {
          id: entry.actorUser.id,
          fullName: entry.actorUser.fullName,
          email: entry.actorUser.email
        }
      : null
  }));
}

function parseDateBoundary(
  raw: string | undefined,
  field: "dateFrom" | "dateTo"
) {
  if (!raw) return undefined;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw new AppError(400, "VALIDATION_ERROR", `${field} must be a valid date`);
  }
  if (!raw.includes("T")) {
    if (field === "dateFrom") {
      date.setHours(0, 0, 0, 0);
    } else {
      date.setHours(23, 59, 59, 999);
    }
  }
  return date;
}

function isUuid(value: string) {
  return z.string().uuid().safeParse(value).success;
}

const listInclude = {
  currentStatus: {
    select: {
      id: true,
      name: true,
      isTerminal: true,
      colorCode: true
    }
  },
  district: {
    select: {
      id: true,
      name: true,
      state: true
    }
  },
  assignedExecutive: {
    select: {
      id: true,
      fullName: true,
      email: true,
      phone: true
    }
  }
} satisfies Prisma.LeadInclude;

const detailInclude = {
  currentStatus: true,
  district: true,
  assignedExecutive: {
    select: {
      id: true,
      fullName: true,
      email: true,
      phone: true,
      status: true
    }
  },
  assignedManager: {
    select: {
      id: true,
      fullName: true,
      email: true,
      phone: true,
      status: true
    }
  },
  customerDetail: true,
  documents: {
    orderBy: { createdAt: "desc" },
    include: {
      uploadedByUser: {
        select: { id: true, fullName: true, email: true }
      },
      reviewedByUser: {
        select: { id: true, fullName: true, email: true }
      }
    }
  },
  payments: {
    orderBy: { createdAt: "desc" },
    include: {
      collectedByUser: {
        select: { id: true, fullName: true, email: true }
      },
      verifiedByUser: {
        select: { id: true, fullName: true, email: true }
      }
    }
  },
  loanDetails: true,
  notificationLogs: {
    orderBy: { createdAt: "desc" },
    include: {
      template: {
        select: {
          id: true,
          name: true,
          channel: true
        }
      }
    }
  },
  statusHistory: {
    orderBy: { createdAt: "desc" },
    include: {
      fromStatus: {
        select: { id: true, name: true }
      },
      toStatus: {
        select: { id: true, name: true }
      },
      changedByUser: {
        select: { id: true, fullName: true, email: true }
      }
    }
  }
} satisfies Prisma.LeadInclude;

leadsRouter.use(
  allowRoles("SUPER_ADMIN", "ADMIN", "DISTRICT_MANAGER", "FIELD_EXECUTIVE")
);

leadsRouter.get("/", validateQuery(listLeadsQuerySchema), async (req: Request, res: Response) => {
  const query = req.query as unknown as z.infer<typeof listLeadsQuerySchema>;
  const dateFrom = parseDateBoundary(query.dateFrom, "dateFrom");
  const dateTo = parseDateBoundary(query.dateTo, "dateTo");

  if (dateFrom && dateTo && dateFrom > dateTo) {
    throw new AppError(400, "VALIDATION_ERROR", "dateFrom cannot be greater than dateTo");
  }

  const whereClauses: Prisma.LeadWhereInput[] = [];
  const statusIds = query.statusIds
    ? query.statusIds
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
    : [];
  const districtIds = query.districtIds
    ? query.districtIds
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
    : [];

  if (query.search) {
    const isSearchUuid = isUuid(query.search);
    whereClauses.push({
      OR: [
        { name: { contains: query.search, mode: "insensitive" } },
        { phone: { contains: query.search, mode: "insensitive" } },
        { email: { contains: query.search, mode: "insensitive" } },
        { externalId: query.search },
        ...(isSearchUuid ? [{ id: query.search }] : [])
      ]
    });
  }

  if (statusIds.length > 0) {
    const hasInvalidStatusId = statusIds.some((value) => !isUuid(value));
    if (hasInvalidStatusId) {
      throw new AppError(
        400,
        "VALIDATION_ERROR",
        "statusIds must contain comma-separated UUID values"
      );
    }
    whereClauses.push({
      currentStatusId: { in: statusIds }
    });
  } else if (query.status) {
    if (isUuid(query.status)) {
      whereClauses.push({ currentStatusId: query.status });
    } else {
      const status = await prisma.leadStatus.findFirst({
        where: { name: { equals: query.status, mode: "insensitive" } },
        select: { id: true }
      });
      if (!status) {
        return ok(
          res,
          [],
          "Leads fetched",
          {
            page: query.page,
            pageSize: query.pageSize,
            total: 0,
            totalPages: 0
          }
        );
      }
      whereClauses.push({
        currentStatusId: status.id
      });
    }
  }

  const requestedDistrictIds = [
    ...new Set(
      [query.districtId, ...districtIds].filter(
        (value): value is string => typeof value === "string" && value.length > 0
      )
    )
  ];
  if (requestedDistrictIds.length > 0) {
    const hasInvalidDistrictId = requestedDistrictIds.some((value) => !isUuid(value));
    if (hasInvalidDistrictId) {
      throw new AppError(
        400,
        "VALIDATION_ERROR",
        "districtIds must contain UUID values"
      );
    }
    whereClauses.push({ districtId: { in: requestedDistrictIds } });
  }

  if (query.state) {
    whereClauses.push({
      OR: [
        {
          state: { equals: query.state, mode: "insensitive" }
        },
        {
          district: {
            is: {
              state: { equals: query.state, mode: "insensitive" }
            }
          }
        }
      ]
    });
  }

  if (query.execId) {
    whereClauses.push({ assignedExecutiveId: query.execId });
  }

  if (query.type) {
    whereClauses.push({
      installationType: { equals: query.type, mode: "insensitive" }
    });
  }

  if (query.source) {
    whereClauses.push({
      utmSource: { contains: query.source, mode: "insensitive" }
    });
  }

  if (query.isOverdue !== undefined) {
    whereClauses.push({
      isOverdue: query.isOverdue
    });
  }

  if (dateFrom || dateTo) {
    whereClauses.push({
      createdAt: {
        ...(dateFrom ? { gte: dateFrom } : {}),
        ...(dateTo ? { lte: dateTo } : {})
      }
    });
  }

  const where: Prisma.LeadWhereInput =
    whereClauses.length > 0 ? { AND: whereClauses } : {};
  const scopedWhere = scopeLeadWhere(req.user!, where);

  const skip = (query.page - 1) * query.pageSize;
  const [total, leads] = await prisma.$transaction([
    prisma.lead.count({ where: scopedWhere }),
    prisma.lead.findMany({
      where: scopedWhere,
      skip,
      take: query.pageSize,
      orderBy: { createdAt: "desc" },
      include: listInclude
    })
  ]);

  return ok(
    res,
    leads,
    "Leads fetched",
    {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / query.pageSize)
    }
  );
});

leadsRouter.get(
  "/:id",
  validateParams(leadIdParamSchema),
  async (req: Request, res: Response) => {
    const { id } = req.params as z.infer<typeof leadIdParamSchema>;

    const lead = await prisma.lead.findFirst({
      where: scopeLeadWhere(req.user!, { id }),
      include: detailInclude
    });
    if (!lead) {
      throw new AppError(404, "NOT_FOUND", "Lead not found");
    }

    const canViewNotes = canAccessInternalNotes(req.user!.role);
    const [internalNotes, activityLog] = await Promise.all([
      canViewNotes ? fetchLeadInternalNotes(id) : Promise.resolve([]),
      fetchLeadActivityLog(id, req.user!.role)
    ]);

    return ok(
      res,
      sanitizeLeadResponseForRole(
        {
          ...lead,
          internalNotes,
          activityLog
        },
        req.user!.role
      ),
      "Lead detail fetched"
    );
  }
);

leadsRouter.get(
  "/:id/internal-notes",
  validateParams(leadIdParamSchema),
  async (req: Request, res: Response) => {
    if (!canAccessInternalNotes(req.user!.role)) {
      throw new AppError(403, "FORBIDDEN", "You cannot view internal notes");
    }

    const { id } = req.params as z.infer<typeof leadIdParamSchema>;
    const lead = await prisma.lead.findFirst({
      where: scopeLeadWhere(req.user!, { id }),
      select: { id: true }
    });
    if (!lead) {
      throw new AppError(404, "NOT_FOUND", "Lead not found");
    }

    const notes = await fetchLeadInternalNotes(id);
    return ok(res, notes, "Internal notes fetched");
  }
);

leadsRouter.post(
  "/:id/internal-notes",
  validateParams(leadIdParamSchema),
  validateBody(internalNoteBodySchema),
  async (req: Request, res: Response) => {
    if (!canAccessInternalNotes(req.user!.role)) {
      throw new AppError(403, "FORBIDDEN", "You cannot add internal notes");
    }

    const { id } = req.params as z.infer<typeof leadIdParamSchema>;
    const { note } = req.body as z.infer<typeof internalNoteBodySchema>;

    const lead = await prisma.lead.findFirst({
      where: scopeLeadWhere(req.user!, { id }),
      select: { id: true }
    });
    if (!lead) {
      throw new AppError(404, "NOT_FOUND", "Lead not found");
    }

    const createdLog = await prisma.auditLog.create({
      data: {
        actorUserId: req.user?.id,
        action: LEAD_INTERNAL_NOTE_ACTION,
        entityType: "lead",
        entityId: id,
        detailsJson: {
          leadId: id,
          note,
          visibility: "internal"
        },
        ipAddress: requestIp(req)
      },
      include: {
        actorUser: {
          select: {
            id: true,
            fullName: true,
            email: true
          }
        }
      }
    });

    return created(res, toInternalNoteResponse(createdLog), "Internal note added");
  }
);

leadsRouter.get(
  "/:id/activity-log",
  validateParams(leadIdParamSchema),
  async (req: Request, res: Response) => {
    const { id } = req.params as z.infer<typeof leadIdParamSchema>;
    const lead = await prisma.lead.findFirst({
      where: scopeLeadWhere(req.user!, { id }),
      select: { id: true }
    });
    if (!lead) {
      throw new AppError(404, "NOT_FOUND", "Lead not found");
    }

    const activityLog = await fetchLeadActivityLog(id, req.user!.role);
    return ok(res, activityLog, "Lead activity log fetched");
  }
);

leadsRouter.get(
  "/:id/allowed-next-statuses",
  validateParams(leadIdParamSchema),
  async (req: Request, res: Response) => {
    const { id } = req.params as z.infer<typeof leadIdParamSchema>;

    const lead = await prisma.lead.findFirst({
      where: scopeLeadWhere(req.user!, { id }),
      select: {
        id: true,
        currentStatusId: true,
        currentStatus: {
          select: {
            id: true,
            name: true,
            isTerminal: true,
            colorCode: true,
            requiresNote: true,
            requiresDocument: true
          }
        }
      }
    });
    if (!lead) {
      throw new AppError(404, "NOT_FOUND", "Lead not found");
    }

    const nextStatuses = await prisma.leadStatus.findMany({
      where: {
        toTransitions: {
          some: {
            fromStatusId: lead.currentStatusId
          }
        }
      },
      orderBy: [{ orderIndex: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        name: true,
        isTerminal: true,
        colorCode: true,
        requiresNote: true,
        requiresDocument: true
      }
    });

    return ok(
      res,
      {
        leadId: lead.id,
        currentStatus: lead.currentStatus,
        nextStatuses
      },
      "Allowed next statuses fetched"
    );
  }
);

leadsRouter.get(
  "/:id/customer-details",
  validateParams(leadIdParamSchema),
  async (req: Request, res: Response) => {
    const { id } = req.params as z.infer<typeof leadIdParamSchema>;

    const lead = await prisma.lead.findFirst({
      where: scopeLeadWhere(req.user!, { id }),
      select: {
        id: true,
        districtId: true,
        state: true,
        installationType: true,
        district: {
          select: {
            id: true,
            name: true,
            state: true
          }
        },
        currentStatus: {
          select: {
            id: true,
            name: true,
            isTerminal: true
          }
        },
        customerDetail: true
      }
    });
    if (!lead) {
      throw new AppError(404, "NOT_FOUND", "Lead not found");
    }

    const isEditable = canEditCustomerDetails(
      req.user!.role,
      lead.currentStatus.isTerminal
    );

    const sitePhotoCount = await prisma.document.count({
      where: {
        leadId: lead.id,
        isLatest: true,
        OR: sitePhotoCategoryFilter().map((category) => ({ category }))
      }
    });

    return ok(
      res,
      {
        leadId: lead.id,
        currentStatus: lead.currentStatus,
        isEditable,
        leadPrefill: {
          districtId: lead.district?.id ?? lead.districtId,
          districtName: lead.district?.name ?? null,
          state: lead.state ?? lead.district?.state ?? null,
          installationType: lead.installationType ?? null
        },
        sitePhotographs: {
          count: sitePhotoCount,
          minRequired: SITE_PHOTO_REQUIRED_MIN,
          maxAllowed: SITE_PHOTO_ALLOWED_MAX
        },
        customerDetail: lead.customerDetail
          ? toCustomerDetailResponse(lead.customerDetail, {
              includeSensitiveFields: canViewUnmaskedSensitiveLeadData(req.user!.role)
            })
          : null
      },
      "Customer details fetched"
    );
  }
);

leadsRouter.put(
  "/:id/customer-details",
  validateParams(leadIdParamSchema),
  validateBody(customerDetailsBodySchema),
  async (req: Request, res: Response) => {
    const { id } = req.params as z.infer<typeof leadIdParamSchema>;
    const payload = req.body as z.infer<typeof customerDetailsBodySchema>;

    const lead = await prisma.lead.findFirst({
      where: scopeLeadWhere(req.user!, { id }),
      select: {
        id: true,
        name: true,
        districtId: true,
        state: true,
        installationType: true,
        district: {
          select: {
            id: true,
            name: true,
            state: true
          }
        },
        currentStatus: {
          select: {
            id: true,
            name: true,
            isTerminal: true
          }
        },
        customerDetail: true
      }
    });
    if (!lead) {
      throw new AppError(404, "NOT_FOUND", "Lead not found");
    }

    const isEditable = canEditCustomerDetails(
      req.user!.role,
      lead.currentStatus.isTerminal
    );
    if (!isEditable) {
      throw new AppError(
        403,
        "TERMINAL_STATUS_LOCKED",
        "Customer details cannot be edited once lead is in terminal status"
      );
    }

    if (payload.districtId) {
      const districtExists = await prisma.district.findUnique({
        where: { id: payload.districtId },
        select: { id: true }
      });
      if (!districtExists) {
        throw new AppError(400, "INVALID_DISTRICT", "districtId is invalid");
      }
    }

    const effective = {
      fullName: payload.fullName ?? lead.customerDetail?.fullName ?? lead.name,
      dateOfBirth:
        payload.dateOfBirth ??
        (lead.customerDetail?.dateOfBirth
          ? lead.customerDetail.dateOfBirth.toISOString().slice(0, 10)
          : undefined),
      gender: payload.gender ?? lead.customerDetail?.gender ?? undefined,
      fatherHusbandName:
        payload.fatherHusbandName ?? lead.customerDetail?.fatherHusbandName ?? undefined,
      aadhaarNumber: payload.aadhaarNumber ?? lead.customerDetail?.aadhaarEncrypted ?? undefined,
      panNumber: payload.panNumber ?? lead.customerDetail?.panEncrypted ?? undefined,
      addressLine1: payload.addressLine1 ?? lead.customerDetail?.addressLine1 ?? undefined,
      villageLocality:
        payload.villageLocality ?? lead.customerDetail?.villageLocality ?? undefined,
      pincode: payload.pincode ?? lead.customerDetail?.pincode ?? undefined,
      districtId: payload.districtId ?? lead.customerDetail?.districtId ?? lead.districtId,
      state: lead.state ?? lead.district?.state ?? undefined,
      installationType:
        payload.installationType ?? lead.installationType ?? undefined,
      propertyOwnership:
        payload.propertyOwnership ?? lead.customerDetail?.propertyOwnership ?? undefined,
      roofArea: payload.roofArea ?? decimalToNumber(lead.customerDetail?.roofArea),
      recommendedCapacity:
        payload.recommendedCapacity ?? decimalToNumber(lead.customerDetail?.recommendedCapacity),
      shadowFreeArea: payload.shadowFreeArea ?? decimalToNumber(lead.customerDetail?.shadowFreeArea),
      roofType: payload.roofType ?? lead.customerDetail?.roofType ?? undefined,
      verifiedMonthlyBill:
        payload.verifiedMonthlyBill ?? decimalToNumber(lead.customerDetail?.verifiedMonthlyBill),
      connectionType: payload.connectionType ?? lead.customerDetail?.connectionType ?? undefined,
      consumerNumber: payload.consumerNumber ?? lead.customerDetail?.consumerNumber ?? undefined,
      discomName: payload.discomName ?? lead.customerDetail?.discomName ?? undefined,
      bankAccountNumber:
        payload.bankAccountNumber ?? lead.customerDetail?.bankAccountEncrypted ?? undefined,
      bankName: payload.bankName ?? lead.customerDetail?.bankName ?? undefined,
      ifscCode: payload.ifscCode ?? lead.customerDetail?.ifscCode ?? undefined,
      accountHolderName:
        payload.accountHolderName ?? lead.customerDetail?.accountHolderName ?? undefined,
      loanRequired:
        payload.loanRequired ?? lead.customerDetail?.loanRequired ?? false,
      loanAmountRequired:
        payload.loanAmountRequired ?? decimalToNumber(lead.customerDetail?.loanAmountRequired),
      photoCount: await prisma.document.count({
        where: {
          leadId: lead.id,
          isLatest: true,
          OR: sitePhotoCategoryFilter().map((category) => ({ category }))
        }
      })
    };

    const missingRequired: string[] = [];
    if (!effective.fullName) missingRequired.push("fullName");
    if (!effective.dateOfBirth) missingRequired.push("dateOfBirth");
    if (!effective.gender) missingRequired.push("gender");
    if (!effective.fatherHusbandName) missingRequired.push("fatherHusbandName");
    if (!effective.aadhaarNumber) missingRequired.push("aadhaarNumber");
    if (!effective.panNumber) missingRequired.push("panNumber");
    if (!effective.addressLine1) missingRequired.push("addressLine1");
    if (!effective.villageLocality) missingRequired.push("villageLocality");
    if (!effective.pincode) missingRequired.push("pincode");
    if (!effective.districtId) missingRequired.push("district");
    if (!effective.state) missingRequired.push("state");
    if (!effective.installationType) missingRequired.push("installationType");
    if (!effective.propertyOwnership) missingRequired.push("propertyOwnership");
    if (!effective.roofArea) missingRequired.push("roofArea");
    if (!effective.recommendedCapacity) missingRequired.push("recommendedCapacity");
    if (effective.shadowFreeArea === undefined || effective.shadowFreeArea === null) {
      missingRequired.push("shadowFreeArea");
    }
    if (!effective.roofType) missingRequired.push("roofType");
    if (!effective.verifiedMonthlyBill) missingRequired.push("verifiedMonthlyBill");
    if (!effective.connectionType) missingRequired.push("connectionType");
    if (!effective.consumerNumber) missingRequired.push("consumerNumber");
    if (!effective.discomName) missingRequired.push("discomName");
    if (!effective.bankAccountNumber) missingRequired.push("bankAccountNumber");
    if (!effective.bankName) missingRequired.push("bankName");
    if (!effective.ifscCode) missingRequired.push("ifscCode");
    if (!effective.accountHolderName) missingRequired.push("accountHolderName");

    if (missingRequired.length > 0) {
      throw new AppError(
        400,
        "CUSTOMER_DETAILS_REQUIRED_FIELDS_MISSING",
        `Missing required fields: ${missingRequired.join(", ")}`
      );
    }

    if (effective.loanRequired && !effective.loanAmountRequired) {
      throw new AppError(
        400,
        "LOAN_AMOUNT_REQUIRED",
        "loanAmountRequired is required when loanRequired is true"
      );
    }

    if (effective.photoCount < SITE_PHOTO_REQUIRED_MIN) {
      throw new AppError(
        400,
        "SITE_PHOTOS_REQUIRED",
        `At least ${SITE_PHOTO_REQUIRED_MIN} site photographs are required before submitting customer details`
      );
    }

    if (effective.photoCount > SITE_PHOTO_ALLOWED_MAX) {
      throw new AppError(
        400,
        "SITE_PHOTOS_LIMIT_EXCEEDED",
        `A maximum of ${SITE_PHOTO_ALLOWED_MAX} site photographs is allowed`
      );
    }

    const dateOfBirth = parseDateOnly(payload.dateOfBirth);
    const updateData: Prisma.CustomerDetailUncheckedUpdateInput = {
      ...(payload.fullName !== undefined ? { fullName: payload.fullName } : {}),
      ...(dateOfBirth !== undefined ? { dateOfBirth } : {}),
      ...(payload.gender !== undefined ? { gender: payload.gender } : {}),
      ...(payload.fatherHusbandName !== undefined
        ? { fatherHusbandName: payload.fatherHusbandName }
        : {}),
      ...(payload.aadhaarNumber !== undefined
        ? { aadhaarEncrypted: payload.aadhaarNumber }
        : {}),
      ...(payload.panNumber !== undefined ? { panEncrypted: payload.panNumber } : {}),
      ...(payload.addressLine1 !== undefined
        ? { addressLine1: payload.addressLine1 }
        : {}),
      ...(payload.addressLine2 !== undefined
        ? { addressLine2: payload.addressLine2 }
        : {}),
      ...(payload.villageLocality !== undefined
        ? { villageLocality: payload.villageLocality }
        : {}),
      ...(payload.pincode !== undefined ? { pincode: payload.pincode } : {}),
      ...(payload.districtId !== undefined ? { districtId: payload.districtId } : {}),
      ...(payload.alternatePhone !== undefined
        ? { alternatePhone: payload.alternatePhone }
        : {}),
      ...(payload.propertyOwnership !== undefined
        ? { propertyOwnership: payload.propertyOwnership }
        : {}),
      ...(payload.roofArea !== undefined ? { roofArea: payload.roofArea } : {}),
      ...(payload.recommendedCapacity !== undefined
        ? { recommendedCapacity: payload.recommendedCapacity }
        : {}),
      ...(payload.shadowFreeArea !== undefined
        ? { shadowFreeArea: payload.shadowFreeArea }
        : {}),
      ...(payload.roofType !== undefined ? { roofType: payload.roofType } : {}),
      ...(payload.verifiedMonthlyBill !== undefined
        ? { verifiedMonthlyBill: payload.verifiedMonthlyBill }
        : {}),
      ...(payload.connectionType !== undefined
        ? { connectionType: payload.connectionType }
        : {}),
      ...(payload.consumerNumber !== undefined
        ? { consumerNumber: payload.consumerNumber }
        : {}),
      ...(payload.discomName !== undefined ? { discomName: payload.discomName } : {}),
      ...(payload.bankAccountNumber !== undefined
        ? { bankAccountEncrypted: payload.bankAccountNumber }
        : {}),
      ...(payload.bankName !== undefined ? { bankName: payload.bankName } : {}),
      ...(payload.ifscCode !== undefined ? { ifscCode: payload.ifscCode } : {}),
      ...(payload.accountHolderName !== undefined
        ? { accountHolderName: payload.accountHolderName }
        : {}),
      ...(payload.loanRequired !== undefined
        ? { loanRequired: payload.loanRequired }
        : {}),
      ...(payload.loanAmountRequired !== undefined
        ? { loanAmountRequired: payload.loanAmountRequired }
        : {}),
      ...(payload.preferredLender !== undefined
        ? { preferredLender: payload.preferredLender }
        : {})
    };

    if (payload.loanRequired === false && payload.loanAmountRequired === undefined) {
      updateData.loanAmountRequired = null;
    }

    const createData: Prisma.CustomerDetailUncheckedCreateInput = {
      leadId: lead.id,
      fullName: payload.fullName ?? lead.name,
      ...(dateOfBirth !== undefined ? { dateOfBirth } : {}),
      ...(payload.gender !== undefined ? { gender: payload.gender } : {}),
      ...(payload.fatherHusbandName !== undefined
        ? { fatherHusbandName: payload.fatherHusbandName }
        : {}),
      ...(payload.aadhaarNumber !== undefined
        ? { aadhaarEncrypted: payload.aadhaarNumber }
        : {}),
      ...(payload.panNumber !== undefined ? { panEncrypted: payload.panNumber } : {}),
      ...(payload.addressLine1 !== undefined
        ? { addressLine1: payload.addressLine1 }
        : {}),
      ...(payload.addressLine2 !== undefined
        ? { addressLine2: payload.addressLine2 }
        : {}),
      ...(payload.villageLocality !== undefined
        ? { villageLocality: payload.villageLocality }
        : {}),
      ...(payload.pincode !== undefined ? { pincode: payload.pincode } : {}),
      ...(payload.districtId !== undefined
        ? { districtId: payload.districtId }
        : lead.districtId
          ? { districtId: lead.districtId }
          : {}),
      ...(payload.alternatePhone !== undefined
        ? { alternatePhone: payload.alternatePhone }
        : {}),
      ...(payload.propertyOwnership !== undefined
        ? { propertyOwnership: payload.propertyOwnership }
        : {}),
      ...(payload.roofArea !== undefined ? { roofArea: payload.roofArea } : {}),
      ...(payload.recommendedCapacity !== undefined
        ? { recommendedCapacity: payload.recommendedCapacity }
        : {}),
      ...(payload.shadowFreeArea !== undefined
        ? { shadowFreeArea: payload.shadowFreeArea }
        : {}),
      ...(payload.roofType !== undefined ? { roofType: payload.roofType } : {}),
      ...(payload.verifiedMonthlyBill !== undefined
        ? { verifiedMonthlyBill: payload.verifiedMonthlyBill }
        : {}),
      ...(payload.connectionType !== undefined
        ? { connectionType: payload.connectionType }
        : {}),
      ...(payload.consumerNumber !== undefined
        ? { consumerNumber: payload.consumerNumber }
        : {}),
      ...(payload.discomName !== undefined ? { discomName: payload.discomName } : {}),
      ...(payload.bankAccountNumber !== undefined
        ? { bankAccountEncrypted: payload.bankAccountNumber }
        : {}),
      ...(payload.bankName !== undefined ? { bankName: payload.bankName } : {}),
      ...(payload.ifscCode !== undefined ? { ifscCode: payload.ifscCode } : {}),
      ...(payload.accountHolderName !== undefined
        ? { accountHolderName: payload.accountHolderName }
        : {}),
      loanRequired: payload.loanRequired ?? false,
      ...(payload.loanAmountRequired !== undefined
        ? { loanAmountRequired: payload.loanAmountRequired }
        : {}),
      ...(payload.preferredLender !== undefined
        ? { preferredLender: payload.preferredLender }
        : {})
    };

    const customerDetail = await prisma.$transaction(async (tx) => {
      if (payload.installationType !== undefined) {
        await tx.lead.update({
          where: { id: lead.id },
          data: {
            installationType: payload.installationType
          }
        });
      }
      return tx.customerDetail.upsert({
        where: { leadId: lead.id },
        create: createData,
        update: updateData
      });
    });

    await createAuditLog({
      actorUserId: req.user?.id,
      action: "CUSTOMER_DETAILS_UPSERTED",
      entityType: "lead",
      entityId: lead.id,
      detailsJson: {
        leadId: lead.id,
        updatedFields: Object.keys(payload)
      },
      ipAddress: requestIp(req)
    });

    return ok(
      res,
      {
        leadId: lead.id,
        currentStatus: lead.currentStatus,
        isEditable,
        leadPrefill: {
          districtId: lead.district?.id ?? lead.districtId,
          districtName: lead.district?.name ?? null,
          state: lead.state ?? lead.district?.state ?? null,
          installationType: payload.installationType ?? lead.installationType ?? null
        },
        sitePhotographs: {
          count: effective.photoCount,
          minRequired: SITE_PHOTO_REQUIRED_MIN,
          maxAllowed: SITE_PHOTO_ALLOWED_MAX
        },
        customerDetail: toCustomerDetailResponse(customerDetail, {
          includeSensitiveFields: canViewUnmaskedSensitiveLeadData(req.user!.role)
        })
      },
      "Customer details saved"
    );
  }
);

leadsRouter.patch(
  "/:id",
  allowRoles("SUPER_ADMIN", "ADMIN", "DISTRICT_MANAGER"),
  validateParams(leadIdParamSchema),
  validateBody(patchLeadSchema),
  async (req: Request, res: Response) => {
    const { id } = req.params as z.infer<typeof leadIdParamSchema>;
    const payload = req.body as z.infer<typeof patchLeadSchema>;

    const existing = await prisma.lead.findFirst({
      where: scopeLeadWhere(req.user!, { id }),
      select: {
        id: true,
        externalId: true,
        districtId: true,
        assignedExecutiveId: true,
        assignedManagerId: true,
        isOverdue: true
      }
    });
    if (!existing) {
      throw new AppError(404, "NOT_FOUND", "Lead not found");
    }

    const isExecutiveAssignmentChanged =
      payload.assignedExecutiveId !== undefined &&
      payload.assignedExecutiveId !== existing.assignedExecutiveId;
    const isExecutiveReassignment =
      existing.assignedExecutiveId !== null && isExecutiveAssignmentChanged;
    const assignmentFieldsTouched =
      payload.assignedExecutiveId !== undefined || payload.assignedManagerId !== undefined;

    const actorRole = req.user!.role;
    const canReassignLead =
      actorRole === "SUPER_ADMIN" || actorRole === "ADMIN" || actorRole === "MANAGER";

    if (assignmentFieldsTouched && !canReassignLead) {
      throw new AppError(403, "FORBIDDEN", "You cannot reassign this lead");
    }

    if (isExecutiveReassignment && !payload.reassignmentReason) {
      throw new AppError(
        400,
        "REASSIGNMENT_REASON_REQUIRED",
        "reassignmentReason is required when changing assignedExecutiveId"
      );
    }

    if (payload.districtId) {
      const district = await prisma.district.findUnique({
        where: { id: payload.districtId },
        select: { id: true }
      });
      if (!district) {
        throw new AppError(400, "INVALID_DISTRICT", "Invalid districtId");
      }
    }

    const targetDistrictId = payload.districtId ?? existing.districtId;

    if (payload.assignedExecutiveId) {
      const executive = await prisma.user.findUnique({
        where: { id: payload.assignedExecutiveId },
        select: { id: true, role: true, status: true }
      });
      if (
        !executive ||
        executive.role !== "EXECUTIVE" ||
        executive.status !== "ACTIVE"
      ) {
        throw new AppError(
          400,
          "INVALID_EXECUTIVE",
          "assignedExecutiveId must be an active executive"
        );
      }
    }

    if (payload.assignedManagerId) {
      const manager = await prisma.user.findUnique({
        where: { id: payload.assignedManagerId },
        select: { id: true, role: true, status: true }
      });
      if (
        !manager ||
        manager.role !== "MANAGER" ||
        manager.status !== "ACTIVE"
      ) {
        throw new AppError(400, "INVALID_MANAGER", "assignedManagerId must be an active manager");
      }
    }

    if (actorRole === "MANAGER") {
      if (payload.districtId !== undefined && payload.districtId !== existing.districtId) {
        throw new AppError(
          403,
          "FORBIDDEN",
          "District managers cannot move leads across districts"
        );
      }

      if (
        payload.assignedManagerId !== undefined &&
        payload.assignedManagerId !== existing.assignedManagerId
      ) {
        throw new AppError(
          403,
          "FORBIDDEN",
          "District managers cannot reassign district manager ownership"
        );
      }

      if (payload.assignedExecutiveId !== undefined) {
        if (!payload.assignedExecutiveId) {
          throw new AppError(
            400,
            "INVALID_EXECUTIVE",
            "District managers can only reassign to an active executive in their district"
          );
        }

        if (!targetDistrictId) {
          throw new AppError(
            400,
            "INVALID_DISTRICT",
            "Lead district is required for district manager reassignment"
          );
        }

        const executiveAssignment = await prisma.userDistrictAssignment.findFirst({
          where: {
            userId: payload.assignedExecutiveId,
            districtId: targetDistrictId,
            user: {
              role: "EXECUTIVE",
              status: "ACTIVE"
            }
          },
          select: { id: true }
        });
        if (!executiveAssignment) {
          throw new AppError(
            400,
            "INVALID_EXECUTIVE_DISTRICT_SCOPE",
            "District manager can reassign only to executives mapped to the same district"
          );
        }
      }
    }

    const updated = await prisma.lead.update({
      where: { id },
      data: {
        ...(payload.name !== undefined ? { name: payload.name } : {}),
        ...(payload.phone !== undefined ? { phone: payload.phone } : {}),
        ...(payload.email !== undefined ? { email: payload.email } : {}),
        ...(payload.monthlyBill !== undefined
          ? { monthlyBill: payload.monthlyBill }
          : {}),
        ...(payload.districtId !== undefined ? { districtId: payload.districtId } : {}),
        ...(payload.state !== undefined ? { state: payload.state } : {}),
        ...(payload.installationType !== undefined
          ? { installationType: payload.installationType }
          : {}),
        ...(payload.message !== undefined ? { message: payload.message } : {}),
        ...(payload.assignedExecutiveId !== undefined
          ? { assignedExecutiveId: payload.assignedExecutiveId }
          : {}),
        ...(payload.assignedManagerId !== undefined
          ? { assignedManagerId: payload.assignedManagerId }
          : {}),
        ...(payload.isOverdue !== undefined ? { isOverdue: payload.isOverdue } : {})
      },
      include: detailInclude
    });

    if (payload.isOverdue === true && !existing.isOverdue) {
      await triggerOverdueLeadNotification({
        leadId: existing.id,
        reason: "Marked overdue from lead update"
      });
    }

    await createAuditLog({
      actorUserId: req.user?.id,
      action: "LEAD_UPDATED",
      entityType: "lead",
      entityId: id,
      detailsJson: payload,
      ipAddress: requestIp(req)
    });

    if (isExecutiveAssignmentChanged) {
      await createAuditLog({
        actorUserId: req.user?.id,
        action: "LEAD_REASSIGNED",
        entityType: "lead",
        entityId: id,
        detailsJson: {
          leadId: id,
          externalId: existing.externalId,
          fromAssignedExecutiveId: existing.assignedExecutiveId,
          toAssignedExecutiveId: payload.assignedExecutiveId ?? null,
          reassignmentReason: payload.reassignmentReason ?? null,
          isReassignment: isExecutiveReassignment
        },
        ipAddress: requestIp(req)
      });

      const reassignmentRecipients = [
        existing.assignedExecutiveId,
        payload.assignedExecutiveId ?? null
      ].filter((value): value is string => Boolean(value));

      if (reassignmentRecipients.length > 0) {
        await notifyUsers(
          reassignmentRecipients,
          "Lead reassigned",
          `Lead ${existing.externalId} has been reassigned.${payload.reassignmentReason ? ` Reason: ${payload.reassignmentReason}` : ""}`,
          {
            type: "INTERNAL",
            leadId: id,
            entityType: "lead",
            entityId: id,
            metadata: {
              fromAssignedExecutiveId: existing.assignedExecutiveId,
              toAssignedExecutiveId: payload.assignedExecutiveId ?? null,
              reassignmentReason: payload.reassignmentReason ?? null
            }
          }
        );
      }
    }

    return ok(
      res,
      sanitizeLeadResponseForRole(updated, req.user!.role),
      "Lead updated"
    );
  }
);

leadsRouter.delete(
  "/:id",
  allowRoles("SUPER_ADMIN"),
  validateParams(leadIdParamSchema),
  async (req: Request, res: Response) => {
    const { id } = req.params as z.infer<typeof leadIdParamSchema>;

    const existing = await prisma.lead.findUnique({
      where: { id },
      select: {
        id: true,
        externalId: true
      }
    });
    if (!existing) {
      throw new AppError(404, "NOT_FOUND", "Lead not found");
    }

    await prisma.$transaction(async (tx) => {
      await tx.notificationLog.deleteMany({ where: { leadId: id } });
      await tx.payment.deleteMany({ where: { leadId: id } });
      await tx.document.deleteMany({ where: { leadId: id } });
      await tx.loanDetail.deleteMany({ where: { leadId: id } });
      await tx.customerDetail.deleteMany({ where: { leadId: id } });
      await tx.leadStatusHistory.deleteMany({ where: { leadId: id } });
      await tx.lead.delete({ where: { id } });
    });

    await createAuditLog({
      actorUserId: req.user?.id,
      action: "LEAD_DELETED",
      entityType: "lead",
      entityId: id,
      detailsJson: {
        leadId: id,
        externalId: existing.externalId
      },
      ipAddress: requestIp(req)
    });

    return ok(res, { id }, "Lead deleted");
  }
);

leadsRouter.post(
  "/",
  allowRoles("SUPER_ADMIN", "ADMIN", "DISTRICT_MANAGER", "FIELD_EXECUTIVE"),
  validateBody(createLeadSchema),
  async (req: Request, res: Response) => {
    const { districtId, source, customer } = req.body as z.infer<typeof createLeadSchema>;
    await assertDistrictAccessForLeadCreation(req.user!, districtId);

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

    const autoAssignment = await resolveLeadAutoAssignment(districtId);
    if (!autoAssignment) {
      throw new AppError(
        400,
        "NO_ASSIGNEE_AVAILABLE",
        "No valid auto-assignment target is available. Ensure the district has at least one active district manager and active assignees."
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

    const autoAssignmentNote =
      autoAssignment.mode === "EXECUTIVE"
        ? "Auto-assigned to field executive"
        : `Auto-assigned to district manager. ${autoAssignment.fallbackReason}`;

    const lead = await prisma.$transaction(async (tx) => {
      const createdLead = await tx.lead.create({
        data: {
          name: customer.fullName,
          phone: customer.phone,
          email: customer.email,
          districtId,
          currentStatusId: newStatus.id,
          assignedExecutiveId: autoAssignment.assignedExecutiveId,
          assignedManagerId: autoAssignment.assignedManagerId,
          isOverdue: autoAssignment.flagged,
          message: source,
          customerDetail: {
            create: {
              fullName: customer.fullName,
              alternatePhone: customer.phone,
              addressLine1: customer.address,
              districtId
            }
          },
          statusHistory: {
            create: {
              toStatusId: newStatus.id,
              changedByUserId: req.user!.id,
              notes: "Lead created"
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
              changedByUserId: req.user!.id,
              notes: autoAssignmentNote
            }
          }
        },
        include: detailInclude
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
      changedByUserId: req.user?.id,
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
      actorUserId: req.user?.id,
      entityType: "lead",
      entityId: lead.id,
      action: "LEAD_CREATED",
      detailsJson: {
        leadId: lead.id,
        externalId: lead.externalId,
        assignedExecutiveId: autoAssignment.assignedExecutiveId,
        assignedManagerId: autoAssignment.assignedManagerId,
        initialStatusId: newStatus.id
      },
      ipAddress: requestIp(req)
    });

    await createAuditLog({
      actorUserId: req.user?.id,
      entityType: "lead",
      entityId: lead.id,
      action: "LEAD_AUTO_ASSIGNED",
      detailsJson: {
        leadId: lead.id,
        externalId: lead.externalId,
        fromStatusId: newStatus.id,
        toStatusId: assignedStatus.id,
        assignmentMode: autoAssignment.mode,
        assignedExecutiveId: autoAssignment.assignedExecutiveId,
        assignedManagerId: autoAssignment.assignedManagerId,
        flagged: autoAssignment.flagged
      },
      ipAddress: requestIp(req)
    });

    if (autoAssignment.flagged) {
      await createAuditLog({
        actorUserId: req.user?.id,
        entityType: "lead",
        entityId: lead.id,
        action: "LEAD_AUTO_ASSIGNMENT_FALLBACK",
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
      sanitizeLeadResponseForRole(lead, req.user!.role),
      "Lead created"
    );
  }
);

leadsRouter.post(
  "/:id/transition",
  allowRoles("SUPER_ADMIN", "ADMIN", "DISTRICT_MANAGER", "FIELD_EXECUTIVE"),
  validateParams(leadIdParamSchema),
  validateBody(leadTransitionSchema),
  async (req: Request, res: Response) => {
    const parsed = req.body as z.infer<typeof leadTransitionSchema>;
    const { id } = req.params as z.infer<typeof leadIdParamSchema>;
    if (!req.user?.id) {
      throw new AppError(401, "UNAUTHORIZED", "Login required");
    }
    try {
      const lead = await prisma.lead.findFirst({
        where: scopeLeadWhere(req.user!, { id }),
        include: {
          currentStatus: {
            select: { id: true, name: true, isTerminal: true }
          }
        }
      });
      if (!lead) {
        throw new AppError(404, "NOT_FOUND", "Lead not found");
      }
      if (!lead.currentStatus) {
        throw new AppError(
          400,
          "INVALID_LEAD_STATUS",
          "Lead has invalid current status mapping"
        );
      }

      const toStatus = await prisma.leadStatus.findUnique({
        where: { id: parsed.nextStatusId },
        select: {
          id: true,
          name: true,
          isTerminal: true,
          requiresNote: true,
          requiresDocument: true
        }
      });
      if (!toStatus) {
        throw new AppError(400, "INVALID_STATUS", "Target status not found");
      }

      if (lead.currentStatusId === parsed.nextStatusId) {
        throw new AppError(
          400,
          "NO_STATUS_CHANGE",
          "Target status must be different from current status"
        );
      }

      const movingFromTerminal = lead.currentStatus.isTerminal;
      const hasOverrideReason =
        typeof parsed.overrideReason === "string" &&
        parsed.overrideReason.trim().length > 0;

      if (movingFromTerminal && req.user.role !== "SUPER_ADMIN") {
        throw new AppError(
          403,
          "TERMINAL_STATUS_LOCKED",
          "Cannot move a lead out of terminal status without Super Admin override"
        );
      }
      if (movingFromTerminal && !hasOverrideReason) {
        throw new AppError(
          400,
          "OVERRIDE_REASON_REQUIRED",
          "overrideReason is required when overriding terminal status movement"
        );
      }

      const isAllowed = await assertValidTransition(lead.currentStatusId, parsed.nextStatusId);
      if (!isAllowed && !movingFromTerminal) {
        throw new AppError(
          400,
          "INVALID_STATUS_TRANSITION",
          "Transition not allowed by workflow configuration"
        );
      }

      if (toStatus.requiresNote && (!parsed.notes || parsed.notes.trim().length === 0)) {
        throw new AppError(
          400,
          "TRANSITION_NOTE_REQUIRED",
          `A note is required when moving to "${toStatus.name}"`
        );
      }

      if (toStatus.requiresDocument) {
        const latestDocumentCount = await prisma.document.count({
          where: {
            leadId: lead.id,
            isLatest: true
          }
        });
        if (latestDocumentCount === 0) {
          throw new AppError(
            400,
            "TRANSITION_DOCUMENT_REQUIRED",
            `At least one document must be uploaded before moving to "${toStatus.name}"`
          );
        }
      }

      const historyNotes = movingFromTerminal
        ? [parsed.notes, `Override reason: ${parsed.overrideReason}`]
            .filter(Boolean)
            .join(" | ")
        : parsed.notes;

      const updated = await prisma.lead.update({
        where: { id: lead.id },
        data: {
          currentStatusId: parsed.nextStatusId,
          statusHistory: {
            create: {
              fromStatusId: lead.currentStatusId,
              toStatusId: parsed.nextStatusId,
              changedByUserId: req.user.id,
              notes: historyNotes
            }
          }
        },
        include: {
          currentStatus: true
        }
      });

      await createAuditLog({
        actorUserId: req.user?.id,
        entityType: "lead",
        entityId: lead.id,
        action: movingFromTerminal
          ? "LEAD_STATUS_CHANGED_WITH_TERMINAL_OVERRIDE"
          : "LEAD_STATUS_CHANGED",
        detailsJson: {
          leadId: lead.id,
          fromStatusId: lead.currentStatusId,
          toStatusId: parsed.nextStatusId,
          movingOutOfTerminal: movingFromTerminal,
          overrideReason: parsed.overrideReason ?? null
        },
        ipAddress: requestIp(req)
      });

      await queueLeadStatusCustomerNotification({
        leadId: lead.id,
        toStatusId: parsed.nextStatusId,
        changedByUserId: req.user?.id,
        transitionNotes: historyNotes ?? null
      });

      return ok(res, updated, "Status updated");
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        throw new AppError(
          400,
          "TRANSITION_WRITE_FAILED",
          `Transition failed due to database constraint (${error.code})`
        );
      }

      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new AppError(
          400,
          "TRANSITION_VALIDATION_FAILED",
          "Transition payload or relation mapping is invalid"
        );
      }

      throw new AppError(
        500,
        "TRANSITION_UNEXPECTED_ERROR",
        error instanceof Error ? error.message : "Unexpected transition failure"
      );
    }
  }
);
