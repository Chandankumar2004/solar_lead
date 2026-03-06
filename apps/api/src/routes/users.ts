import bcrypt from "bcryptjs";
import { Prisma, UserRole, UserStatus } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { created, ok } from "../lib/http.js";
import { AppError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { allowRoles } from "../middleware/rbac.js";
import { validateBody, validateParams, validateQuery } from "../middleware/validate.js";
import { createAuditLog, requestIp } from "../services/audit-log.service.js";
import {
  sendUserPendingApprovalEmail,
  sendUserRoleChangedEmail,
  sendUserStatusChangedEmail
} from "../services/email.service.js";
import { revokeAllUserRefreshSessions } from "../services/auth.service.js";

export const usersRouter = Router();

const BCRYPT_WORK_FACTOR = 12;
const FIELD_ROLES: UserRole[] = ["MANAGER", "EXECUTIVE"];
const ELEVATED_ROLES: UserRole[] = ["SUPER_ADMIN", "ADMIN"];

const userIdParamSchema = z.object({
  id: z.string().uuid()
});

const listUsersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
  search: z.string().trim().optional(),
  role: z.nativeEnum(UserRole).optional(),
  status: z.nativeEnum(UserStatus).optional(),
  districtId: z.string().uuid().optional()
});

const createUserSchema = z
  .object({
    email: z.string().trim().email(),
    password: z.string().min(12),
    fullName: z.string().trim().min(2).max(120),
    phone: z.union([z.string().trim().min(8).max(20), z.literal(""), z.null()]).optional(),
    role: z.nativeEnum(UserRole).default("EXECUTIVE"),
    employeeId: z
      .union([z.string().trim().min(2).max(50), z.literal(""), z.null()])
      .optional(),
    districtIds: z.array(z.string().uuid()).default([])
  })
  .transform((value) => ({
    email: value.email.toLowerCase(),
    password: value.password,
    fullName: value.fullName,
    phone: value.phone === "" ? null : value.phone ?? null,
    role: value.role,
    employeeId: value.employeeId === "" ? null : value.employeeId ?? null,
    districtIds: [...new Set(value.districtIds)]
  }));

const updateUserSchema = z
  .object({
    email: z.string().trim().email().optional(),
    fullName: z.string().trim().min(2).max(120).optional(),
    phone: z.union([z.string().trim().min(8).max(20), z.literal(""), z.null()]).optional(),
    role: z.nativeEnum(UserRole).optional(),
    employeeId: z
      .union([z.string().trim().min(2).max(50), z.literal(""), z.null()])
      .optional(),
    districtIds: z.array(z.string().uuid()).optional()
  })
  .superRefine((value, ctx) => {
    if (
      value.email === undefined &&
      value.fullName === undefined &&
      value.phone === undefined &&
      value.role === undefined &&
      value.employeeId === undefined &&
      value.districtIds === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "At least one field is required",
        path: []
      });
    }
  })
  .transform((value) => ({
    email: value.email?.toLowerCase(),
    fullName: value.fullName,
    phone: value.phone === undefined ? undefined : value.phone === "" ? null : value.phone,
    role: value.role,
    employeeId:
      value.employeeId === undefined
        ? undefined
        : value.employeeId === ""
          ? null
          : value.employeeId,
    districtIds: value.districtIds ? [...new Set(value.districtIds)] : undefined
  }));

const statusActionSchema = z.object({
  reason: z.union([z.string().trim().min(5).max(500), z.literal(""), z.null()]).optional()
});

const updateAssignmentsSchema = z.object({
  districtIds: z.array(z.string().uuid()).default([])
});

const userInclude = {
  districts: {
    select: {
      id: true,
      assignedAt: true,
      district: {
        select: {
          id: true,
          name: true,
          state: true,
          isActive: true
        }
      }
    },
    orderBy: {
      assignedAt: "desc"
    }
  }
} satisfies Prisma.UserInclude;

function roleLabel(role: UserRole) {
  if (role === "SUPER_ADMIN") return "Super Admin";
  if (role === "ADMIN") return "Admin";
  if (role === "MANAGER") return "District Manager";
  return "Field Executive";
}

function statusLabel(status: UserStatus) {
  if (status === "ACTIVE") return "Active";
  if (status === "PENDING") return "Pending";
  return "Suspended";
}

function isFieldRole(role: UserRole) {
  return FIELD_ROLES.includes(role);
}

function ensureCanManageRole(actorRole: UserRole, roleToManage: UserRole) {
  if (actorRole === "SUPER_ADMIN") {
    return;
  }
  if (actorRole === "ADMIN") {
    if (roleToManage === "SUPER_ADMIN" || roleToManage === "ADMIN") {
      throw new AppError(
        403,
        "FORBIDDEN",
        "Admins can only manage District Managers and Field Executives"
      );
    }
    return;
  }
  throw new AppError(403, "FORBIDDEN", "Only Super Admin or Admin can manage users");
}

function parseReason(value: string | null | undefined) {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function mapUser(
  user: Prisma.UserGetPayload<{
    include: typeof userInclude;
  }>
) {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    phone: user.phone,
    role: user.role,
    roleLabel: roleLabel(user.role),
    employeeId: user.employeeId,
    status: user.status,
    statusLabel: statusLabel(user.status),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    lastLoginAt: user.lastLoginAt,
    districtAssignments: user.districts.map((assignment) => ({
      id: assignment.id,
      assignedAt: assignment.assignedAt,
      district: assignment.district
    }))
  };
}

async function assertDistrictIdsExist(districtIds: string[]) {
  if (!districtIds.length) return;
  const districts = await prisma.district.findMany({
    where: { id: { in: districtIds } },
    select: { id: true }
  });
  if (districts.length !== districtIds.length) {
    throw new AppError(400, "INVALID_DISTRICT", "One or more district IDs are invalid");
  }
}

async function replaceUserDistrictAssignments(
  tx: Prisma.TransactionClient,
  userId: string,
  districtIds: string[]
) {
  await tx.userDistrictAssignment.deleteMany({
    where: { userId }
  });

  if (!districtIds.length) return;

  await tx.userDistrictAssignment.createMany({
    data: districtIds.map((districtId) => ({ userId, districtId })),
    skipDuplicates: true
  });
}

async function collectRoleChangeWarnings(input: {
  userId: string;
  currentRole: UserRole;
  nextRole: UserRole;
  existingDistrictAssignmentCount: number;
}) {
  const warnings: string[] = [];
  if (input.currentRole === input.nextRole) return warnings;

  warnings.push(
    `Role changed from ${roleLabel(input.currentRole)} to ${roleLabel(input.nextRole)}.`
  );

  if (ELEVATED_ROLES.includes(input.nextRole)) {
    warnings.push(
      `${roleLabel(input.nextRole)} has elevated permissions. Verify authorization before continuing.`
    );
  }

  if (input.currentRole === "EXECUTIVE" && input.nextRole !== "EXECUTIVE") {
    const activeExecLeadCount = await prisma.lead.count({
      where: {
        assignedExecutiveId: input.userId,
        currentStatus: {
          isTerminal: false
        }
      }
    });
    if (activeExecLeadCount > 0) {
      warnings.push(
        `${activeExecLeadCount} active non-terminal leads remain assigned to this executive.`
      );
    }
  }

  if (input.currentRole === "MANAGER" && input.nextRole !== "MANAGER") {
    const activeManagerLeadCount = await prisma.lead.count({
      where: {
        assignedManagerId: input.userId,
        currentStatus: {
          isTerminal: false
        }
      }
    });
    if (activeManagerLeadCount > 0) {
      warnings.push(
        `${activeManagerLeadCount} active non-terminal leads remain assigned to this manager.`
      );
    }
  }

  if (!isFieldRole(input.nextRole) && input.existingDistrictAssignmentCount > 0) {
    warnings.push(
      "District assignments will be removed because this role does not require district mapping."
    );
  }

  return warnings;
}

async function getUserOrFail(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: userInclude
  });
  if (!user) {
    throw new AppError(404, "NOT_FOUND", "User not found");
  }
  return user;
}

usersRouter.use(allowRoles("SUPER_ADMIN", "ADMIN"));

usersRouter.get("/", validateQuery(listUsersQuerySchema), async (req, res) => {
  const query = req.query as unknown as z.infer<typeof listUsersQuerySchema>;
  const actorRole = req.user!.role;

  if (
    actorRole === "ADMIN" &&
    query.role &&
    query.role !== "MANAGER" &&
    query.role !== "EXECUTIVE"
  ) {
    return ok(
      res,
      [],
      "Users fetched",
      {
        page: query.page,
        pageSize: query.pageSize,
        total: 0,
        totalPages: 0
      }
    );
  }

  const where: Prisma.UserWhereInput = {
    ...(query.role ? { role: query.role } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.search
      ? {
          OR: [
            { fullName: { contains: query.search, mode: "insensitive" } },
            { email: { contains: query.search, mode: "insensitive" } },
            { phone: { contains: query.search, mode: "insensitive" } },
            { employeeId: { contains: query.search, mode: "insensitive" } }
          ]
        }
      : {}),
    ...(query.districtId
      ? {
          districts: {
            some: {
              districtId: query.districtId
            }
          }
        }
      : {})
  };

  if (actorRole === "ADMIN" && !query.role) {
    where.role = {
      in: ["MANAGER", "EXECUTIVE"]
    };
  }

  const skip = (query.page - 1) * query.pageSize;

  const [total, users] = await prisma.$transaction([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      include: userInclude,
      skip,
      take: query.pageSize,
      orderBy: [{ createdAt: "desc" }, { fullName: "asc" }]
    })
  ]);

  return ok(
    res,
    users.map(mapUser),
    "Users fetched",
    {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / query.pageSize)
    }
  );
});

usersRouter.post("/", validateBody(createUserSchema), async (req, res) => {
  const body = req.body as z.infer<typeof createUserSchema>;
  const actor = req.user!;

  ensureCanManageRole(actor.role, body.role);
  await assertDistrictIdsExist(body.districtIds);

  const warnings: string[] = [];
  const districtIdsForCreate = isFieldRole(body.role) ? body.districtIds : [];
  if (!isFieldRole(body.role) && body.districtIds.length > 0) {
    warnings.push(
      "District assignments were ignored because only District Managers and Field Executives can be mapped to districts."
    );
  }

  const passwordHash = await bcrypt.hash(body.password, BCRYPT_WORK_FACTOR);

  try {
    const createdUser = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: body.email,
          passwordHash,
          fullName: body.fullName,
          phone: body.phone,
          role: body.role,
          employeeId: body.employeeId,
          status: "PENDING"
        }
      });

      if (districtIdsForCreate.length > 0) {
        await tx.userDistrictAssignment.createMany({
          data: districtIdsForCreate.map((districtId) => ({
            userId: user.id,
            districtId
          })),
          skipDuplicates: true
        });
      }

      return tx.user.findUniqueOrThrow({
        where: { id: user.id },
        include: userInclude
      });
    });

    await createAuditLog({
      actorUserId: actor.id,
      action: "USER_CREATED",
      entityType: "user",
      entityId: createdUser.id,
      detailsJson: {
        email: createdUser.email,
        role: createdUser.role,
        status: createdUser.status,
        districtIds: districtIdsForCreate,
        warnings
      },
      ipAddress: requestIp(req)
    });

    await sendUserPendingApprovalEmail({
      to: createdUser.email,
      fullName: createdUser.fullName,
      role: createdUser.role
    });

    return created(
      res,
      {
        user: mapUser(createdUser),
        warnings
      },
      "User created in pending status"
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new AppError(409, "CONFLICT", "User with same email or employee ID already exists");
    }
    throw error;
  }
});

usersRouter.get("/:id", validateParams(userIdParamSchema), async (req, res) => {
  const { id } = req.params as z.infer<typeof userIdParamSchema>;
  const user = await getUserOrFail(id);
  ensureCanManageRole(req.user!.role, user.role);

  const [activeExecutiveLeadCount, activeManagerLeadCount] = await Promise.all([
    prisma.lead.count({
      where: {
        assignedExecutiveId: id,
        currentStatus: {
          isTerminal: false
        }
      }
    }),
    prisma.lead.count({
      where: {
        assignedManagerId: id,
        currentStatus: {
          isTerminal: false
        }
      }
    })
  ]);

  return ok(res, {
    user: mapUser(user),
    workload: {
      activeExecutiveLeadCount,
      activeManagerLeadCount
    }
  });
});

usersRouter.patch(
  "/:id",
  validateParams(userIdParamSchema),
  validateBody(updateUserSchema),
  async (req, res) => {
    const { id } = req.params as z.infer<typeof userIdParamSchema>;
    const body = req.body as z.infer<typeof updateUserSchema>;
    const actor = req.user!;

    const existing = await getUserOrFail(id);
    ensureCanManageRole(actor.role, existing.role);

    if (body.role) {
      ensureCanManageRole(actor.role, body.role);
    }

    if (body.districtIds) {
      await assertDistrictIdsExist(body.districtIds);
    }

    const nextRole = body.role ?? existing.role;
    const warnings = await collectRoleChangeWarnings({
      userId: existing.id,
      currentRole: existing.role,
      nextRole,
      existingDistrictAssignmentCount: existing.districts.length
    });

    const shouldClearAssignmentsBecauseRole = !isFieldRole(nextRole);
    if (shouldClearAssignmentsBecauseRole && body.districtIds && body.districtIds.length > 0) {
      warnings.push(
        "Requested district assignments were ignored because the selected role does not support district mapping."
      );
    }

    try {
      const updated = await prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id },
          data: {
            ...(body.email !== undefined ? { email: body.email } : {}),
            ...(body.fullName !== undefined ? { fullName: body.fullName } : {}),
            ...(body.phone !== undefined ? { phone: body.phone } : {}),
            ...(body.role !== undefined ? { role: body.role } : {}),
            ...(body.employeeId !== undefined ? { employeeId: body.employeeId } : {})
          }
        });

        if (shouldClearAssignmentsBecauseRole) {
          await replaceUserDistrictAssignments(tx, id, []);
        } else if (body.districtIds !== undefined) {
          await replaceUserDistrictAssignments(tx, id, body.districtIds);
        }

        return tx.user.findUniqueOrThrow({
          where: { id },
          include: userInclude
        });
      });

      if (existing.role !== nextRole) {
        await createAuditLog({
          actorUserId: actor.id,
          action: "USER_ROLE_CHANGED",
          entityType: "user",
          entityId: updated.id,
          detailsJson: {
            fromRole: existing.role,
            toRole: nextRole,
            warnings
          },
          ipAddress: requestIp(req)
        });

        await sendUserRoleChangedEmail({
          to: updated.email,
          fullName: updated.fullName,
          previousRole: existing.role,
          nextRole,
          warnings
        });
      }

      await createAuditLog({
        actorUserId: actor.id,
        action: "USER_UPDATED",
        entityType: "user",
        entityId: updated.id,
        detailsJson: {
          changes: body,
          warnings
        },
        ipAddress: requestIp(req)
      });

      return ok(res, { user: mapUser(updated), warnings }, "User updated");
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new AppError(409, "CONFLICT", "User with same email or employee ID already exists");
      }
      throw error;
    }
  }
);

usersRouter.put(
  "/:id/district-assignments",
  validateParams(userIdParamSchema),
  validateBody(updateAssignmentsSchema),
  async (req, res) => {
    const { id } = req.params as z.infer<typeof userIdParamSchema>;
    const body = req.body as z.infer<typeof updateAssignmentsSchema>;
    const actor = req.user!;

    const existing = await getUserOrFail(id);
    ensureCanManageRole(actor.role, existing.role);
    await assertDistrictIdsExist(body.districtIds);

    if (!isFieldRole(existing.role)) {
      throw new AppError(
        400,
        "ROLE_NOT_ASSIGNABLE",
        "District assignments are only supported for District Manager and Field Executive roles"
      );
    }

    const updated = await prisma.$transaction(async (tx) => {
      await replaceUserDistrictAssignments(tx, id, body.districtIds);
      return tx.user.findUniqueOrThrow({
        where: { id },
        include: userInclude
      });
    });

    await createAuditLog({
      actorUserId: actor.id,
      action: "USER_DISTRICT_ASSIGNMENTS_UPDATED",
      entityType: "user",
      entityId: id,
      detailsJson: {
        districtIds: body.districtIds
      },
      ipAddress: requestIp(req)
    });

    return ok(res, { user: mapUser(updated) }, "District assignments updated");
  }
);

async function changeUserStatus(input: {
  targetUserId: string;
  status: UserStatus;
  actorUserId: string;
  actorRole: UserRole;
  reason?: string | null;
  action: string;
  reqIp: string | null;
}) {
  const target = await getUserOrFail(input.targetUserId);
  ensureCanManageRole(input.actorRole, target.role);

  if (input.targetUserId === input.actorUserId && input.status !== "ACTIVE") {
    throw new AppError(
      400,
      "SELF_STATUS_CHANGE_FORBIDDEN",
      "You cannot suspend/deactivate your own account"
    );
  }

  const statusReason = parseReason(input.reason);
  const updated = await prisma.user.update({
    where: { id: target.id },
    data: { status: input.status }
  });

  if (input.status !== "ACTIVE") {
    await revokeAllUserRefreshSessions(target.id);
  }

  await createAuditLog({
    actorUserId: input.actorUserId,
    action: input.action,
    entityType: "user",
    entityId: target.id,
    detailsJson: {
      fromStatus: target.status,
      toStatus: input.status,
      reason: statusReason
    },
    ipAddress: input.reqIp
  });

  await sendUserStatusChangedEmail({
    to: updated.email,
    fullName: updated.fullName,
    status: updated.status,
    reason: statusReason ?? undefined
  });

  return getUserOrFail(target.id);
}

usersRouter.post(
  "/:id/approve",
  validateParams(userIdParamSchema),
  validateBody(statusActionSchema),
  async (req, res) => {
    const { id } = req.params as z.infer<typeof userIdParamSchema>;
    const body = req.body as z.infer<typeof statusActionSchema>;

    const updated = await changeUserStatus({
      targetUserId: id,
      status: "ACTIVE",
      actorUserId: req.user!.id,
      actorRole: req.user!.role,
      reason: body.reason,
      action: "USER_APPROVED",
      reqIp: requestIp(req)
    });

    return ok(res, { user: mapUser(updated) }, "User approved");
  }
);

usersRouter.post(
  "/:id/suspend",
  validateParams(userIdParamSchema),
  validateBody(statusActionSchema),
  async (req, res) => {
    const { id } = req.params as z.infer<typeof userIdParamSchema>;
    const body = req.body as z.infer<typeof statusActionSchema>;
    const reason = parseReason(body.reason);

    if (!reason) {
      throw new AppError(400, "REASON_REQUIRED", "reason is required for suspension");
    }

    const updated = await changeUserStatus({
      targetUserId: id,
      status: "SUSPENDED",
      actorUserId: req.user!.id,
      actorRole: req.user!.role,
      reason,
      action: "USER_SUSPENDED",
      reqIp: requestIp(req)
    });

    return ok(res, { user: mapUser(updated) }, "User suspended");
  }
);

usersRouter.post(
  "/:id/deactivate",
  validateParams(userIdParamSchema),
  validateBody(statusActionSchema),
  async (req, res) => {
    const { id } = req.params as z.infer<typeof userIdParamSchema>;
    const body = req.body as z.infer<typeof statusActionSchema>;
    const reason = parseReason(body.reason);

    if (!reason) {
      throw new AppError(400, "REASON_REQUIRED", "reason is required for deactivation");
    }

    const updated = await changeUserStatus({
      targetUserId: id,
      status: "SUSPENDED",
      actorUserId: req.user!.id,
      actorRole: req.user!.role,
      reason,
      action: "USER_DEACTIVATED",
      reqIp: requestIp(req)
    });

    return ok(
      res,
      {
        user: mapUser(updated),
        warning: "Deactivation is mapped to suspended status in current workflow."
      },
      "User deactivated"
    );
  }
);
