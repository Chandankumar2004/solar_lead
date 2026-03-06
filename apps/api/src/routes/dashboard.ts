import { Prisma } from "@prisma/client";
import { Request, Response, Router } from "express";
import { z } from "zod";
import { ok } from "../lib/http.js";
import { AppError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { allowRoles } from "../middleware/rbac.js";
import { validateQuery } from "../middleware/validate.js";

export const dashboardRouter = Router();

const dashboardQuerySchema = z
  .object({
    dateFrom: z.string().trim().optional(),
    dateTo: z.string().trim().optional(),
    districtId: z.string().uuid().optional(),
    executiveId: z.string().uuid().optional(),
    execId: z.string().uuid().optional()
  })
  .transform((value) => ({
    dateFrom: value.dateFrom,
    dateTo: value.dateTo,
    districtId: value.districtId,
    executiveId: value.executiveId ?? value.execId
  }));

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

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function startOfWeek(date: Date) {
  const next = startOfDay(date);
  const day = next.getDay();
  const diff = (day + 6) % 7;
  next.setDate(next.getDate() - diff);
  return next;
}

function startOfMonth(date: Date) {
  const next = startOfDay(date);
  next.setDate(1);
  return next;
}

function withCreatedAt(
  baseWhere: Prisma.LeadWhereInput,
  from?: Date,
  to?: Date
): Prisma.LeadWhereInput {
  if (!from && !to) return baseWhere;
  return {
    ...baseWhere,
    createdAt: {
      ...(from ? { gte: from } : {}),
      ...(to ? { lte: to } : {})
    }
  };
}

function boundedPeriod(
  periodStart: Date,
  globalFrom: Date | undefined,
  globalTo: Date | undefined,
  now: Date
) {
  const start =
    globalFrom && globalFrom > periodStart ? globalFrom : periodStart;
  const end = globalTo && globalTo < now ? globalTo : now;
  if (start > end) {
    return null;
  }
  return { start, end };
}

async function getDashboardSummary(req: Request, res: Response) {
  const query = req.query as z.infer<typeof dashboardQuerySchema>;
  const dateFrom = parseDateBoundary(query.dateFrom, "dateFrom");
  const dateTo = parseDateBoundary(query.dateTo, "dateTo");

  if (dateFrom && dateTo && dateFrom > dateTo) {
    throw new AppError(400, "VALIDATION_ERROR", "dateFrom cannot be greater than dateTo");
  }

  const baseLeadWhere: Prisma.LeadWhereInput = {
    ...(query.districtId ? { districtId: query.districtId } : {}),
    ...(query.executiveId ? { assignedExecutiveId: query.executiveId } : {})
  };

  const rangedLeadWhere = withCreatedAt(baseLeadWhere, dateFrom, dateTo);

  const now = new Date();
  const todayBounds = boundedPeriod(startOfDay(now), dateFrom, dateTo, now);
  const weekBounds = boundedPeriod(startOfWeek(now), dateFrom, dateTo, now);
  const monthBounds = boundedPeriod(startOfMonth(now), dateFrom, dateTo, now);

  const totalTodayPromise = todayBounds
    ? prisma.lead.count({
        where: withCreatedAt(baseLeadWhere, todayBounds.start, todayBounds.end)
      })
    : Promise.resolve(0);
  const totalWeekPromise = weekBounds
    ? prisma.lead.count({
        where: withCreatedAt(baseLeadWhere, weekBounds.start, weekBounds.end)
      })
    : Promise.resolve(0);
  const totalMonthPromise = monthBounds
    ? prisma.lead.count({
        where: withCreatedAt(baseLeadWhere, monthBounds.start, monthBounds.end)
      })
    : Promise.resolve(0);

  const [
    totalToday,
    totalWeek,
    totalMonth,
    leadStatuses,
    statusGrouped,
    districtGrouped,
    installationTypeGrouped,
    pendingDocumentsCount,
    pendingPaymentsCount,
    executives,
    assignedGrouped,
    activeGrouped,
    terminalGrouped,
    pendingDocumentRows,
    pendingPaymentRows
  ] = await Promise.all([
    totalTodayPromise,
    totalWeekPromise,
    totalMonthPromise,
    prisma.leadStatus.findMany({
      select: {
        id: true,
        name: true,
        orderIndex: true,
        isTerminal: true,
        colorCode: true
      },
      orderBy: [{ orderIndex: "asc" }, { name: "asc" }]
    }),
    prisma.lead.groupBy({
      by: ["currentStatusId"],
      where: rangedLeadWhere,
      _count: { _all: true }
    }),
    prisma.lead.groupBy({
      by: ["districtId"],
      where: rangedLeadWhere,
      _count: { _all: true }
    }),
    prisma.lead.groupBy({
      by: ["installationType"],
      where: rangedLeadWhere,
      _count: { _all: true }
    }),
    prisma.document.count({
      where: {
        reviewStatus: "PENDING",
        lead: { is: rangedLeadWhere }
      }
    }),
    prisma.payment.count({
      where: {
        status: "PENDING",
        lead: { is: rangedLeadWhere }
      }
    }),
    prisma.user.findMany({
      where: {
        role: "EXECUTIVE",
        status: "ACTIVE",
        ...(query.executiveId ? { id: query.executiveId } : {}),
        ...(query.districtId
          ? {
              districts: {
                some: {
                  districtId: query.districtId
                }
              }
            }
          : {})
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        employeeId: true
      },
      orderBy: { fullName: "asc" }
    }),
    prisma.lead.groupBy({
      by: ["assignedExecutiveId"],
      where: {
        ...rangedLeadWhere,
        assignedExecutiveId: { not: null }
      },
      _count: { _all: true }
    }),
    prisma.lead.groupBy({
      by: ["assignedExecutiveId"],
      where: {
        ...rangedLeadWhere,
        assignedExecutiveId: { not: null },
        currentStatus: {
          is: {
            isTerminal: false
          }
        }
      },
      _count: { _all: true }
    }),
    prisma.lead.groupBy({
      by: ["assignedExecutiveId"],
      where: {
        ...rangedLeadWhere,
        assignedExecutiveId: { not: null },
        currentStatus: {
          is: {
            isTerminal: true
          }
        }
      },
      _count: { _all: true }
    }),
    prisma.document.findMany({
      where: {
        reviewStatus: "PENDING",
        lead: {
          is: {
            ...rangedLeadWhere,
            assignedExecutiveId: { not: null }
          }
        }
      },
      select: {
        lead: {
          select: {
            assignedExecutiveId: true
          }
        }
      }
    }),
    prisma.payment.findMany({
      where: {
        status: "PENDING",
        lead: {
          is: {
            ...rangedLeadWhere,
            assignedExecutiveId: { not: null }
          }
        }
      },
      select: {
        lead: {
          select: {
            assignedExecutiveId: true
          }
        }
      }
    })
  ]);

  const districtIds = districtGrouped.map((row) => row.districtId);
  const districts =
    districtIds.length > 0
      ? await prisma.district.findMany({
          where: {
            id: {
              in: districtIds
            }
          },
          select: {
            id: true,
            name: true,
            state: true
          }
        })
      : [];

  const statusCountMap = new Map(
    statusGrouped.map((row) => [row.currentStatusId, row._count._all])
  );
  const districtMap = new Map(
    districts.map((district) => [district.id, district])
  );

  const assignedMap = new Map(
    assignedGrouped.map((row) => [row.assignedExecutiveId ?? "", row._count._all])
  );
  const activeMap = new Map(
    activeGrouped.map((row) => [row.assignedExecutiveId ?? "", row._count._all])
  );
  const terminalMap = new Map(
    terminalGrouped.map((row) => [row.assignedExecutiveId ?? "", row._count._all])
  );

  const pendingDocumentMap = new Map<string, number>();
  for (const row of pendingDocumentRows) {
    const execId = row.lead.assignedExecutiveId;
    if (!execId) continue;
    pendingDocumentMap.set(execId, (pendingDocumentMap.get(execId) ?? 0) + 1);
  }

  const pendingPaymentMap = new Map<string, number>();
  for (const row of pendingPaymentRows) {
    const execId = row.lead.assignedExecutiveId;
    if (!execId) continue;
    pendingPaymentMap.set(execId, (pendingPaymentMap.get(execId) ?? 0) + 1);
  }

  const leadsByStatus = leadStatuses.map((status) => ({
    statusId: status.id,
    statusName: status.name,
    orderIndex: status.orderIndex,
    isTerminal: status.isTerminal,
    colorCode: status.colorCode,
    count: statusCountMap.get(status.id) ?? 0
  }));

  const leadsByDistrict = districtGrouped
    .map((row) => {
      const district = districtMap.get(row.districtId);
      return {
        districtId: row.districtId,
        districtName: district?.name ?? "Unknown",
        state: district?.state ?? "",
        count: row._count._all
      };
    })
    .sort((a, b) => b.count - a.count);

  const leadsByInstallationType = installationTypeGrouped
    .map((row) => ({
      installationType: row.installationType ?? "Unknown",
      count: row._count._all
    }))
    .sort((a, b) => b.count - a.count);

  const fieldExecutivePerformance = executives
    .map((executive) => {
      const totalAssigned = assignedMap.get(executive.id) ?? 0;
      const activeLeads = activeMap.get(executive.id) ?? 0;
      const terminalLeads = terminalMap.get(executive.id) ?? 0;
      const pendingDocuments = pendingDocumentMap.get(executive.id) ?? 0;
      const pendingPayments = pendingPaymentMap.get(executive.id) ?? 0;

      return {
        executiveId: executive.id,
        fullName: executive.fullName,
        email: executive.email,
        phone: executive.phone,
        employeeId: executive.employeeId,
        totalAssigned,
        activeLeads,
        terminalLeads,
        pendingDocuments,
        pendingPayments
      };
    })
    .sort((a, b) => b.totalAssigned - a.totalAssigned || a.fullName.localeCompare(b.fullName));

  return ok(res, {
    filters: {
      dateFrom: dateFrom?.toISOString() ?? null,
      dateTo: dateTo?.toISOString() ?? null,
      districtId: query.districtId ?? null,
      executiveId: query.executiveId ?? null
    },
    totals: {
      today: totalToday,
      week: totalWeek,
      month: totalMonth
    },
    pendingVerifications: {
      documents: pendingDocumentsCount,
      payments: pendingPaymentsCount,
      total: pendingDocumentsCount + pendingPaymentsCount
    },
    leadsByStatus,
    leadsByDistrict,
    leadsByInstallationType,
    fieldExecutivePerformance,
    generatedAt: new Date().toISOString()
  }, "Dashboard summary fetched");
}

dashboardRouter.get(
  "/summary",
  allowRoles("SUPER_ADMIN", "ADMIN", "DISTRICT_MANAGER", "FIELD_EXECUTIVE"),
  validateQuery(dashboardQuerySchema),
  async (req, res) => getDashboardSummary(req, res)
);

dashboardRouter.get(
  "/",
  allowRoles("SUPER_ADMIN", "ADMIN", "DISTRICT_MANAGER", "FIELD_EXECUTIVE"),
  validateQuery(dashboardQuerySchema),
  async (req, res) => getDashboardSummary(req, res)
);
