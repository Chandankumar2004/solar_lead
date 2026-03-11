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
  queueLeadStatusCustomerNotification,
  triggerNewLeadNotification,
  triggerOverdueLeadNotification
} from "../services/notification.service.js";
import { createAuditLog, requestIp } from "../services/audit-log.service.js";
import { validateBody, validateParams, validateQuery } from "../middleware/validate.js";
import { AppError } from "../lib/errors.js";

export const leadsRouter = Router();

const leadIdParamSchema = z.object({
  id: z.string().uuid()
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
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    search: z.string().trim().optional(),
    q: z.string().trim().optional(),
    status: z.string().trim().optional(),
    statusIds: z.string().trim().optional(),
    statusId: z.string().uuid().optional(),
    districtId: z.string().uuid().optional(),
    district: z.string().uuid().optional(),
    state: z.string().trim().optional(),
    execId: z.string().uuid().optional(),
    assignedExecutiveId: z.string().uuid().optional(),
    type: z.string().trim().optional(),
    installationType: z.string().trim().optional(),
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
    state: value.state || undefined,
    execId: value.execId || value.assignedExecutiveId || undefined,
    type: value.type || value.installationType || undefined,
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

const customerDetailsBodySchema = z.object({
  fullName: z.preprocess(emptyToUndefined, z.string().min(2).max(120).optional()),
  dateOfBirth: z.preprocess(
    emptyToUndefined,
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "dateOfBirth must be YYYY-MM-DD").optional()
  ),
  gender: z.preprocess(emptyToUndefined, z.string().max(30).optional()),
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
  propertyOwnership: z.preprocess(emptyToUndefined, z.string().max(100).optional()),
  roofArea: optionalPositiveNumber,
  recommendedCapacity: optionalPositiveNumber,
  shadowFreeArea: optionalPositiveNumber,
  roofType: z.preprocess(emptyToUndefined, z.string().max(100).optional()),
  verifiedMonthlyBill: optionalPositiveNumber,
  connectionType: z.preprocess(emptyToUndefined, z.string().max(100).optional()),
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
}) {
  return {
    id: detail.id,
    fullName: detail.fullName,
    dateOfBirth: detail.dateOfBirth ? detail.dateOfBirth.toISOString().slice(0, 10) : null,
    gender: detail.gender,
    fatherHusbandName: detail.fatherHusbandName,
    aadhaarMasked: maskSensitiveLast4(detail.aadhaarEncrypted),
    panNumber: detail.panEncrypted ? detail.panEncrypted.toUpperCase() : null,
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

  if (query.search) {
    whereClauses.push({
      OR: [
        { name: { contains: query.search, mode: "insensitive" } },
        { phone: { contains: query.search, mode: "insensitive" } },
        { email: { contains: query.search, mode: "insensitive" } }
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

  if (query.districtId) {
    whereClauses.push({ districtId: query.districtId });
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

  const skip = (query.page - 1) * query.pageSize;
  const [total, leads] = await prisma.$transaction([
    prisma.lead.count({ where }),
    prisma.lead.findMany({
      where,
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

    const lead = await prisma.lead.findUnique({
      where: { id },
      include: detailInclude
    });
    if (!lead) {
      throw new AppError(404, "NOT_FOUND", "Lead not found");
    }

    return ok(res, lead, "Lead detail fetched");
  }
);

leadsRouter.get(
  "/:id/allowed-next-statuses",
  validateParams(leadIdParamSchema),
  async (req: Request, res: Response) => {
    const { id } = req.params as z.infer<typeof leadIdParamSchema>;

    const lead = await prisma.lead.findUnique({
      where: { id },
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

    const lead = await prisma.lead.findUnique({
      where: { id },
      select: {
        id: true,
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

    return ok(
      res,
      {
        leadId: lead.id,
        currentStatus: lead.currentStatus,
        isEditable,
        customerDetail: lead.customerDetail
          ? toCustomerDetailResponse(lead.customerDetail)
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

    const lead = await prisma.lead.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        districtId: true,
        currentStatus: {
          select: {
            id: true,
            name: true,
            isTerminal: true
          }
        }
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

    const customerDetail = await prisma.customerDetail.upsert({
      where: { leadId: lead.id },
      create: createData,
      update: updateData
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
        customerDetail: toCustomerDetailResponse(customerDetail)
      },
      "Customer details saved"
    );
  }
);

leadsRouter.patch(
  "/:id",
  validateParams(leadIdParamSchema),
  validateBody(patchLeadSchema),
  async (req: Request, res: Response) => {
    const { id } = req.params as z.infer<typeof leadIdParamSchema>;
    const payload = req.body as z.infer<typeof patchLeadSchema>;

    const existing = await prisma.lead.findUnique({
      where: { id },
      select: {
        id: true,
        externalId: true,
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

    if (payload.assignedExecutiveId) {
      const executive = await prisma.user.findUnique({
        where: { id: payload.assignedExecutiveId },
        select: { id: true, role: true, status: true }
      });
      if (!executive || executive.role !== "EXECUTIVE") {
        throw new AppError(400, "INVALID_EXECUTIVE", "assignedExecutiveId must be an executive");
      }
    }

    if (payload.assignedManagerId) {
      const manager = await prisma.user.findUnique({
        where: { id: payload.assignedManagerId },
        select: { id: true, role: true, status: true }
      });
      if (!manager || manager.role !== "MANAGER") {
        throw new AppError(400, "INVALID_MANAGER", "assignedManagerId must be a manager");
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
    }

    return ok(res, updated, "Lead updated");
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

    return created(res, lead, "Lead created");
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
      const lead = await prisma.lead.findUnique({
        where: { id },
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
        select: { id: true, name: true, isTerminal: true }
      });
      if (!toStatus) {
        throw new AppError(400, "INVALID_STATUS", "Target status not found");
      }

      const isAllowed = await assertValidTransition(lead.currentStatusId, parsed.nextStatusId);
      if (!isAllowed) {
        throw new AppError(
          400,
          "INVALID_STATUS_TRANSITION",
          "Transition not allowed by workflow configuration"
        );
      }

      const movingOutOfTerminal = lead.currentStatus.isTerminal && !toStatus.isTerminal;
      if (movingOutOfTerminal && req.user.role !== "SUPER_ADMIN") {
        throw new AppError(
          403,
          "TERMINAL_STATUS_LOCKED",
          "Cannot move out of terminal status without Super Admin override"
        );
      }
      if (movingOutOfTerminal && !parsed.overrideReason) {
        throw new AppError(
          400,
          "OVERRIDE_REASON_REQUIRED",
          "overrideReason is required when overriding terminal status"
        );
      }

      const historyNotes = movingOutOfTerminal
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
        action: movingOutOfTerminal
          ? "LEAD_STATUS_CHANGED_WITH_TERMINAL_OVERRIDE"
          : "LEAD_STATUS_CHANGED",
        detailsJson: {
          leadId: lead.id,
          fromStatusId: lead.currentStatusId,
          toStatusId: parsed.nextStatusId,
          movingOutOfTerminal,
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
