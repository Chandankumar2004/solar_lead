"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import useSWR from "swr";
import { z } from "zod";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";

type Role = "SUPER_ADMIN" | "ADMIN" | "MANAGER" | "EXECUTIVE";
type Status = "ACTIVE" | "PENDING" | "SUSPENDED" | "DEACTIVATED";

type District = {
  id: string;
  name: string;
  state: string;
  isActive?: boolean;
  _count?: {
    leads: number;
    assignments: number;
  };
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

type UserDetailEnvelope = {
  data?: {
    user?: UserRow;
    workload?: {
      activeExecutiveLeadCount: number;
      activeManagerLeadCount: number;
    };
    executiveProfile?: {
      summary: {
        totalAssignedLeads: number;
        activeAssignedLeads: number;
        completedAssignedLeads: number;
        completionRate: number;
      };
      tokenCollections: {
        totalCollections: number;
        verifiedCollections: number;
        verifiedAmount: number;
      };
      documentSubmissions: {
        totalUploads: number;
        pendingReview: number;
        verified: number;
        rejected: number;
      };
      assignedLeads: Array<{
        id: string;
        externalId: string;
        name: string;
        phone: string;
        district: {
          id: string;
          name: string;
          state: string;
        };
        status: {
          id: string;
          name: string;
          isTerminal: boolean;
        };
        isActive: boolean;
        createdAt: string;
        updatedAt: string;
      }>;
    } | null;
  };
};

const updateUserSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().email(),
  phone: z.union([z.string().trim().min(8).max(20), z.literal("")]).optional(),
  employeeId: z.union([z.string().trim().min(2).max(50), z.literal("")]).optional(),
  role: z.enum(["SUPER_ADMIN", "ADMIN", "MANAGER", "EXECUTIVE"]),
  districtIds: z.array(z.string()).default([])
});

type UpdateUserFormValues = z.infer<typeof updateUserSchema>;

const fetcher = (url: string) => api.get(url).then((response) => response.data);

const ROLE_OPTIONS: Array<{ value: Role; label: string }> = [
  { value: "SUPER_ADMIN", label: "Super Admin" },
  { value: "ADMIN", label: "Admin" },
  { value: "MANAGER", label: "District Manager" },
  { value: "EXECUTIVE", label: "Field Executive" }
];

function isDistrictRole(role: Role) {
  return role === "MANAGER" || role === "EXECUTIVE";
}

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

const ROLE_PRIORITY: Record<Role, number> = {
  SUPER_ADMIN: 4,
  ADMIN: 3,
  MANAGER: 2,
  EXECUTIVE: 1
};

function isRoleDowngrade(currentRole: Role, nextRole: Role) {
  return ROLE_PRIORITY[nextRole] < ROLE_PRIORITY[currentRole];
}

export default function UserDetailPage() {
  const params = useParams<{ id: string }>();
  const userId = params.id;
  const router = useRouter();
  const authUser = useAuthStore((state) => state.user);

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitWarnings, setSubmitWarnings] = useState<string[]>([]);
  const [actionMessage, setActionMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const { data, isLoading, mutate } = useSWR(`/api/users/${userId}`, fetcher);
  const { data: districtsData } = useSWR("/api/districts", fetcher);

  const userEnvelope = data as UserDetailEnvelope | undefined;
  const user = userEnvelope?.data?.user ?? null;
  const workload = userEnvelope?.data?.workload ?? null;
  const executiveProfile = userEnvelope?.data?.executiveProfile ?? null;

  const districts = useMemo(
    () =>
      ((districtsData as { data?: District[] } | undefined)?.data ?? ([] as District[])).sort((a, b) =>
        a.name.localeCompare(b.name)
      ),
    [districtsData]
  );

  const {
    register,
    control,
    watch,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting, isDirty }
  } = useForm<UpdateUserFormValues>({
    resolver: zodResolver(updateUserSchema),
    defaultValues: {
      fullName: "",
      email: "",
      phone: "",
      employeeId: "",
      role: "EXECUTIVE",
      districtIds: []
    }
  });

  useEffect(() => {
    if (!user) return;
    reset({
      fullName: user.fullName,
      email: user.email,
      phone: user.phone ?? "",
      employeeId: user.employeeId ?? "",
      role: user.role,
      districtIds: user.districtAssignments.map((assignment) => assignment.district.id)
    });
  }, [reset, user]);

  const selectedRole = watch("role");
  const canAssignDistricts = isDistrictRole(selectedRole);
  const availableRoleOptions =
    authUser?.role === "ADMIN"
      ? ROLE_OPTIONS.filter((item) => item.value === "MANAGER" || item.value === "EXECUTIVE")
      : ROLE_OPTIONS;

  const runStatusAction = async (action: "approve" | "suspend" | "deactivate") => {
    if (!user) return;
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
        const totalActiveLeadAssignments =
          (workload?.activeExecutiveLeadCount ?? 0) + (workload?.activeManagerLeadCount ?? 0);
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
            ? "User approved"
            : action === "suspend"
              ? "User suspended"
              : "User deactivated"
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

  const onSubmit = handleSubmit(async (values) => {
    if (!user) return;
    setSubmitError(null);
    setSubmitWarnings([]);

    const roleDowngrade = isRoleDowngrade(user.role, values.role);
    let confirmRoleDowngrade = false;
    if (roleDowngrade) {
      const confirmed = window.confirm(
        `Role downgrade detected (${user.role} -> ${values.role}). Do you want to continue?`
      );
      if (!confirmed) {
        setSubmitError("Role downgrade cancelled.");
        return;
      }
      confirmRoleDowngrade = true;
    }

    try {
      const response = await api.patch(`/api/users/${user.id}`, {
        fullName: values.fullName,
        email: values.email,
        phone: values.phone?.trim() ? values.phone.trim() : null,
        employeeId: values.employeeId?.trim() ? values.employeeId.trim() : null,
        role: values.role,
        districtIds: canAssignDistricts ? values.districtIds : [],
        confirmRoleDowngrade
      });
      setSubmitWarnings((response.data?.data?.warnings ?? []) as string[]);
      setActionMessage({
        type: "success",
        text: "User updated"
      });
      await mutate();
    } catch (error) {
      setSubmitError(extractApiError(error).message);
    }
  });

  if (isLoading) {
    return (
      <div className="rounded-xl bg-white p-4 shadow-sm">
        <p className="text-sm text-slate-600">Loading user...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="space-y-3 rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-700">
        <p>User not found or inaccessible.</p>
        <button
          onClick={() => router.push("/users")}
          className="rounded border border-rose-300 px-3 py-1 text-xs"
        >
          Back to users
        </button>
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{user.fullName}</h2>
          <p className="text-sm text-slate-600">
            {user.roleLabel} | {user.statusLabel}
          </p>
        </div>
        <Link href="/users" className="text-sm text-brand-700 hover:underline">
          Back to Users
        </Link>
      </div>

      <section className="rounded-xl bg-white p-3 shadow-sm sm:p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-md border border-slate-200 p-3 text-sm">
            <p className="text-slate-500">Created</p>
            <p>{new Date(user.createdAt).toLocaleString()}</p>
          </div>
          <div className="rounded-md border border-slate-200 p-3 text-sm">
            <p className="text-slate-500">Last Login</p>
            <p>{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : "Never"}</p>
          </div>
          <div className="rounded-md border border-slate-200 p-3 text-sm">
            <p className="text-slate-500">Active Exec Leads</p>
            <p>{workload?.activeExecutiveLeadCount ?? 0}</p>
          </div>
          <div className="rounded-md border border-slate-200 p-3 text-sm">
            <p className="text-slate-500">Active Manager Leads</p>
            <p>{workload?.activeManagerLeadCount ?? 0}</p>
          </div>
        </div>
      </section>

      {user.role === "EXECUTIVE" && executiveProfile ? (
        <section className="space-y-3 rounded-xl bg-white p-3 shadow-sm sm:p-4">
          <h3 className="text-base font-semibold">Field Executive Profile</h3>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <div className="rounded-md border border-slate-200 p-3 text-sm">
              <p className="text-slate-500">Assigned Leads</p>
              <p>{executiveProfile.summary.totalAssignedLeads}</p>
            </div>
            <div className="rounded-md border border-slate-200 p-3 text-sm">
              <p className="text-slate-500">Active Leads</p>
              <p>{executiveProfile.summary.activeAssignedLeads}</p>
            </div>
            <div className="rounded-md border border-slate-200 p-3 text-sm">
              <p className="text-slate-500">Completion Rate</p>
              <p>{executiveProfile.summary.completionRate}%</p>
            </div>
            <div className="rounded-md border border-slate-200 p-3 text-sm">
              <p className="text-slate-500">Completed Leads</p>
              <p>{executiveProfile.summary.completedAssignedLeads}</p>
            </div>
            <div className="rounded-md border border-slate-200 p-3 text-sm">
              <p className="text-slate-500">Token Collections (Verified/Total)</p>
              <p>
                {executiveProfile.tokenCollections.verifiedCollections}/
                {executiveProfile.tokenCollections.totalCollections}
              </p>
              <p className="text-xs text-slate-500">
                Verified Amount: {executiveProfile.tokenCollections.verifiedAmount}
              </p>
            </div>
            <div className="rounded-md border border-slate-200 p-3 text-sm">
              <p className="text-slate-500">Document Submissions</p>
              <p>Total: {executiveProfile.documentSubmissions.totalUploads}</p>
              <p className="text-xs text-slate-500">
                Pending: {executiveProfile.documentSubmissions.pendingReview} | Verified:{" "}
                {executiveProfile.documentSubmissions.verified} | Rejected:{" "}
                {executiveProfile.documentSubmissions.rejected}
              </p>
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-100 text-left text-xs uppercase text-slate-600">
                <tr>
                  <th className="px-3 py-2">Lead</th>
                  <th className="px-3 py-2">District</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Updated</th>
                </tr>
              </thead>
              <tbody>
                {executiveProfile.assignedLeads.length === 0 ? (
                  <tr>
                    <td className="px-3 py-3 text-slate-500" colSpan={4}>
                      No assigned leads yet.
                    </td>
                  </tr>
                ) : (
                  executiveProfile.assignedLeads.map((lead) => (
                    <tr key={lead.id} className="border-t border-slate-100">
                      <td className="px-3 py-2">
                        <p className="font-medium">{lead.name}</p>
                        <p className="text-xs text-slate-500">{lead.phone}</p>
                        <p className="text-xs text-slate-500">{lead.externalId}</p>
                      </td>
                      <td className="px-3 py-2">
                        {lead.district.name} ({lead.district.state})
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`rounded-full px-2 py-1 text-xs font-medium ${
                            lead.isActive
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-slate-200 text-slate-800"
                          }`}
                        >
                          {lead.status.name}
                        </span>
                      </td>
                      <td className="px-3 py-2">{new Date(lead.updatedAt).toLocaleString()}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

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

      <form onSubmit={onSubmit} className="rounded-xl bg-white p-3 shadow-sm sm:p-4">
        <h3 className="text-base font-semibold">Edit User</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium">Full Name</label>
            <input
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              {...register("fullName")}
            />
            {errors.fullName && (
              <p className="mt-1 text-xs text-rose-600">{errors.fullName.message}</p>
            )}
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Email</label>
            <input
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              {...register("email")}
            />
            {errors.email && <p className="mt-1 text-xs text-rose-600">{errors.email.message}</p>}
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Phone</label>
            <input
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              {...register("phone")}
            />
            {errors.phone && <p className="mt-1 text-xs text-rose-600">{errors.phone.message}</p>}
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Employee ID</label>
            <input
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              {...register("employeeId")}
            />
            {errors.employeeId && (
              <p className="mt-1 text-xs text-rose-600">{errors.employeeId.message}</p>
            )}
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Role</label>
            <select
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              {...register("role")}
            >
              {availableRoleOptions.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
            {errors.role && <p className="mt-1 text-xs text-rose-600">{errors.role.message}</p>}
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Status</label>
            <input
              disabled
              value={user.statusLabel}
              className="w-full rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm"
              readOnly
            />
          </div>
          <div className="md:col-span-2">
            <label className="mb-1 block text-sm font-medium">
              District Assignments {canAssignDistricts ? "" : "(Disabled for selected role)"}
            </label>
            <Controller
              name="districtIds"
              control={control}
              render={({ field }) => {
                const selectedIds = Array.isArray(field.value) ? field.value : [];
                return (
                  <div className="max-h-56 overflow-y-auto rounded-md border border-slate-300 p-2 disabled:bg-slate-100">
                    {districts.length === 0 ? (
                      <p className="px-1 py-1 text-xs text-slate-500">
                        No districts found. Create districts in Districts module first.
                      </p>
                    ) : (
                      districts.map((district) => {
                        const checked = selectedIds.includes(district.id);
                        return (
                          <label
                            key={district.id}
                            className={`mb-1 flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm ${
                              checked ? "bg-emerald-50" : "hover:bg-slate-50"
                            } ${!canAssignDistricts ? "cursor-not-allowed opacity-60" : ""}`}
                          >
                            <input
                              type="checkbox"
                              className="h-4 w-4"
                              checked={checked}
                              disabled={!canAssignDistricts}
                              onChange={() => {
                                const next = checked
                                  ? selectedIds.filter((id) => id !== district.id)
                                  : [...selectedIds, district.id];
                                field.onChange(next);
                              }}
                            />
                            <span>
                              {district.name} ({district.state})
                              {district.isActive === false ? " [Inactive]" : ""}
                            </span>
                          </label>
                        );
                      })
                    )}
                  </div>
                );
              }}
            />
            <p className="mt-1 text-xs text-slate-500">
              Click checkboxes to assign multiple districts.
            </p>
          </div>
        </div>

        {submitError ? (
          <div className="mt-3 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {submitError}
          </div>
        ) : null}

        {submitWarnings.length > 0 ? (
          <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            <p className="font-medium">Warnings</p>
            <ul className="mt-1 list-disc pl-5">
              {submitWarnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="submit"
            disabled={isSubmitting || !isDirty}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {isSubmitting ? "Saving..." : "Save Changes"}
          </button>
          {user.status !== "ACTIVE" ? (
            <button
              type="button"
              onClick={() => void runStatusAction("approve")}
              disabled={actionLoading === `${user.id}:approve`}
              className="rounded-md border border-emerald-300 px-4 py-2 text-sm text-emerald-700 disabled:opacity-50"
            >
              {actionLoading === `${user.id}:approve` ? "Approving..." : "Approve"}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void runStatusAction("suspend")}
            disabled={actionLoading === `${user.id}:suspend`}
            className="rounded-md border border-amber-300 px-4 py-2 text-sm text-amber-700 disabled:opacity-50"
          >
            {actionLoading === `${user.id}:suspend` ? "Suspending..." : "Suspend"}
          </button>
          <button
            type="button"
            onClick={() => void runStatusAction("deactivate")}
            disabled={actionLoading === `${user.id}:deactivate`}
            className="rounded-md border border-rose-300 px-4 py-2 text-sm text-rose-700 disabled:opacity-50"
          >
            {actionLoading === `${user.id}:deactivate` ? "Updating..." : "Deactivate"}
          </button>
        </div>
      </form>
    </div>
  );
}
