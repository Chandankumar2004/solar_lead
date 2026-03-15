"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import useSWR from "swr";
import { api } from "@/lib/api";

type Role = "SUPER_ADMIN" | "ADMIN" | "MANAGER" | "EXECUTIVE";
type Status = "ACTIVE" | "PENDING" | "SUSPENDED" | "DEACTIVATED";

type District = {
  id: string;
  name: string;
  state: string;
};

type DistrictAssignment = {
  id: string;
  assignedAt: string;
  district: District;
};

type UserRow = {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  role: Role;
  roleLabel: string;
  employeeId: string | null;
  status: Status;
  statusLabel: string;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
  districtAssignments: DistrictAssignment[];
};

type Pagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

type UsersEnvelope = {
  data: UserRow[];
  pagination: Pagination | null;
};

type DistrictEnvelope = {
  data?: {
    districts?: District[];
  };
};

const fetcher = (url: string) => api.get(url).then((response) => response.data);

const ROLE_OPTIONS: Array<{ value: Role; label: string }> = [
  { value: "SUPER_ADMIN", label: "Super Admin" },
  { value: "ADMIN", label: "Admin" },
  { value: "MANAGER", label: "District Manager" },
  { value: "EXECUTIVE", label: "Field Executive" }
];

const STATUS_OPTIONS: Array<{ value: Status; label: string }> = [
  { value: "PENDING", label: "Pending" },
  { value: "ACTIVE", label: "Active" },
  { value: "SUSPENDED", label: "Suspended" },
  { value: "DEACTIVATED", label: "Deactivated" }
];

function extractApiError(error: unknown) {
  const maybe = error as {
    response?: {
      data?: {
        message?: string;
        error?: {
          code?: string;
          details?: {
            activeExecutiveLeadCount?: number;
            activeManagerLeadCount?: number;
            totalActiveLeadAssignments?: number;
          };
        };
      };
    };
  };
  return {
    message: maybe.response?.data?.message ?? "Operation failed",
    code: maybe.response?.data?.error?.code ?? null,
    details: maybe.response?.data?.error?.details ?? null
  };
}

export default function UsersPage() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("");
  const [districtId, setDistrictId] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("pageSize", String(pageSize));
    if (search.trim()) params.set("search", search.trim());
    if (role) params.set("role", role);
    if (status) params.set("status", status);
    if (districtId) params.set("districtId", districtId);
    return `/api/users?${params.toString()}`;
  }, [districtId, page, pageSize, role, search, status]);

  const { data, isLoading, mutate } = useSWR(query, fetcher);
  const { data: districtsData } = useSWR("/public/districts", fetcher);

  const envelope = data as UsersEnvelope | undefined;
  const users = envelope?.data ?? [];
  const pagination = envelope?.pagination;
  const districts = ((districtsData as DistrictEnvelope | undefined)?.data?.districts ??
    []) as District[];

  const runStatusAction = async (
    user: UserRow,
    action: "approve" | "suspend" | "deactivate"
  ) => {
    const actionKey = `${user.id}:${action}`;
    setActionMessage(null);

    const actionLabel =
      action === "approve" ? "approve" : action === "suspend" ? "suspend" : "deactivate";
    const confirmed = window.confirm(`Are you sure you want to ${actionLabel} ${user.fullName}?`);
    if (!confirmed) {
      return;
    }

    let payload: Record<string, string> = {};
    if (action === "suspend" || action === "deactivate") {
      if (action === "deactivate") {
        try {
          const detailResponse = await api.get(`/api/users/${user.id}`);
          const detailData = detailResponse.data?.data as
            | {
                workload?: {
                  activeExecutiveLeadCount?: number;
                  activeManagerLeadCount?: number;
                };
              }
            | undefined;
          const activeExecutiveLeadCount = detailData?.workload?.activeExecutiveLeadCount ?? 0;
          const activeManagerLeadCount = detailData?.workload?.activeManagerLeadCount ?? 0;
          const totalActiveLeadAssignments = activeExecutiveLeadCount + activeManagerLeadCount;

          if (totalActiveLeadAssignments > 0) {
            const openLeads = window.confirm(
              `${user.fullName} has ${totalActiveLeadAssignments} active assigned lead(s). Reassign them before deactivation. Click OK to open Leads now.`
            );
            if (openLeads) {
              router.push("/leads");
            }
            setActionMessage({
              type: "error",
              text: `Reassign ${totalActiveLeadAssignments} active lead(s) before deactivation.`
            });
            return;
          }
        } catch {
          // Continue and rely on backend enforcement if workload pre-check fails.
        }
      }

      const reason = window.prompt(
        `${action === "suspend" ? "Suspension" : "Deactivation"} reason (min 5 characters):`,
        ""
      );
      if (reason === null) return;
      if (reason.trim().length < 5) {
        setActionMessage({
          type: "error",
          text: "Reason must be at least 5 characters."
        });
        return;
      }
      payload = { reason: reason.trim() };
    }

    setActionLoading(actionKey);
    try {
      await api.post(`/api/users/${user.id}/${action}`, payload);
      setActionMessage({
        type: "success",
        text:
          action === "approve"
            ? `${user.fullName} approved`
            : action === "suspend"
              ? `${user.fullName} suspended`
              : `${user.fullName} deactivated`
      });
      await mutate();
    } catch (error) {
      const apiError = extractApiError(error);
      if (apiError.code === "ACTIVE_LEAD_ASSIGNMENTS_EXIST") {
        const totalActiveLeadAssignments = apiError.details?.totalActiveLeadAssignments ?? 0;
        const openLeads = window.confirm(
          `${user.fullName} still has ${totalActiveLeadAssignments} active assigned lead(s). Reassign first. Click OK to open Leads.`
        );
        if (openLeads) {
          router.push("/leads");
        }
      }
      setActionMessage({
        type: "error",
        text: apiError.message
      });
    } finally {
      setActionLoading(null);
    }
  };

  const renderDistricts = (row: UserRow) => {
    if (!row.districtAssignments.length) return "-";
    const label = row.districtAssignments
      .slice(0, 2)
      .map((assignment) => `${assignment.district.name} (${assignment.district.state})`)
      .join(", ");
    const remaining = row.districtAssignments.length - 2;
    return remaining > 0 ? `${label} +${remaining} more` : label;
  };

  const statusClass = (value: Status) => {
    if (value === "ACTIVE") return "bg-emerald-100 text-emerald-800";
    if (value === "PENDING") return "bg-amber-100 text-amber-800";
    if (value === "DEACTIVATED") return "bg-slate-200 text-slate-800";
    return "bg-rose-100 text-rose-800";
  };

  return (
    <div className="min-w-0 space-y-4">
      <section className="rounded-xl bg-white p-3 shadow-sm sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold">Users</h2>
          <Link
            href="/users/create"
            className="rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            Create User
          </Link>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Search name / email / phone / employee ID"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <select
            value={role}
            onChange={(event) => {
              setRole(event.target.value);
              setPage(1);
            }}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">All roles</option>
            {ROLE_OPTIONS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
          <select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
          <select
            value={districtId}
            onChange={(event) => {
              setDistrictId(event.target.value);
              setPage(1);
            }}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">All districts</option>
            {districts.map((district) => (
              <option key={district.id} value={district.id}>
                {district.name} ({district.state})
              </option>
            ))}
          </select>
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
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Districts</th>
                <th className="px-4 py-3">Last Login</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td className="px-4 py-4 text-slate-500" colSpan={6}>
                    Loading users...
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td className="px-4 py-4 text-slate-500" colSpan={6}>
                    No users found.
                  </td>
                </tr>
              ) : (
                users.map((user) => (
                  <tr key={user.id} className="border-t border-slate-100 align-top">
                    <td className="px-4 py-3">
                      <Link href={`/users/${user.id}`} className="font-medium text-brand-700 hover:underline">
                        {user.fullName}
                      </Link>
                      <p className="text-xs text-slate-600">{user.email}</p>
                      <p className="text-xs text-slate-500">{user.phone ?? "-"}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p>{user.roleLabel}</p>
                      <p className="text-xs text-slate-500">{user.employeeId ?? "-"}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-1 text-xs font-medium ${statusClass(user.status)}`}>
                        {user.statusLabel}
                      </span>
                    </td>
                    <td className="px-4 py-3">{renderDistricts(user)}</td>
                    <td className="px-4 py-3">
                      {user.lastLoginAt
                        ? new Date(user.lastLoginAt).toLocaleString()
                        : "Never"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        <Link
                          href={`/users/${user.id}`}
                          className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50"
                        >
                          Edit
                        </Link>
                        {user.status !== "ACTIVE" ? (
                          <button
                            onClick={() => void runStatusAction(user, "approve")}
                            disabled={actionLoading === `${user.id}:approve`}
                            className="rounded border border-emerald-300 px-2 py-1 text-xs text-emerald-700 disabled:opacity-50"
                          >
                            {actionLoading === `${user.id}:approve` ? "Approving..." : "Approve"}
                          </button>
                        ) : null}
                        <button
                          onClick={() => void runStatusAction(user, "suspend")}
                          disabled={actionLoading === `${user.id}:suspend`}
                          className="rounded border border-amber-300 px-2 py-1 text-xs text-amber-700 disabled:opacity-50"
                        >
                          {actionLoading === `${user.id}:suspend` ? "Suspending..." : "Suspend"}
                        </button>
                        <button
                          onClick={() => void runStatusAction(user, "deactivate")}
                          disabled={actionLoading === `${user.id}:deactivate`}
                          className="rounded border border-rose-300 px-2 py-1 text-xs text-rose-700 disabled:opacity-50"
                        >
                          {actionLoading === `${user.id}:deactivate` ? "Updating..." : "Deactivate"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
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
                setPageSize(Number(event.target.value));
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
                setPage((current) => Math.min(pagination?.totalPages ?? 1, current + 1))
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
