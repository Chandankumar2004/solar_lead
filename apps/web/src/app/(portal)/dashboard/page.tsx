"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { api } from "@/lib/api";
import { DashboardCharts } from "@/components/DashboardCharts";
import { RealtimeNotifications } from "@/components/RealtimeNotifications";

type DashboardSummary = {
  filters: {
    dateFrom: string | null;
    dateTo: string | null;
    districtId: string | null;
    executiveId: string | null;
  };
  totals: {
    today: number;
    week: number;
    month: number;
  };
  pendingVerifications: {
    documents: number;
    payments: number;
    total: number;
  };
  leadsByStatus: Array<{
    statusId: string;
    statusName: string;
    orderIndex: number;
    isTerminal: boolean;
    colorCode?: string | null;
    count: number;
  }>;
  leadsByDistrict: Array<{
    districtId: string;
    districtName: string;
    state: string;
    count: number;
  }>;
  leadsByInstallationType: Array<{
    installationType: string;
    count: number;
  }>;
  fieldExecutivePerformance: Array<{
    executiveId: string;
    fullName: string;
    email: string;
    phone?: string | null;
    employeeId?: string | null;
    totalAssigned: number;
    activeLeads: number;
    terminalLeads: number;
    pendingDocuments: number;
    pendingPayments: number;
  }>;
  generatedAt: string;
};

type DashboardEnvelope = {
  data: DashboardSummary;
};

type DistrictOption = {
  id: string;
  name: string;
  state: string;
};

const fetcher = (url: string) => api.get(url).then((response) => response.data);

export default function DashboardPage() {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [districtId, setDistrictId] = useState("");
  const [executiveId, setExecutiveId] = useState("");

  const dashboardKey = useMemo(() => {
    const params = new URLSearchParams();
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    if (districtId) params.set("districtId", districtId);
    if (executiveId) params.set("executiveId", executiveId);
    const query = params.toString();
    return query ? `/api/dashboard/summary?${query}` : "/api/dashboard/summary";
  }, [dateFrom, dateTo, districtId, executiveId]);

  const {
    data: dashboardResponse,
    isLoading,
    isValidating,
    mutate
  } = useSWR(dashboardKey, fetcher, {
    refreshInterval: 60000,
    revalidateOnFocus: false
  });

  const { data: districtsResponse } = useSWR("/public/districts", fetcher);

  const summary = (dashboardResponse as DashboardEnvelope | undefined)?.data;
  const districts = ((districtsResponse?.data?.districts ?? []) as DistrictOption[]).sort((a, b) =>
    a.name.localeCompare(b.name)
  );
  const executives = summary?.fieldExecutivePerformance ?? [];

  const onReset = () => {
    setDateFrom("");
    setDateTo("");
    setDistrictId("");
    setExecutiveId("");
  };

  return (
    <div className="space-y-6">
      <section className="rounded-xl bg-white p-4 shadow-sm">
        <div className="grid gap-3 md:grid-cols-5">
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
          <div className="flex items-end gap-2">
            <button
              onClick={() => void mutate()}
              className="rounded-md border border-brand-300 bg-brand-50 px-3 py-2 text-sm font-medium text-brand-700 hover:bg-brand-100"
            >
              Refresh now
            </button>
            <button
              onClick={onReset}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              Reset
            </button>
          </div>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Auto refresh every 60s {isValidating ? "• updating..." : ""}
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-xl bg-white p-4 shadow-sm">
          <p className="text-sm text-slate-500">Today</p>
          <p className="mt-1 text-2xl font-semibold">
            {isLoading ? "..." : summary?.totals.today ?? 0}
          </p>
        </div>
        <div className="rounded-xl bg-white p-4 shadow-sm">
          <p className="text-sm text-slate-500">This Week</p>
          <p className="mt-1 text-2xl font-semibold">
            {isLoading ? "..." : summary?.totals.week ?? 0}
          </p>
        </div>
        <div className="rounded-xl bg-white p-4 shadow-sm">
          <p className="text-sm text-slate-500">This Month</p>
          <p className="mt-1 text-2xl font-semibold">
            {isLoading ? "..." : summary?.totals.month ?? 0}
          </p>
        </div>
        <div className="rounded-xl bg-white p-4 shadow-sm">
          <p className="text-sm text-slate-500">Pending Docs</p>
          <p className="mt-1 text-2xl font-semibold">
            {isLoading ? "..." : summary?.pendingVerifications.documents ?? 0}
          </p>
        </div>
        <div className="rounded-xl bg-white p-4 shadow-sm">
          <p className="text-sm text-slate-500">Pending Payments</p>
          <p className="mt-1 text-2xl font-semibold">
            {isLoading ? "..." : summary?.pendingVerifications.payments ?? 0}
          </p>
        </div>
      </section>

      {summary ? <DashboardCharts summary={summary} /> : null}

      <section className="rounded-xl bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold">Field Executive Performance</h3>
          <span className="text-xs text-slate-500">
            Updated {summary ? new Date(summary.generatedAt).toLocaleString() : "-"}
          </span>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-100 text-left text-xs uppercase text-slate-600">
              <tr>
                <th className="px-3 py-2">Executive</th>
                <th className="px-3 py-2">Assigned</th>
                <th className="px-3 py-2">Active</th>
                <th className="px-3 py-2">Terminal</th>
                <th className="px-3 py-2">Pending Docs</th>
                <th className="px-3 py-2">Pending Payments</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td className="px-3 py-3 text-slate-500" colSpan={6}>
                    Loading executive performance...
                  </td>
                </tr>
              ) : executives.length === 0 ? (
                <tr>
                  <td className="px-3 py-3 text-slate-500" colSpan={6}>
                    No executives in current filter scope.
                  </td>
                </tr>
              ) : (
                executives.map((executive) => (
                  <tr key={executive.executiveId} className="border-t border-slate-100">
                    <td className="px-3 py-2">
                      <p className="font-medium">{executive.fullName}</p>
                      <p className="text-xs text-slate-500">{executive.email}</p>
                    </td>
                    <td className="px-3 py-2">{executive.totalAssigned}</td>
                    <td className="px-3 py-2">{executive.activeLeads}</td>
                    <td className="px-3 py-2">{executive.terminalLeads}</td>
                    <td className="px-3 py-2">{executive.pendingDocuments}</td>
                    <td className="px-3 py-2">{executive.pendingPayments}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <RealtimeNotifications />
    </div>
  );
}
