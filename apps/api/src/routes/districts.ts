import { Request, Response, Router } from "express";
import { z } from "zod";
import { allowRoles } from "../middleware/rbac.js";
import { validateBody, validateParams, validateQuery } from "../middleware/validate.js";
import { created, ok } from "../lib/http.js";
import { AppError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { createAuditLog, requestIp } from "../services/audit-log.service.js";
import {
  getActiveUsersByRole,
  getDistrictAssignmentsPayload,
  replaceDistrictAssignments
} from "../services/districts.service.js";

export const districtsRouter = Router();
const allowDistrictCrud = allowRoles("SUPER_ADMIN");
const allowDistrictMapping = allowRoles("SUPER_ADMIN", "ADMIN");

const districtIdParamSchema = z.object({
  districtId: z.string().uuid()
});

const createDistrictSchema = z.object({
  name: z.string().min(2).max(120),
  state: z.string().min(2).max(120),
  isActive: z.boolean().optional()
});

const updateDistrictSchema = z
  .object({
    name: z.string().min(2).max(120).optional(),
    state: z.string().min(2).max(120).optional(),
    isActive: z.boolean().optional()
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "At least one field is required"
  });

const listDistrictsQuerySchema = z.object({
  state: z.string().min(2).max(120).optional(),
  isActive: z
    .string()
    .optional()
    .transform((v) => {
      if (v === undefined) return undefined;
      return v === "true";
    })
});

const updateAssignmentsSchema = z.object({
  managerIds: z.array(z.string().uuid()).default([]),
  executiveIds: z.array(z.string().uuid()).default([])
});

districtsRouter.get("/", allowDistrictMapping, validateQuery(listDistrictsQuerySchema), async (req: Request, res: Response) => {
  const query = req.query as z.infer<typeof listDistrictsQuerySchema>;
  const districts = await prisma.district.findMany({
    where: {
      ...(query.state ? { state: query.state } : {}),
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {})
    },
    include: {
      _count: {
        select: {
          leads: true,
          assignments: true
        }
      }
    },
    orderBy: [{ state: "asc" }, { name: "asc" }]
  });

  return ok(res, districts, "Districts fetched");
});

districtsRouter.post("/", allowDistrictCrud, validateBody(createDistrictSchema), async (req: Request, res: Response) => {
  const body = req.body as z.infer<typeof createDistrictSchema>;

  const existing = await prisma.district.findFirst({
    where: {
      name: body.name,
      state: body.state
    },
    select: { id: true }
  });
  if (existing) {
    throw new AppError(409, "DISTRICT_EXISTS", "District already exists for this state");
  }

  const district = await prisma.district.create({
    data: {
      name: body.name,
      state: body.state,
      isActive: body.isActive ?? true
    }
  });

  await createAuditLog({
    actorUserId: req.user?.id,
    action: "DISTRICT_CREATED",
    entityType: "district",
    entityId: district.id,
    detailsJson: district,
    ipAddress: requestIp(req)
  });

  return created(res, district, "District created");
});

districtsRouter.get("/users/managers", allowDistrictMapping, async (_req: Request, res: Response) => {
  const managers = await getActiveUsersByRole("MANAGER");
  return ok(res, managers, "Active district managers fetched");
});

districtsRouter.get("/users/executives", allowDistrictMapping, async (_req: Request, res: Response) => {
  const executives = await getActiveUsersByRole("EXECUTIVE");
  return ok(res, executives, "Active field executives fetched");
});

districtsRouter.get("/mappings", allowDistrictMapping, async (_req: Request, res: Response) => {
  const mappings = await getDistrictAssignmentsPayload();
  return ok(res, mappings, "District manager/executive mappings fetched");
});

districtsRouter.get(
  "/:districtId/mappings",
  allowDistrictMapping,
  validateParams(districtIdParamSchema),
  async (req: Request, res: Response) => {
    const { districtId } = req.params as z.infer<typeof districtIdParamSchema>;
    const [mappings] = await getDistrictAssignmentsPayload(districtId);
    if (!mappings) {
      throw new AppError(404, "NOT_FOUND", "District not found");
    }
    return ok(res, mappings, "District mappings fetched");
  }
);

districtsRouter.put(
  "/:districtId/mappings",
  allowDistrictMapping,
  validateParams(districtIdParamSchema),
  validateBody(updateAssignmentsSchema),
  async (req: Request, res: Response) => {
    const { districtId } = req.params as z.infer<typeof districtIdParamSchema>;
    const body = req.body as z.infer<typeof updateAssignmentsSchema>;

    const district = await prisma.district.findUnique({ where: { id: districtId } });
    if (!district) {
      throw new AppError(404, "NOT_FOUND", "District not found");
    }

    try {
      const [updated] = await replaceDistrictAssignments(
        districtId,
        body.managerIds,
        body.executiveIds
      );

      await createAuditLog({
        actorUserId: req.user?.id,
        action: "DISTRICT_ASSIGNMENTS_UPDATED",
        entityType: "district",
        entityId: districtId,
        detailsJson: {
          managerIds: body.managerIds,
          executiveIds: body.executiveIds
        },
        ipAddress: requestIp(req)
      });

      return ok(res, updated, "District assignments updated");
    } catch (error) {
      throw new AppError(
        400,
        "INVALID_ASSIGNMENT",
        error instanceof Error ? error.message : "Invalid assignment payload"
      );
    }
  }
);

districtsRouter.get(
  "/:districtId",
  allowDistrictCrud,
  validateParams(districtIdParamSchema),
  async (req: Request, res: Response) => {
    const { districtId } = req.params as z.infer<typeof districtIdParamSchema>;
    const district = await prisma.district.findUnique({
      where: { id: districtId },
      include: {
        _count: {
          select: {
            leads: true,
            assignments: true
          }
        }
      }
    });
    if (!district) {
      throw new AppError(404, "NOT_FOUND", "District not found");
    }
    return ok(res, district, "District fetched");
  }
);

districtsRouter.patch(
  "/:districtId",
  allowDistrictCrud,
  validateParams(districtIdParamSchema),
  validateBody(updateDistrictSchema),
  async (req: Request, res: Response) => {
    const { districtId } = req.params as z.infer<typeof districtIdParamSchema>;
    const body = req.body as z.infer<typeof updateDistrictSchema>;

    const district = await prisma.district.findUnique({ where: { id: districtId } });
    if (!district) {
      throw new AppError(404, "NOT_FOUND", "District not found");
    }

    const updated = await prisma.district.update({
      where: { id: districtId },
      data: body
    });

    await createAuditLog({
      actorUserId: req.user?.id,
      action: "DISTRICT_UPDATED",
      entityType: "district",
      entityId: districtId,
      detailsJson: body,
      ipAddress: requestIp(req)
    });

    return ok(res, updated, "District updated");
  }
);

districtsRouter.delete(
  "/:districtId",
  allowDistrictCrud,
  validateParams(districtIdParamSchema),
  async (req: Request, res: Response) => {
    const { districtId } = req.params as z.infer<typeof districtIdParamSchema>;

    const district = await prisma.district.findUnique({ where: { id: districtId } });
    if (!district) {
      throw new AppError(404, "NOT_FOUND", "District not found");
    }

    const leadCount = await prisma.lead.count({ where: { districtId } });
    if (leadCount > 0) {
      throw new AppError(
        409,
        "DISTRICT_IN_USE",
        "Cannot delete district with existing leads. Deactivate it instead."
      );
    }

    await prisma.userDistrictAssignment.deleteMany({ where: { districtId } });
    await prisma.district.delete({ where: { id: districtId } });

    await createAuditLog({
      actorUserId: req.user?.id,
      action: "DISTRICT_DELETED",
      entityType: "district",
      entityId: districtId,
      detailsJson: { districtId },
      ipAddress: requestIp(req)
    });

    return ok(res, { id: districtId }, "District deleted");
  }
);
