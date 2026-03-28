"use client";

import Link from "next/link";
import { type ChangeEvent, useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";

type LeadRow = {
  id: string;
  externalId: string;
  name: string;
  phone: string;
  email?: string | null;
  utmSource?: string | null;
  state?: string | null;
  installationType?: string | null;
  createdAt: string;
  updatedAt: string;
  isOverdue?: boolean;
  district?: { id: string; name: string; state: string } | null;
  currentStatus?: { id: string; name: string } | null;
  assignedExecutive?: { id: string; fullName: string } | null;
};

type Pagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

type LeadsEnvelope = {
  data: LeadRow[];
  pagination: Pagination | null;
};

type DistrictOption = { id: string; name: string; state: string };

type DashboardSummaryEnvelope = {
  data?: {
    leadsByStatus?: Array<{
      statusId: string;
      statusName: string;
      orderIndex: number;
    }>;
    fieldExecutivePerformance?: Array<{
      executiveId: string;
      fullName: string;
    }>;
  };
};

type TransitionsEnvelope = {
  data?: Array<{
    id: string;
    fromStatus?: { id: string; name: string } | null;
    toStatus?: { id: string; name: string } | null;
  }>;
};

const fetcher = (url: string) => api.get(url).then((response) => response.data);
const PRIORITY_STATES = ["Bihar", "Delhi"] as const;
const PRIORITY_STATE_RANK = new Map(
  PRIORITY_STATES.map((state, index) => [state.toLocaleLowerCase("en-US"), index])
);
const TERMINAL_STATUS_NAMES = new Set(
  ["Installation Complete", "Closed (Lost)"].map((status) =>
    status.toLocaleLowerCase("en-US")
  )
);

function compareStateOrder(left: string, right: string) {
  const leftKey = left.trim().toLocaleLowerCase("en-US");
  const rightKey = right.trim().toLocaleLowerCase("en-US");

  const leftRank = PRIORITY_STATE_RANK.get(leftKey);
  const rightRank = PRIORITY_STATE_RANK.get(rightKey);

  if (leftRank !== undefined || rightRank !== undefined) {
    if (leftRank === undefined) return 1;
    if (rightRank === undefined) return -1;
    if (leftRank !== rightRank) return leftRank - rightRank;
  }

  return left.localeCompare(right);
}

function compareDistrictOrder(left: DistrictOption, right: DistrictOption) {
  const stateCompare = compareStateOrder(left.state, right.state);
  if (stateCompare !== 0) return stateCompare;
  return left.name.localeCompare(right.name);
}

function extractApiMessage(error: unknown) {
  const maybe = error as { response?: { data?: { message?: string } } };
  return maybe.response?.data?.message ?? "Operation failed";
}

function isTerminalStatusName(statusName?: string | null) {
  if (!statusName) return false;
  return TERMINAL_STATUS_NAMES.has(statusName.trim().toLocaleLowerCase("en-US"));
}

export default function LeadsPage() {
  const user = useAuthStore((state) => state.user);
  const canLoadTransitions = user?.role === "SUPER_ADMIN";
  const canDeleteLead = user?.role === "SUPER_ADMIN";

  const [search, setSearch] = useState("");
  const [statusIds, setStatusIds] = useState<string[]>([]);
  const [districtIds, setDistrictIds] = useState<string[]>([]);
  const [stateFilter, setStateFilter] = useState("");
  const [executiveId, setExecutiveId] = useState("");
  const [type, setType] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [overdueFilter, setOverdueFilter] = useState<"" | "true" | "false">("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [assignmentDraft, setAssignmentDraft] = useState<Record<string, string>>({});
  const [statusDraft, setStatusDraft] = useState<Record<string, string>>({});
  const [actionKeyLoading, setActionKeyLoading] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("pageSize", String(pageSize));
    if (search.trim()) params.set("search", search.trim());
    if (statusIds.length > 0) params.set("statusIds", statusIds.join(","));
    if (districtIds.length > 0) params.set("districtIds", districtIds.join(","));
    if (stateFilter.trim()) params.set("state", stateFilter.trim());
    if (executiveId) params.set("execId", executiveId);
    if (type.trim()) params.set("type", type.trim());
    if (sourceFilter.trim()) params.set("source", sourceFilter.trim());
    if (overdueFilter) params.set("isOverdue", overdueFilter);
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    return `/api/leads?${params.toString()}`;
  }, [
    dateFrom,
    dateTo,
    districtIds,
    executiveId,
    overdueFilter,
    page,
    pageSize,
    search,
    sourceFilter,
    stateFilter,
    statusIds,
    type
  ]);

  const dashboardOptionsKey = useMemo(() => {
    if (districtIds.length !== 1) return "/api/dashboard/summary";
    const params = new URLSearchParams();
    params.set("districtId", districtIds[0]);
    return `/api/dashboard/summary?${params.toString()}`;
  }, [districtIds]);

  const { data, isLoading, mutate } = useSWR(query, fetcher);
  const { data: districtsData } = useSWR("/public/districts", fetcher);
  const { data: dashboardData } = useSWR(dashboardOptionsKey, fetcher);
  const { data: transitionsData } = useSWR(
    canLoadTransitions ? "/api/lead-statuses/transitions" : null,
    fetcher
  );

  const envelope = data as LeadsEnvelope | undefined;
  const leads = envelope?.data ?? [];
  const pagination = envelope?.pagination;

  const districts = ((districtsData?.data?.districts ?? []) as DistrictOption[]).sort(
    compareDistrictOrder
  );

  const states = Array.from(new Set(districts.map((district) => district.state)));

  const dashboardOptions = dashboardData as DashboardSummaryEnvelope | undefined;
  const statusOptions = (dashboardOptions?.data?.leadsByStatus ?? [])
    .map((item) => ({
      id: item.statusId,
      name: item.statusName,
      orderIndex: item.orderIndex
    }))
    .sort((a, b) => a.orderIndex - b.orderIndex || a.name.localeCompare(b.name));

  const executiveOptions = (dashboardOptions?.data?.fieldExecutivePerformance ?? []).map(
    (item) => ({
      id: item.executiveId,
      name: item.fullName
    })
  );

  const transitionEnvelope = transitionsData as TransitionsEnvelope | undefined;
  const transitionMap = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const transition of transitionEnvelope?.data ?? []) {
      const fromId = transition.fromStatus?.id;
      const toId = transition.toStatus?.id;
      if (!fromId || !toId) continue;
      const set = map.get(fromId) ?? new Set<string>();
      set.add(toId);
      map.set(fromId, set);
    }
    return map;
  }, [transitionEnvelope?.data]);

  useEffect(() => {
    setPage(1);
  }, [
    search,
    statusIds,
    districtIds,
    stateFilter,
    executiveId,
    type,
    sourceFilter,
    overdueFilter,
    dateFrom,
    dateTo,
    pageSize
  ]);

  const onStatusMultiChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const selected = Array.from(event.target.selectedOptions).map((option) => option.value);
    setStatusIds(selected);
  };

  const onDistrictMultiChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const selected = Array.from(event.target.selectedOptions).map((option) => option.value);
    setDistrictIds(selected);
  };

  const onAssign = async (lead: LeadRow) => {
    const selectedExecutiveId = assignmentDraft[lead.id];
    if (!selectedExecutiveId) return;
    const isReassignment =
      Boolean(lead.assignedExecutive?.id) &&
      lead.assignedExecutive?.id !== selectedExecutiveId;
    const endpoint = isReassignment
      ? `/api/leads/${lead.id}/reassign`
      : `/api/leads/${lead.id}/assign`;

    let reassignmentReason: string | null = null;
    if (isReassignment) {
      const input = window.prompt("Reassignment reason (min 5 characters):", "");
      if (input === null) return;
      if (input.trim().length < 5) {
        setActionMessage({
          type: "error",
          text: "Reassignment reason must be at least 5 characters."
        });
        return;
      }
      reassignmentReason = input.trim();
    }

    const confirmed = window.confirm(
      isReassignment
        ? `Reassign lead ${lead.externalId} to selected executive?`
        : `Assign lead ${lead.externalId} to selected executive?`
    );
    if (!confirmed) return;

    setActionMessage(null);
    setActionKeyLoading(`${lead.id}:assign`);
    try {
      await api.post(endpoint, {
        assignedExecutiveId: selectedExecutiveId,
        ...(reassignmentReason ? { reason: reassignmentReason } : {})
      });
      setActionMessage({
        type: "success",
        text: `${isReassignment ? "Reassigned" : "Assigned"} ${lead.name} successfully`
      });
      await mutate();
    } catch (error) {
      setActionMessage({ type: "error", text: extractApiMessage(error) });
    } finally {
      setActionKeyLoading(null);
    }
  };

  const onChangeStatus = async (lead: LeadRow) => {
    const nextStatusId = statusDraft[lead.id];
    if (!nextStatusId) return;

    const terminalReopen = isTerminalStatusName(lead.currentStatus?.name);
    let overrideReason: string | undefined;
    if (terminalReopen) {
      if (user?.role !== "SUPER_ADMIN") {
        setActionMessage({
          type: "error",
          text: "Only Super Admin can reopen a lead from terminal status."
        });
        return;
      }

      const input = window.prompt("Override reason for reopening this terminal lead:", "");
      if (input === null) return;
      if (input.trim().length < 5) {
        setActionMessage({
          type: "error",
          text: "Override reason must be at least 5 characters."
        });
        return;
      }
      overrideReason = input.trim();
    }

    setActionMessage(null);
    setActionKeyLoading(`${lead.id}:status`);
    try {
      await api.post(`/api/leads/${lead.id}/transition`, {
        nextStatusId,
        notes: terminalReopen
          ? "Terminal override from leads list"
          : "Quick status update from leads list",
        ...(overrideReason ? { overrideReason } : {})
      });
      setActionMessage({ type: "success", text: `Updated status for ${lead.name}` });
      await mutate();
    } catch (error) {
      setActionMessage({ type: "error", text: extractApiMessage(error) });
    } finally {
      setActionKeyLoading(null);
    }
  };

  const onDeleteLead = async (lead: LeadRow) => {
    if (!canDeleteLead) return;
    const confirmed = window.confirm(
      `Delete lead "${lead.name}" (${lead.externalId})? This cannot be undone.`
    );
    if (!confirmed) return;

    setActionMessage(null);
    setActionKeyLoading(`${lead.id}:delete`);
    try {
      await api.delete(`/api/leads/${lead.id}`);
      setActionMessage({ type: "success", text: `Deleted ${lead.name}` });
      await mutate();
    } catch (error) {
      setActionMessage({ type: "error", text: extractApiMessage(error) });
    } finally {
      setActionKeyLoading(null);
    }
  };

  return (
    <div className="space-y-4">
      <section className="rounded-xl bg-white p-3 shadow-sm sm:p-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search name / phone / email"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <select
            multiple
            value={statusIds}
            onChange={onStatusMultiChange}
            className="min-h-24 rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            {statusOptions.map((status) => (
              <option key={status.id} value={status.id}>
                {status.name}
              </option>
            ))}
          </select>
          <select
            multiple
            value={districtIds}
            onChange={onDistrictMultiChange}
            className="min-h-24 rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            {districts.map((district) => (
              <option key={district.id} value={district.id}>
                {district.name} ({district.state})
              </option>
            ))}
          </select>
          <select
            value={stateFilter}
            onChange={(event) => setStateFilter(event.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">All states</option>
            {states.map((state) => (
              <option key={state} value={state}>
                {state}
              </option>
            ))}
          </select>
          <select
            value={executiveId}
            onChange={(event) => setExecutiveId(event.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">All executives</option>
            {executiveOptions.map((executive) => (
              <option key={executive.id} value={executive.id}>
                {executive.name}
              </option>
            ))}
          </select>
          <input
            value={type}
            onChange={(event) => setType(event.target.value)}
            placeholder="Installation type"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            value={sourceFilter}
            onChange={(event) => setSourceFilter(event.target.value)}
            placeholder="UTM source"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <select
            value={overdueFilter}
            onChange={(event) =>
              setOverdueFilter(event.target.value as "" | "true" | "false")
            }
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">All SLA states</option>
            <option value="true">Overdue only</option>
            <option value="false">Within SLA</option>
          </select>
          <input
            type="date"
            value={dateFrom}
            onChange={(event) => setDateFrom(event.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            type="date"
            value={dateTo}
            onChange={(event) => setDateTo(event.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-slate-500">
            Hold Ctrl/Cmd to select multiple statuses and districts.
          </p>
          <button
            onClick={() => {
              setSearch("");
              setStatusIds([]);
              setDistrictIds([]);
              setStateFilter("");
              setExecutiveId("");
              setType("");
              setSourceFilter("");
              setOverdueFilter("");
              setDateFrom("");
              setDateTo("");
            }}
            className="rounded border border-slate-300 px-3 py-1 text-xs text-slate-700 hover:bg-slate-50"
          >
            Reset filters
          </button>
        </div>
      </section>

      {actionMessage ? (
        <section
          className={`rounded-md border px-3 py-2 text-sm ${
            actionMessage.type === "success"
              ? "border-emerald-300 bg-emerald-50 text-emerald-800"
              : "border-rose-300 bg-rose-50 text-rose-800"
          }`}
        >
          {actionMessage.text}
        </section>
      ) : null}

      <section className="overflow-hidden rounded-xl bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-100 text-left text-xs uppercase text-slate-600">
              <tr>
                <th className="px-4 py-3">Lead ID</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Phone</th>
                <th className="px-4 py-3">District</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Executive</th>
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3">Updated</th>
                <th className="px-4 py-3">Quick Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td className="px-4 py-4 text-slate-500" colSpan={10}>
                    Loading leads...
                  </td>
                </tr>
              ) : leads.length === 0 ? (
                <tr>
                  <td className="px-4 py-4 text-slate-500" colSpan={10}>
                    No leads found.
                  </td>
                </tr>
              ) : (
                leads.map((lead) => {
                  const currentStatusId = lead.currentStatus?.id ?? "";
                  const allowedSet = transitionMap.get(currentStatusId);
                  const statusCandidates = statusOptions.filter((status) => {
                    if (status.id === currentStatusId) return false;
                    if (!allowedSet || allowedSet.size === 0) return true;
                    return allowedSet.has(status.id);
                  });
                  const assignSelected =
                    assignmentDraft[lead.id] ?? lead.assignedExecutive?.id ?? "";
                  const nextStatusSelected = statusDraft[lead.id] ?? "";

                  return (
                    <tr key={lead.id} className="border-t border-slate-100 align-top">
                      <td className="px-4 py-3">
                        <p className="text-xs text-slate-700">{lead.externalId}</p>
                      </td>
                      <td className="px-4 py-3">
                        <Link href={`/leads/${lead.id}`} className="font-medium text-brand-700 hover:underline">
                          {lead.name}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <p>{lead.phone}</p>
                        <p className="text-xs text-slate-500">{lead.email ?? "-"}</p>
                      </td>
                      <td className="px-4 py-3">{lead.district?.name ?? "-"}</td>
                      <td className="px-4 py-3">
                        <p>{lead.currentStatus?.name ?? "-"}</p>
                        <span
                          className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${
                            lead.isOverdue
                              ? "bg-rose-100 text-rose-700 ring-1 ring-rose-200"
                              : "bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200"
                          }`}
                        >
                          {lead.isOverdue ? "SLA Overdue" : "Within SLA"}
                        </span>
                      </td>
                      <td className="px-4 py-3">{lead.assignedExecutive?.fullName ?? "-"}</td>
                      <td className="px-4 py-3">{lead.utmSource ?? "-"}</td>
                      <td className="px-4 py-3">{new Date(lead.createdAt).toLocaleDateString()}</td>
                      <td className="px-4 py-3">{new Date(lead.updatedAt).toLocaleDateString()}</td>
                      <td className="px-4 py-3">
                        <div className="min-w-[220px] space-y-2">
                          <Link
                            href={`/leads/${lead.id}`}
                            className="inline-block rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50"
                          >
                            View
                          </Link>
                          {canDeleteLead ? (
                            <button
                              onClick={() => void onDeleteLead(lead)}
                              disabled={actionKeyLoading === `${lead.id}:delete`}
                              className="ml-2 inline-block rounded border border-rose-300 px-2 py-1 text-xs text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                            >
                              {actionKeyLoading === `${lead.id}:delete` ? "Deleting..." : "Delete"}
                            </button>
                          ) : null}
                          <div className="space-y-1">
                            <select
                              value={assignSelected}
                              onChange={(event) =>
                                setAssignmentDraft((prev) => ({
                                  ...prev,
                                  [lead.id]: event.target.value
                                }))
                              }
                              className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
                            >
                              <option value="">Select executive</option>
                              {executiveOptions.map((executive) => (
                                <option key={executive.id} value={executive.id}>
                                  {executive.name}
                                </option>
                              ))}
                            </select>
                            <button
                              onClick={() => void onAssign(lead)}
                              disabled={
                                !assignSelected ||
                                assignSelected === (lead.assignedExecutive?.id ?? "") ||
                                actionKeyLoading === `${lead.id}:assign`
                              }
                              className="w-full rounded border border-slate-300 px-2 py-1 text-xs disabled:opacity-50"
                            >
                              {actionKeyLoading === `${lead.id}:assign` ? "Assigning..." : "Assign"}
                            </button>
                          </div>
                          <div className="space-y-1">
                            <select
                              value={nextStatusSelected}
                              onChange={(event) =>
                                setStatusDraft((prev) => ({
                                  ...prev,
                                  [lead.id]: event.target.value
                                }))
                              }
                              className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
                            >
                              <option value="">Select next status</option>
                              {statusCandidates.map((status) => (
                                <option key={status.id} value={status.id}>
                                  {status.name}
                                </option>
                              ))}
                            </select>
                            <button
                              onClick={() => void onChangeStatus(lead)}
                              disabled={
                                !nextStatusSelected ||
                                actionKeyLoading === `${lead.id}:status`
                              }
                              className="w-full rounded border border-slate-300 px-2 py-1 text-xs disabled:opacity-50"
                            >
                              {actionKeyLoading === `${lead.id}:status`
                                ? "Updating..."
                                : "Change status"}
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl bg-white px-3 py-3 shadow-sm sm:px-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-slate-600">Total: {pagination?.total ?? 0}</p>
            <select
              value={pageSize}
              onChange={(event) => {
                const next = Number(event.target.value);
                setPageSize(next);
                setPage(1);
              }}
              className="rounded border border-slate-300 px-2 py-1 text-sm"
            >
              <option value={10}>10 / page</option>
              <option value={20}>20 / page</option>
              <option value={50}>50 / page</option>
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={(pagination?.page ?? 1) <= 1}
              className="rounded border border-slate-300 px-3 py-1 text-sm disabled:opacity-50"
            >
              Previous
            </button>
            <span className="text-sm text-slate-600">
              Page {pagination?.page ?? 1} / {pagination?.totalPages ?? 1}
            </span>
            <button
              onClick={() =>
                setPage((current) =>
                  Math.min(pagination?.totalPages ?? 1, current + 1)
                )
              }
              disabled={(pagination?.page ?? 1) >= (pagination?.totalPages ?? 1)}
              className="rounded border border-slate-300 px-3 py-1 text-sm disabled:opacity-50"
            >
              Next
            </button>
            <button
              onClick={() => void mutate()}
              className="rounded border border-brand-300 bg-brand-50 px-3 py-1 text-sm text-brand-700 hover:bg-brand-100"
            >
              Refresh
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
