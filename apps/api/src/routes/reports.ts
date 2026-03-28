import { NotificationChannel, Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { ok } from "../lib/http.js";
import { AppError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { allowRoles } from "../middleware/rbac.js";
import { validateQuery } from "../middleware/validate.js";
import { scopeLeadWhere } from "../services/lead-access.service.js";
import type { AuthUser } from "../types.js";

export const reportsRouter = Router();

const reportsQueryBaseSchema = z.object({
  dateFrom: z.string().trim().optional(),
  dateTo: z.string().trim().optional(),
  districtId: z.string().uuid().optional(),
  executiveId: z.string().uuid().optional(),
  execId: z.string().uuid().optional(),
  channel: z.nativeEnum(NotificationChannel).optional()
});

const reportsQuerySchema = reportsQueryBaseSchema.transform((value) => ({
  dateFrom: value.dateFrom,
  dateTo: value.dateTo,
  districtId: value.districtId,
  executiveId: value.executiveId ?? value.execId,
  channel: value.channel
}));

const reportKeySchema = z.enum([
  "lead_source",
  "lead_pipeline",
  "district_performance",
  "field_executive_performance",
  "revenue",
  "loan_pipeline",
  "customer_communication"
]);

const reportExportQuerySchema = reportsQueryBaseSchema
  .extend({
    report: reportKeySchema,
    format: z.enum(["csv", "pdf"]).default("csv")
  })
  .transform((value) => ({
    dateFrom: value.dateFrom,
    dateTo: value.dateTo,
    districtId: value.districtId,
    executiveId: value.executiveId ?? value.execId,
    channel: value.channel,
    report: value.report,
    format: value.format
  }));

type ReportsQuery = z.infer<typeof reportsQuerySchema>;
type ReportExportQuery = z.infer<typeof reportExportQuerySchema>;
type ReportKey = z.infer<typeof reportKeySchema>;

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

function classifyLoanApplicationStatus(value: string | null | undefined) {
  const normalized = (value ?? "").trim().toLowerCase();
  if (!normalized) return "pending";
  if (normalized.includes("reject")) return "rejected";
  if (normalized.includes("approve")) return "approved";
  if (normalized.includes("sanction")) return "approved";
  if (normalized.includes("disburs")) return "approved";
  return "pending";
}

function managerDistrictLeadScope(userId: string): Prisma.LeadWhereInput {
  return {
    district: {
      assignments: {
        some: {
          userId,
          user: {
            role: "MANAGER",
            status: "ACTIVE"
          }
        }
      }
    }
  };
}

function roundToTwo(value: number) {
  return Math.round(value * 100) / 100;
}

type ReportRow = Record<string, string | number | boolean | null>;

function normalizeCsvCell(value: unknown) {
  if (value === null || value === undefined) return "";
  const raw = String(value);
  if (/[",\n]/.test(raw)) {
    return `"${raw.replace(/"/g, "\"\"")}"`;
  }
  return raw;
}

function toCsv(rows: ReportRow[]) {
  if (rows.length === 0) {
    return "No data\n";
  }
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const lines = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => normalizeCsvCell(row[header])).join(","))
  ];
  return lines.join("\n");
}

function escapePdfText(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function buildSimplePdf(title: string, rows: ReportRow[], generatedAt: string) {
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  const lines: string[] = [
    title,
    `Generated at: ${generatedAt}`,
    ""
  ];

  if (headers.length === 0) {
    lines.push("No data");
  } else {
    lines.push(headers.join(" | "));
    lines.push("-".repeat(Math.min(120, headers.join(" | ").length)));
    rows.slice(0, 220).forEach((row) => {
      lines.push(headers.map((header) => String(row[header] ?? "")).join(" | "));
    });
  }

  const commands: string[] = ["BT", "/F1 10 Tf"];
  let y = 810;
  for (const line of lines) {
    if (y < 40) {
      break;
    }
    commands.push(`1 0 0 1 36 ${y} Tm (${escapePdfText(line)}) Tj`);
    y -= 14;
  }
  commands.push("ET");
  const stream = commands.join("\n");

  const objects: string[] = [];
  objects.push("1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj");
  objects.push("2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj");
  objects.push(
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >> endobj"
  );
  objects.push(
    `4 0 obj << /Length ${Buffer.byteLength(stream, "utf8")} >> stream\n${stream}\nendstream endobj`
  );
  objects.push("5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj");

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += `${object}\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let i = 1; i < offsets.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, "utf8");
}

async function buildReportsPayload(
  user: AuthUser,
  query: ReportsQuery
) {
  const dateFrom = parseDateBoundary(query.dateFrom, "dateFrom");
  const dateTo = parseDateBoundary(query.dateTo, "dateTo");
  if (dateFrom && dateTo && dateFrom > dateTo) {
    throw new AppError(400, "VALIDATION_ERROR", "dateFrom cannot be greater than dateTo");
  }

  const requestedLeadWhere: Prisma.LeadWhereInput = {
    ...(query.districtId ? { districtId: query.districtId } : {}),
    ...(query.executiveId ? { assignedExecutiveId: query.executiveId } : {})
  };

  const scopedLeadWhere = scopeLeadWhere(user, requestedLeadWhere);
  const rangedLeadWhere = withCreatedAt(scopedLeadWhere, dateFrom, dateTo);

  const [
    leadSourceGrouped,
    statuses,
    statusGrouped,
    districtGrouped,
    loanRows,
    communicationLogs
  ] = await Promise.all([
    prisma.lead.groupBy({
      by: ["utmSource", "utmMedium", "utmCampaign"],
      where: rangedLeadWhere,
      _count: { _all: true }
    }),
    prisma.leadStatus.findMany({
      select: {
        id: true,
        name: true,
        orderIndex: true
      },
      orderBy: [{ orderIndex: "asc" }, { createdAt: "asc" }]
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
    prisma.loanDetail.findMany({
      where: {
        lead: {
          is: scopedLeadWhere
        },
        ...(dateFrom || dateTo
          ? {
              updatedAt: {
                ...(dateFrom ? { gte: dateFrom } : {}),
                ...(dateTo ? { lte: dateTo } : {})
              }
            }
          : {})
      },
      select: {
        applicationStatus: true,
        lenderName: true,
        lead: {
          select: {
            districtId: true,
            district: {
              select: {
                id: true,
                name: true,
                state: true
              }
            }
          }
        }
      }
    }),
    prisma.notificationLog.findMany({
      where: {
        ...(query.channel
          ? { channel: query.channel }
          : { channel: { in: ["SMS", "EMAIL", "WHATSAPP"] } }),
        ...(dateFrom || dateTo
          ? {
              createdAt: {
                ...(dateFrom ? { gte: dateFrom } : {}),
                ...(dateTo ? { lte: dateTo } : {})
              }
            }
          : {}),
        ...(user.role === "MANAGER"
          ? {
              OR: [
                {
                  lead: {
                    is: managerDistrictLeadScope(user.id)
                  }
                },
                {
                  leadId: null,
                  recipient: user.id,
                  channel: "PUSH"
                }
              ]
            }
          : query.districtId || query.executiveId
            ? {
                lead: {
                  is: scopedLeadWhere
                }
              }
            : {})
      },
      select: {
        channel: true,
        deliveryStatus: true
      }
    })
  ]);

  const statusCountMap = new Map(
    statusGrouped.map((row) => [row.currentStatusId, row._count._all])
  );

  const leadSource = leadSourceGrouped
    .map((row) => ({
      utmSource: row.utmSource ?? "Unknown",
      utmMedium: row.utmMedium ?? "Unknown",
      utmCampaign: row.utmCampaign ?? "Unknown",
      leads: row._count._all
    }))
    .sort((a, b) => b.leads - a.leads);

  const leadPipelineStages = statuses.map((status) => ({
    statusId: status.id,
    statusName: status.name,
    orderIndex: status.orderIndex,
    leads: statusCountMap.get(status.id) ?? 0
  }));

  const leadPipelineTransitions = leadPipelineStages
    .slice(0, -1)
    .map((stage, index) => {
      const next = leadPipelineStages[index + 1];
      const conversionRate =
        stage.leads > 0 ? roundToTwo((next.leads / stage.leads) * 100) : 0;
      return {
        fromStatus: stage.statusName,
        toStatus: next.statusName,
        fromLeads: stage.leads,
        toLeads: next.leads,
        conversionRate
      };
    });

  const districtIds = districtGrouped.map((row) => row.districtId);
  const districts = districtIds.length
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
  const districtMap = new Map(districts.map((district) => [district.id, district]));

  const installationCompleteIds = statuses
    .filter((status) => status.name.trim().toLowerCase() === "installation complete")
    .map((status) => status.id);

  const districtCompletedGrouped = installationCompleteIds.length
    ? await prisma.lead.groupBy({
        by: ["districtId"],
        where: {
          AND: [rangedLeadWhere, { currentStatusId: { in: installationCompleteIds } }]
        },
        _count: { _all: true }
      })
    : [];
  const districtCompletedMap = new Map(
    districtCompletedGrouped.map((row) => [row.districtId, row._count._all])
  );

  const districtPerformance = districtGrouped
    .map((row) => {
      const district = districtMap.get(row.districtId);
      const totalLeads = row._count._all;
      const installationComplete = districtCompletedMap.get(row.districtId) ?? 0;
      return {
        districtId: row.districtId,
        districtName: district?.name ?? "Unknown",
        state: district?.state ?? "",
        totalLeads,
        installationComplete,
        conversionRate:
          totalLeads > 0
            ? roundToTwo((installationComplete / totalLeads) * 100)
            : 0
      };
    })
    .sort((a, b) => b.totalLeads - a.totalLeads);

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
    ...(user.role === "MANAGER"
      ? [
          {
            districts: {
              some: {
                district: {
                  assignments: {
                    some: {
                      userId: user.id,
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

  const executives = await prisma.user.findMany({
    where: executiveWhere,
    select: {
      id: true,
      fullName: true,
      email: true
    },
    orderBy: { fullName: "asc" }
  });
  const executiveIds = executives.map((executive) => executive.id);

  const [assignedRows, visitStatusIds, documentsSubmittedRows, tokenCollectionsRows] =
    await Promise.all([
      executiveIds.length
        ? prisma.lead.groupBy({
            by: ["assignedExecutiveId"],
            where: {
              ...rangedLeadWhere,
              assignedExecutiveId: {
                in: executiveIds
              }
            },
            _count: { _all: true }
          })
        : Promise.resolve([]),
      prisma.leadStatus.findMany({
        where: {
          name: {
            contains: "visit",
            mode: "insensitive"
          }
        },
        select: { id: true }
      }),
      executiveIds.length
        ? prisma.document.groupBy({
            by: ["uploadedByUserId"],
            where: {
              uploadedByUserId: { in: executiveIds },
              lead: {
                is: rangedLeadWhere
              }
            },
            _count: { _all: true }
          })
        : Promise.resolve([]),
      executiveIds.length
        ? prisma.payment.groupBy({
            by: ["collectedByUserId"],
            where: {
              status: "VERIFIED",
              collectedByUserId: { in: executiveIds },
              lead: {
                is: rangedLeadWhere
              }
            },
            _sum: {
              amount: true
            }
          })
        : Promise.resolve([])
    ]);

  const visitsCompletedRows =
    executiveIds.length > 0 && visitStatusIds.length > 0
      ? await prisma.leadStatusHistory.groupBy({
          by: ["changedByUserId"],
          where: {
            changedByUserId: {
              in: executiveIds
            },
            toStatusId: {
              in: visitStatusIds.map((status) => status.id)
            },
            lead: {
              is: rangedLeadWhere
            }
          },
          _count: { _all: true }
        })
      : [];

  const assignedMap = new Map(
    assignedRows.map((row) => [row.assignedExecutiveId ?? "", row._count._all])
  );
  const visitsMap = new Map(
    visitsCompletedRows.map((row) => [row.changedByUserId ?? "", row._count._all])
  );
  const documentsMap = new Map(
    documentsSubmittedRows.map((row) => [row.uploadedByUserId ?? "", row._count._all])
  );
  const tokenMap = new Map(
    tokenCollectionsRows.map((row) => [
      row.collectedByUserId ?? "",
      Number(row._sum.amount ?? 0)
    ])
  );

  const fieldExecutivePerformance = executives.map((executive) => ({
    executiveId: executive.id,
    fullName: executive.fullName,
    email: executive.email,
    leadsAssigned: assignedMap.get(executive.id) ?? 0,
    visitsCompleted: visitsMap.get(executive.id) ?? 0,
    documentsSubmitted: documentsMap.get(executive.id) ?? 0,
    tokenCollectionsInr: tokenMap.get(executive.id) ?? 0
  }));

  const revenueRows = await prisma.payment.findMany({
    where: {
      status: "VERIFIED",
      ...(dateFrom || dateTo
        ? {
            createdAt: {
              ...(dateFrom ? { gte: dateFrom } : {}),
              ...(dateTo ? { lte: dateTo } : {})
            }
          }
        : {}),
      lead: {
        is: scopedLeadWhere
      }
    },
    select: {
      amount: true,
      createdAt: true,
      lead: {
        select: {
          districtId: true,
          district: {
            select: {
              name: true,
              state: true
            }
          }
        }
      }
    }
  });

  const revenueByPeriodMap = new Map<string, number>();
  const revenueByDistrictMap = new Map<
    string,
    { districtId: string; districtName: string; state: string; amount: number }
  >();
  let totalRevenue = 0;

  for (const row of revenueRows) {
    const amount = Number(row.amount ?? 0);
    totalRevenue += amount;
    const periodKey = row.createdAt.toISOString().slice(0, 10);
    revenueByPeriodMap.set(periodKey, (revenueByPeriodMap.get(periodKey) ?? 0) + amount);

    const districtKey = row.lead.districtId;
    const existing = revenueByDistrictMap.get(districtKey);
    if (existing) {
      existing.amount += amount;
    } else {
      revenueByDistrictMap.set(districtKey, {
        districtId: districtKey,
        districtName: row.lead.district.name,
        state: row.lead.district.state,
        amount
      });
    }
  }

  const revenue = {
    totalInr: roundToTwo(totalRevenue),
    byPeriod: [...revenueByPeriodMap.entries()]
      .map(([period, amount]) => ({
        period,
        amountInr: roundToTwo(amount)
      }))
      .sort((a, b) => a.period.localeCompare(b.period)),
    byDistrict: [...revenueByDistrictMap.values()]
      .map((row) => ({
        ...row,
        amountInr: roundToTwo(row.amount)
      }))
      .sort((a, b) => b.amountInr - a.amountInr)
  };

  const byStatusMap = new Map<string, number>();
  const byLenderMap = new Map<string, number>();
  const byLoanDistrictMap = new Map<
    string,
    { districtId: string; districtName: string; state: string; applications: number }
  >();
  for (const row of loanRows) {
    const status = classifyLoanApplicationStatus(row.applicationStatus);
    byStatusMap.set(status, (byStatusMap.get(status) ?? 0) + 1);

    const lender = (row.lenderName ?? "").trim() || "Unknown";
    byLenderMap.set(lender, (byLenderMap.get(lender) ?? 0) + 1);

    const districtId = row.lead.district.id;
    const existing = byLoanDistrictMap.get(districtId);
    if (existing) {
      existing.applications += 1;
    } else {
      byLoanDistrictMap.set(districtId, {
        districtId,
        districtName: row.lead.district.name,
        state: row.lead.district.state,
        applications: 1
      });
    }
  }

  const loanPipeline = {
    totalApplications: loanRows.length,
    byStatus: [...byStatusMap.entries()]
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count),
    byLender: [...byLenderMap.entries()]
      .map(([lender, count]) => ({ lender, count }))
      .sort((a, b) => b.count - a.count),
    byDistrict: [...byLoanDistrictMap.values()].sort((a, b) => b.applications - a.applications)
  };

  const communicationByChannelMap = new Map<
    string,
    { channel: string; total: number; sent: number; failed: number }
  >();
  for (const log of communicationLogs) {
    const channel = log.channel;
    const existing = communicationByChannelMap.get(channel) ?? {
      channel,
      total: 0,
      sent: 0,
      failed: 0
    };
    existing.total += 1;

    const delivery = (log.deliveryStatus ?? "").toLowerCase();
    if (delivery === "sent" || delivery === "delivered") {
      existing.sent += 1;
    } else if (delivery.startsWith("failed")) {
      existing.failed += 1;
    }
    communicationByChannelMap.set(channel, existing);
  }

  const customerCommunication = {
    totalLogs: communicationLogs.length,
    byChannel: [...communicationByChannelMap.values()]
      .map((row) => ({
        channel: row.channel,
        total: row.total,
        sent: row.sent,
        failed: row.failed,
        deliveryRate: row.total > 0 ? roundToTwo((row.sent / row.total) * 100) : 0
      }))
      .sort((a, b) => b.total - a.total)
  };

  return {
    filters: {
      dateFrom: dateFrom?.toISOString() ?? null,
      dateTo: dateTo?.toISOString() ?? null,
      districtId: query.districtId ?? null,
      executiveId: query.executiveId ?? null,
      channel: query.channel ?? null
    },
    leadSource,
    leadPipeline: {
      stages: leadPipelineStages,
      transitions: leadPipelineTransitions
    },
    districtPerformance,
    fieldExecutivePerformance,
    revenue,
    loanPipeline,
    customerCommunication,
    generatedAt: new Date().toISOString()
  };
}

function rowsForReport(payload: Awaited<ReturnType<typeof buildReportsPayload>>, report: ReportKey) {
  if (report === "lead_source") {
    return payload.leadSource.map((row) => ({
      utmSource: row.utmSource,
      utmMedium: row.utmMedium,
      utmCampaign: row.utmCampaign,
      leads: row.leads
    }));
  }

  if (report === "lead_pipeline") {
    return payload.leadPipeline.transitions.map((row) => ({
      fromStatus: row.fromStatus,
      toStatus: row.toStatus,
      fromLeads: row.fromLeads,
      toLeads: row.toLeads,
      conversionRatePercent: row.conversionRate
    }));
  }

  if (report === "district_performance") {
    return payload.districtPerformance.map((row) => ({
      districtName: row.districtName,
      state: row.state,
      totalLeads: row.totalLeads,
      installationComplete: row.installationComplete,
      conversionRatePercent: row.conversionRate
    }));
  }

  if (report === "field_executive_performance") {
    return payload.fieldExecutivePerformance.map((row) => ({
      fullName: row.fullName,
      email: row.email,
      leadsAssigned: row.leadsAssigned,
      visitsCompleted: row.visitsCompleted,
      documentsSubmitted: row.documentsSubmitted,
      tokenCollectionsInr: row.tokenCollectionsInr
    }));
  }

  if (report === "revenue") {
    const periodRows = payload.revenue.byPeriod.map((row) => ({
      section: "by_period",
      period: row.period,
      amountInr: row.amountInr
    }));
    const districtRows = payload.revenue.byDistrict.map((row) => ({
      section: "by_district",
      districtName: row.districtName,
      state: row.state,
      amountInr: row.amountInr
    }));
    return [...periodRows, ...districtRows];
  }

  if (report === "loan_pipeline") {
    const byStatusRows = payload.loanPipeline.byStatus.map((row) => ({
      section: "by_status",
      status: row.status,
      count: row.count
    }));
    const byLenderRows = payload.loanPipeline.byLender.map((row) => ({
      section: "by_lender",
      lender: row.lender,
      count: row.count
    }));
    const byDistrictRows = payload.loanPipeline.byDistrict.map((row) => ({
      section: "by_district",
      districtName: row.districtName,
      state: row.state,
      applications: row.applications
    }));
    return [...byStatusRows, ...byLenderRows, ...byDistrictRows];
  }

  return payload.customerCommunication.byChannel.map((row) => ({
    channel: row.channel,
    total: row.total,
    sent: row.sent,
    failed: row.failed,
    deliveryRatePercent: row.deliveryRate
  }));
}

reportsRouter.get(
  "/",
  allowRoles("SUPER_ADMIN", "ADMIN", "DISTRICT_MANAGER"),
  validateQuery(reportsQuerySchema),
  async (req, res) => {
    const query = req.query as unknown as ReportsQuery;
    const data = await buildReportsPayload(req.user!, query);
    return ok(res, data, "Reports fetched");
  }
);

reportsRouter.get(
  "/export",
  allowRoles("SUPER_ADMIN", "ADMIN", "DISTRICT_MANAGER"),
  validateQuery(reportExportQuerySchema),
  async (req, res) => {
    const query = req.query as unknown as ReportExportQuery;
    const data = await buildReportsPayload(req.user!, query);
    const rows = rowsForReport(data, query.report);
    const fileDate = new Date().toISOString().slice(0, 10);

    if (query.format === "csv") {
      const csv = toCsv(rows);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${query.report}-${fileDate}.csv"`
      );
      return res.status(200).send(csv);
    }

    const pdf = buildSimplePdf(`Report: ${query.report}`, rows, data.generatedAt);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${query.report}-${fileDate}.pdf"`
    );
    return res.status(200).send(pdf);
  }
);
