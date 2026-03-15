import { Prisma } from "@prisma/client";
import { Request, Response, Router } from "express";
import { z } from "zod";
import { ok } from "../lib/http.js";
import { AppError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { allowRoles } from "../middleware/rbac.js";
import { validateQuery } from "../middleware/validate.js";
import { scopeLeadWhere } from "../services/lead-access.service.js";

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

function classifyLoanApplicationStatus(value: string | null | undefined) {
  const normalized = (value ?? "").trim().toLowerCase();
  if (!normalized) return "pending";
  if (normalized.includes("reject")) return "rejected";
  if (normalized.includes("approve")) return "approved";
  if (normalized.includes("sanction")) return "approved";
  if (normalized.includes("disburs")) return "approved";
  return "pending";
}

function looksLikeVisitOrScheduledStatus(statusName: string) {
  const normalized = statusName.trim().toLowerCase();
  if (!normalized) return false;
  return normalized.includes("visit") || normalized.includes("scheduled");
}

async function getMobileHomeSummary(req: Request, res: Response) {
  const baseLeadWhere = scopeLeadWhere(req.user!, {});
  const todayStart = startOfDay(new Date());

  const [leads, notifications] = await Promise.all([
    prisma.lead.findMany({
      where: baseLeadWhere,
      orderBy: { updatedAt: "desc" },
      take: 200,
      select: {
        id: true,
        externalId: true,
        name: true,
        phone: true,
        updatedAt: true,
        isOverdue: true,
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
        customerDetail: {
          select: {
            id: true
          }
        },
        documents: {
          where: { isLatest: true },
          select: { id: true },
          take: 1
        },
        payments: {
          where: { status: "VERIFIED" },
          select: { id: true },
          take: 1
        }
      }
    }),
    prisma.notificationLog.findMany({
      where: {
        recipient: req.user!.id
      },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        leadId: true,
        channel: true,
        deliveryStatus: true,
        contentSent: true,
        createdAt: true
      }
    })
  ]);

  const activeLeads = leads.filter((lead) => !lead.currentStatus.isTerminal);
  const overdueCount = activeLeads.filter((lead) => lead.isOverdue).length;
  const normalCount = activeLeads.length - overdueCount;

  const activeByStatusMap = new Map<
    string,
    { statusId: string; statusName: string; colorCode: string | null; count: number }
  >();
  for (const lead of activeLeads) {
    const current = activeByStatusMap.get(lead.currentStatus.id);
    if (current) {
      current.count += 1;
      continue;
    }
    activeByStatusMap.set(lead.currentStatus.id, {
      statusId: lead.currentStatus.id,
      statusName: lead.currentStatus.name,
      colorCode: lead.currentStatus.colorCode,
      count: 1
    });
  }

  const activeByStatus = Array.from(activeByStatusMap.values()).sort(
    (a, b) => b.count - a.count || a.statusName.localeCompare(b.statusName)
  );

  const todaysTasks = activeLeads
    .filter((lead) => {
      const updatedAt = new Date(lead.updatedAt);
      const updatedToday = !Number.isNaN(updatedAt.getTime()) && updatedAt >= todayStart;
      return lead.isOverdue || updatedToday || looksLikeVisitOrScheduledStatus(lead.currentStatus.name);
    })
    .sort((a, b) => {
      if (a.isOverdue !== b.isOverdue) {
        return a.isOverdue ? -1 : 1;
      }
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    })
    .slice(0, 12)
    .map((lead) => ({
      leadId: lead.id,
      externalId: lead.externalId,
      customerName: lead.name,
      phone: lead.phone,
      districtName: lead.district.name,
      districtState: lead.district.state,
      statusName: lead.currentStatus.name,
      isOverdue: lead.isOverdue,
      updatedAt: lead.updatedAt
    }));

  const documentsToUpload = activeLeads.filter((lead) => lead.documents.length === 0).length;
  const paymentsToCollect = activeLeads.filter((lead) => lead.payments.length === 0).length;
  const formsToComplete = activeLeads.filter((lead) => !lead.customerDetail).length;

  return ok(
    res,
    {
      totals: {
        assigned: leads.length,
        active: activeLeads.length,
        overdue: overdueCount
      },
      activeLeadsByStatus: activeByStatus,
      urgency: {
        overdue: overdueCount,
        normal: normalCount
      },
      todaysTasks,
      pendingActions: {
        documentsToUpload,
        paymentsToCollect,
        formsToComplete,
        total: documentsToUpload + paymentsToCollect + formsToComplete
      },
      recentNotifications: notifications,
      generatedAt: new Date().toISOString()
    },
    "Mobile dashboard summary fetched"
  );
}

async function getDashboardSummary(req: Request, res: Response) {
  const query = req.query as z.infer<typeof dashboardQuerySchema>;
  const dateFrom = parseDateBoundary(query.dateFrom, "dateFrom");
  const dateTo = parseDateBoundary(query.dateTo, "dateTo");

  if (dateFrom && dateTo && dateFrom > dateTo) {
    throw new AppError(400, "VALIDATION_ERROR", "dateFrom cannot be greater than dateTo");
  }

  const requestedLeadWhere: Prisma.LeadWhereInput = {
    ...(query.districtId ? { districtId: query.districtId } : {}),
    ...(query.executiveId ? { assignedExecutiveId: query.executiveId } : {})
  };
  const baseLeadWhere = scopeLeadWhere(req.user!, requestedLeadWhere);

  const rangedLeadWhere = withCreatedAt(baseLeadWhere, dateFrom, dateTo);
  const executiveWhereClauses: Prisma.UserWhereInput[] = [
    {
      role: "EXECUTIVE",
      status: "ACTIVE"
    },
    ...(query.executiveId ? [{ id: query.executiveId }] : []),
    ...(query.districtId
      ? [
          {
            districts: {
              some: {
                districtId: query.districtId
              }
            }
          } satisfies Prisma.UserWhereInput
        ]
      : []),
    ...(req.user!.role === "EXECUTIVE"
      ? [{ id: req.user!.id }]
      : []),
    ...(req.user!.role === "MANAGER"
      ? [
          {
            districts: {
              some: {
                district: {
                  assignments: {
                    some: {
                      userId: req.user!.id,
                      user: {
                        role: "MANAGER",
                        status: "ACTIVE"
                      }
                    }
                  }
                }
              }
            }
          } satisfies Prisma.UserWhereInput
        ]
      : [])
  ];
  const executiveWhere: Prisma.UserWhereInput =
    executiveWhereClauses.length > 1
      ? { AND: executiveWhereClauses }
      : executiveWhereClauses[0] ?? {};

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
      where: executiveWhere,
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

  const executiveIds = executives.map((executive) => executive.id);
  const visitStatusIds = await prisma.leadStatus.findMany({
    where: {
      name: {
        contains: "visit",
        mode: "insensitive"
      }
    },
    select: { id: true }
  });

  const [visitGrouped, paymentCollectedGrouped, recentActivityRows, loanStatusRows] =
    await Promise.all([
      executiveIds.length > 0 && visitStatusIds.length > 0
        ? prisma.leadStatusHistory.groupBy({
            by: ["changedByUserId"],
            where: {
              changedByUserId: {
                in: executiveIds
              },
              toStatusId: {
                in: visitStatusIds.map((row) => row.id)
              },
              lead: {
                is: rangedLeadWhere
              }
            },
            _count: { _all: true }
          })
        : Promise.resolve([]),
      executiveIds.length > 0
        ? prisma.payment.groupBy({
            by: ["collectedByUserId"],
            where: {
              status: "VERIFIED",
              collectedByUserId: {
                in: executiveIds
              },
              lead: {
                is: rangedLeadWhere
              }
            },
            _sum: {
              amount: true
            }
          })
        : Promise.resolve([]),
      prisma.leadStatusHistory.findMany({
        where: {
          lead: {
            is: rangedLeadWhere
          }
        },
        orderBy: {
          createdAt: "desc"
        },
        take: 20,
        select: {
          id: true,
          createdAt: true,
          notes: true,
          lead: {
            select: {
              id: true,
              name: true,
              phone: true,
              district: {
                select: {
                  name: true,
                  state: true
                }
              }
            }
          },
          fromStatus: {
            select: {
              name: true
            }
          },
          toStatus: {
            select: {
              name: true
            }
          },
          changedByUser: {
            select: {
              id: true,
              fullName: true,
              role: true
            }
          }
        }
      }),
      prisma.loanDetail.findMany({
        where: {
          lead: {
            is: rangedLeadWhere
          }
        },
        select: {
          applicationStatus: true
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
  const visitsCompletedMap = new Map(
    visitGrouped.map((row) => [row.changedByUserId ?? "", row._count._all])
  );
  const tokenAmountCollectedMap = new Map(
    paymentCollectedGrouped.map((row) => [
      row.collectedByUserId ?? "",
      Number(row._sum.amount ?? 0)
    ])
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

  const loanPipelineSummary = loanStatusRows.reduce(
    (acc, row) => {
      const bucket = classifyLoanApplicationStatus(row.applicationStatus);
      acc.total += 1;
      if (bucket === "approved") {
        acc.approved += 1;
      } else if (bucket === "rejected") {
        acc.rejected += 1;
      } else {
        acc.pending += 1;
      }
      return acc;
    },
    { pending: 0, approved: 0, rejected: 0, total: 0 }
  );

  const recentActivity = recentActivityRows.map((row) => ({
    id: row.id,
    at: row.createdAt,
    lead: {
      id: row.lead.id,
      name: row.lead.name,
      phone: row.lead.phone,
      districtName: row.lead.district.name,
      districtState: row.lead.district.state
    },
    fromStatus: row.fromStatus?.name ?? null,
    toStatus: row.toStatus.name,
    actor: {
      id: row.changedByUser.id,
      name: row.changedByUser.fullName,
      role: row.changedByUser.role
    },
    notes: row.notes
  }));

  const fieldExecutivePerformance = executives
    .map((executive) => {
      const totalAssigned = assignedMap.get(executive.id) ?? 0;
      const activeLeads = activeMap.get(executive.id) ?? 0;
      const terminalLeads = terminalMap.get(executive.id) ?? 0;
      const visitsCompleted = visitsCompletedMap.get(executive.id) ?? 0;
      const tokenAmountCollected = tokenAmountCollectedMap.get(executive.id) ?? 0;
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
        visitsCompleted,
        tokenAmountCollected,
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
    loanPipelineSummary,
    recentActivity,
    generatedAt: new Date().toISOString()
  }, "Dashboard summary fetched");
}

dashboardRouter.get(
  "/summary",
  allowRoles("SUPER_ADMIN", "ADMIN", "DISTRICT_MANAGER"),
  validateQuery(dashboardQuerySchema),
  async (req, res) => getDashboardSummary(req, res)
);

dashboardRouter.get(
  "/",
  allowRoles("SUPER_ADMIN", "ADMIN", "DISTRICT_MANAGER"),
  validateQuery(dashboardQuerySchema),
  async (req, res) => getDashboardSummary(req, res)
);

dashboardRouter.get(
  "/mobile-summary",
  allowRoles("FIELD_EXECUTIVE"),
  async (req, res) => getMobileHomeSummary(req, res)
);
