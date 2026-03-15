"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { api } from "@/lib/api";

type DistrictOption = {
  id: string;
  name: string;
  state: string;
};

type ReportsPayload = {
  filters: {
    dateFrom: string | null;
    dateTo: string | null;
    districtId: string | null;
    executiveId: string | null;
    channel: string | null;
  };
  leadSource: Array<{
    utmSource: string;
    utmMedium: string;
    utmCampaign: string;
    leads: number;
  }>;
  leadPipeline: {
    stages: Array<{
      statusId: string;
      statusName: string;
      orderIndex: number;
      leads: number;
    }>;
    transitions: Array<{
      fromStatus: string;
      toStatus: string;
      fromLeads: number;
      toLeads: number;
      conversionRate: number;
    }>;
  };
  districtPerformance: Array<{
    districtId: string;
    districtName: string;
    state: string;
    totalLeads: number;
    installationComplete: number;
    conversionRate: number;
  }>;
  fieldExecutivePerformance: Array<{
    executiveId: string;
    fullName: string;
    email: string;
    leadsAssigned: number;
    visitsCompleted: number;
    documentsSubmitted: number;
    tokenCollectionsInr: number;
  }>;
  revenue: {
    totalInr: number;
    byPeriod: Array<{
      period: string;
      amountInr: number;
    }>;
    byDistrict: Array<{
      districtId: string;
      districtName: string;
      state: string;
      amountInr: number;
    }>;
  };
  loanPipeline: {
    totalApplications: number;
    byStatus: Array<{ status: string; count: number }>;
    byLender: Array<{ lender: string; count: number }>;
    byDistrict: Array<{
      districtId: string;
      districtName: string;
      state: string;
      applications: number;
    }>;
  };
  customerCommunication: {
    totalLogs: number;
    byChannel: Array<{
      channel: string;
      total: number;
      sent: number;
      failed: number;
      deliveryRate: number;
    }>;
  };
  generatedAt: string;
};

type ReportKey =
  | "lead_source"
  | "lead_pipeline"
  | "district_performance"
  | "field_executive_performance"
  | "revenue"
  | "loan_pipeline"
  | "customer_communication";

const fetcher = (url: string) => api.get(url).then((response) => response.data);

function extractApiMessage(error: unknown) {
  const maybe = error as { response?: { data?: { message?: string } } };
  return maybe.response?.data?.message ?? "Request failed";
}

export default function ReportsPage() {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [districtId, setDistrictId] = useState("");
  const [executiveId, setExecutiveId] = useState("");
  const [channel, setChannel] = useState<"" | "SMS" | "EMAIL" | "WHATSAPP" | "PUSH">("");
  const [exporting, setExporting] = useState<`${ReportKey}:${"csv" | "pdf"}` | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const reportsKey = useMemo(() => {
    const params = new URLSearchParams();
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    if (districtId) params.set("districtId", districtId);
    if (executiveId) params.set("executiveId", executiveId);
    if (channel) params.set("channel", channel);
    const query = params.toString();
    return query ? `/api/reports?${query}` : "/api/reports";
  }, [channel, dateFrom, dateTo, districtId, executiveId]);

  const { data: reportsResponse, error, isLoading, mutate } = useSWR(reportsKey, fetcher, {
    refreshInterval: 60000,
    revalidateOnFocus: false
  });
  const reports = reportsResponse?.data as ReportsPayload | undefined;

  const { data: districtsResponse } = useSWR("/public/districts", fetcher);
  const districts = ((districtsResponse?.data?.districts ?? []) as DistrictOption[]).sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  const executives = reports?.fieldExecutivePerformance ?? [];

  const buildExportQuery = (report: ReportKey, format: "csv" | "pdf") => {
    const params = new URLSearchParams();
    params.set("report", report);
    params.set("format", format);
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    if (districtId) params.set("districtId", districtId);
    if (executiveId) params.set("executiveId", executiveId);
    if (channel) params.set("channel", channel);
    return params.toString();
  };

  const downloadReport = async (report: ReportKey, format: "csv" | "pdf") => {
    const key = `${report}:${format}` as const;
    setActionError(null);
    setExporting(key);
    try {
      const query = buildExportQuery(report, format);
      const response = await api.get(`/api/reports/export?${query}`, {
        responseType: "blob"
      });
      const blob = new Blob([response.data], {
        type: format === "csv" ? "text/csv;charset=utf-8" : "application/pdf"
      });
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${report}.${format}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
    } catch (downloadError) {
      setActionError(extractApiMessage(downloadError));
    } finally {
      setExporting(null);
    }
  };

  const resetFilters = () => {
    setDateFrom("");
    setDateTo("");
    setDistrictId("");
    setExecutiveId("");
    setChannel("");
  };

  const ExportButtons = ({ report }: { report: ReportKey }) => (
    <div className="flex flex-wrap gap-2">
      <button
        onClick={() => void downloadReport(report, "csv")}
        disabled={exporting !== null}
        className="rounded border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
      >
        {exporting === `${report}:csv` ? "Exporting..." : "Export CSV"}
      </button>
      <button
        onClick={() => void downloadReport(report, "pdf")}
        disabled={exporting !== null}
        className="rounded border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
      >
        {exporting === `${report}:pdf` ? "Exporting..." : "Export PDF"}
      </button>
    </div>
  );

  return (
    <div className="space-y-4">
      <section className="rounded-xl bg-white p-3 shadow-sm sm:p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Date from</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Date to</label>
            <input
              type="date"
              value={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">District</label>
            <select
              value={districtId}
              onChange={(event) => setDistrictId(event.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">All districts</option>
              {districts.map((district) => (
                <option key={district.id} value={district.id}>
                  {district.name} ({district.state})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Executive</label>
            <select
              value={executiveId}
              onChange={(event) => setExecutiveId(event.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">All executives</option>
              {executives.map((executive) => (
                <option key={executive.executiveId} value={executive.executiveId}>
                  {executive.fullName}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Channel</label>
            <select
              value={channel}
              onChange={(event) =>
                setChannel(event.target.value as "" | "SMS" | "EMAIL" | "WHATSAPP" | "PUSH")
              }
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">SMS/Email/WhatsApp</option>
              <option value="SMS">SMS</option>
              <option value="EMAIL">Email</option>
              <option value="WHATSAPP">WhatsApp</option>
              <option value="PUSH">Push</option>
            </select>
          </div>
          <div className="flex items-end gap-2">
            <button
              onClick={() => void mutate()}
              className="rounded-md border border-brand-300 bg-brand-50 px-3 py-2 text-sm font-medium text-brand-700 hover:bg-brand-100"
            >
              Refresh
            </button>
            <button
              onClick={resetFilters}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              Reset
            </button>
          </div>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Auto refresh every 60s {reports ? `• updated ${new Date(reports.generatedAt).toLocaleString()}` : ""}
        </p>
      </section>

      {actionError ? (
        <section className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {actionError}
        </section>
      ) : null}

      {error ? (
        <section className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          Failed to load reports. Please refresh.
        </section>
      ) : null}

      <section className="rounded-xl bg-white p-3 shadow-sm sm:p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold">Lead Source Report</h2>
          <ExportButtons report="lead_source" />
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-100 text-left text-xs uppercase text-slate-600">
              <tr>
                <th className="px-3 py-2">Source</th>
                <th className="px-3 py-2">Medium</th>
                <th className="px-3 py-2">Campaign</th>
                <th className="px-3 py-2">Leads</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td className="px-3 py-3 text-slate-500" colSpan={4}>Loading...</td></tr>
              ) : (reports?.leadSource.length ?? 0) === 0 ? (
                <tr><td className="px-3 py-3 text-slate-500" colSpan={4}>No data.</td></tr>
              ) : (
                reports!.leadSource.map((row, index) => (
                  <tr key={`${row.utmSource}-${row.utmMedium}-${row.utmCampaign}-${index}`} className="border-t border-slate-100">
                    <td className="px-3 py-2">{row.utmSource}</td>
                    <td className="px-3 py-2">{row.utmMedium}</td>
                    <td className="px-3 py-2">{row.utmCampaign}</td>
                    <td className="px-3 py-2">{row.leads}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl bg-white p-3 shadow-sm sm:p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold">Lead Pipeline Report</h2>
          <ExportButtons report="lead_pipeline" />
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-100 text-left text-xs uppercase text-slate-600">
              <tr>
                <th className="px-3 py-2">From</th>
                <th className="px-3 py-2">To</th>
                <th className="px-3 py-2">From Leads</th>
                <th className="px-3 py-2">To Leads</th>
                <th className="px-3 py-2">Conversion %</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td className="px-3 py-3 text-slate-500" colSpan={5}>Loading...</td></tr>
              ) : (reports?.leadPipeline.transitions.length ?? 0) === 0 ? (
                <tr><td className="px-3 py-3 text-slate-500" colSpan={5}>No data.</td></tr>
              ) : (
                reports!.leadPipeline.transitions.map((row, index) => (
                  <tr key={`${row.fromStatus}-${row.toStatus}-${index}`} className="border-t border-slate-100">
                    <td className="px-3 py-2">{row.fromStatus}</td>
                    <td className="px-3 py-2">{row.toStatus}</td>
                    <td className="px-3 py-2">{row.fromLeads}</td>
                    <td className="px-3 py-2">{row.toLeads}</td>
                    <td className="px-3 py-2">{row.conversionRate.toFixed(2)}%</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl bg-white p-3 shadow-sm sm:p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold">District Performance Report</h2>
          <ExportButtons report="district_performance" />
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-100 text-left text-xs uppercase text-slate-600">
              <tr>
                <th className="px-3 py-2">District</th>
                <th className="px-3 py-2">State</th>
                <th className="px-3 py-2">Total Leads</th>
                <th className="px-3 py-2">Installation Complete</th>
                <th className="px-3 py-2">Conversion %</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td className="px-3 py-3 text-slate-500" colSpan={5}>Loading...</td></tr>
              ) : (reports?.districtPerformance.length ?? 0) === 0 ? (
                <tr><td className="px-3 py-3 text-slate-500" colSpan={5}>No data.</td></tr>
              ) : (
                reports!.districtPerformance.map((row) => (
                  <tr key={row.districtId} className="border-t border-slate-100">
                    <td className="px-3 py-2">{row.districtName}</td>
                    <td className="px-3 py-2">{row.state}</td>
                    <td className="px-3 py-2">{row.totalLeads}</td>
                    <td className="px-3 py-2">{row.installationComplete}</td>
                    <td className="px-3 py-2">{row.conversionRate.toFixed(2)}%</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl bg-white p-3 shadow-sm sm:p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold">Field Executive Performance Report</h2>
          <ExportButtons report="field_executive_performance" />
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-100 text-left text-xs uppercase text-slate-600">
              <tr>
                <th className="px-3 py-2">Executive</th>
                <th className="px-3 py-2">Leads Assigned</th>
                <th className="px-3 py-2">Visits Completed</th>
                <th className="px-3 py-2">Documents Submitted</th>
                <th className="px-3 py-2">Token Collections (INR)</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td className="px-3 py-3 text-slate-500" colSpan={5}>Loading...</td></tr>
              ) : (reports?.fieldExecutivePerformance.length ?? 0) === 0 ? (
                <tr><td className="px-3 py-3 text-slate-500" colSpan={5}>No data.</td></tr>
              ) : (
                reports!.fieldExecutivePerformance.map((row) => (
                  <tr key={row.executiveId} className="border-t border-slate-100">
                    <td className="px-3 py-2">
                      <p className="font-medium">{row.fullName}</p>
                      <p className="text-xs text-slate-500">{row.email}</p>
                    </td>
                    <td className="px-3 py-2">{row.leadsAssigned}</td>
                    <td className="px-3 py-2">{row.visitsCompleted}</td>
                    <td className="px-3 py-2">{row.documentsSubmitted}</td>
                    <td className="px-3 py-2">
                      {row.tokenCollectionsInr.toLocaleString("en-IN", {
                        style: "currency",
                        currency: "INR",
                        maximumFractionDigits: 0
                      })}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl bg-white p-3 shadow-sm sm:p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold">Revenue Report</h2>
          <ExportButtons report="revenue" />
        </div>
        <p className="mb-2 text-sm text-slate-600">
          Total:{" "}
          {reports?.revenue.totalInr.toLocaleString("en-IN", {
            style: "currency",
            currency: "INR",
            maximumFractionDigits: 0
          }) ?? "—"}
        </p>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="overflow-x-auto rounded border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-100 text-left text-xs uppercase text-slate-600">
                <tr><th className="px-3 py-2">Period</th><th className="px-3 py-2">Amount (INR)</th></tr>
              </thead>
              <tbody>
                {(reports?.revenue.byPeriod ?? []).map((row) => (
                  <tr key={row.period} className="border-t border-slate-100">
                    <td className="px-3 py-2">{row.period}</td>
                    <td className="px-3 py-2">{row.amountInr.toLocaleString("en-IN")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="overflow-x-auto rounded border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-100 text-left text-xs uppercase text-slate-600">
                <tr><th className="px-3 py-2">District</th><th className="px-3 py-2">Amount (INR)</th></tr>
              </thead>
              <tbody>
                {(reports?.revenue.byDistrict ?? []).map((row) => (
                  <tr key={row.districtId} className="border-t border-slate-100">
                    <td className="px-3 py-2">{row.districtName} ({row.state})</td>
                    <td className="px-3 py-2">{row.amountInr.toLocaleString("en-IN")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="rounded-xl bg-white p-3 shadow-sm sm:p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold">Loan Pipeline Report</h2>
          <ExportButtons report="loan_pipeline" />
        </div>
        <p className="mb-2 text-sm text-slate-600">Total applications: {reports?.loanPipeline.totalApplications ?? 0}</p>
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="overflow-x-auto rounded border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-100 text-left text-xs uppercase text-slate-600">
                <tr><th className="px-3 py-2">Status</th><th className="px-3 py-2">Count</th></tr>
              </thead>
              <tbody>
                {(reports?.loanPipeline.byStatus ?? []).map((row) => (
                  <tr key={row.status} className="border-t border-slate-100">
                    <td className="px-3 py-2">{row.status}</td>
                    <td className="px-3 py-2">{row.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="overflow-x-auto rounded border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-100 text-left text-xs uppercase text-slate-600">
                <tr><th className="px-3 py-2">Lender</th><th className="px-3 py-2">Count</th></tr>
              </thead>
              <tbody>
                {(reports?.loanPipeline.byLender ?? []).map((row) => (
                  <tr key={row.lender} className="border-t border-slate-100">
                    <td className="px-3 py-2">{row.lender}</td>
                    <td className="px-3 py-2">{row.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="overflow-x-auto rounded border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-100 text-left text-xs uppercase text-slate-600">
                <tr><th className="px-3 py-2">District</th><th className="px-3 py-2">Count</th></tr>
              </thead>
              <tbody>
                {(reports?.loanPipeline.byDistrict ?? []).map((row) => (
                  <tr key={row.districtId} className="border-t border-slate-100">
                    <td className="px-3 py-2">{row.districtName}</td>
                    <td className="px-3 py-2">{row.applications}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="rounded-xl bg-white p-3 shadow-sm sm:p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold">Customer Communication Report</h2>
          <ExportButtons report="customer_communication" />
        </div>
        <p className="mb-2 text-sm text-slate-600">Total logs: {reports?.customerCommunication.totalLogs ?? 0}</p>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-100 text-left text-xs uppercase text-slate-600">
              <tr>
                <th className="px-3 py-2">Channel</th>
                <th className="px-3 py-2">Total</th>
                <th className="px-3 py-2">Sent</th>
                <th className="px-3 py-2">Failed</th>
                <th className="px-3 py-2">Delivery %</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td className="px-3 py-3 text-slate-500" colSpan={5}>Loading...</td></tr>
              ) : (reports?.customerCommunication.byChannel.length ?? 0) === 0 ? (
                <tr><td className="px-3 py-3 text-slate-500" colSpan={5}>No data.</td></tr>
              ) : (
                reports!.customerCommunication.byChannel.map((row) => (
                  <tr key={row.channel} className="border-t border-slate-100">
                    <td className="px-3 py-2">{row.channel}</td>
                    <td className="px-3 py-2">{row.total}</td>
                    <td className="px-3 py-2">{row.sent}</td>
                    <td className="px-3 py-2">{row.failed}</td>
                    <td className="px-3 py-2">{row.deliveryRate.toFixed(2)}%</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
