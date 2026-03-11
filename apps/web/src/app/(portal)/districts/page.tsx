"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import axios from "axios";
import { api, getApiErrorMessage } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";

type DistrictRow = {
  id: string;
  name: string;
  state: string;
  isActive: boolean;
  _count?: {
    leads: number;
    assignments: number;
  };
};

type UserOption = {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
};

type MappingUser = UserOption & {
  assignmentId: string;
  assignedAt: string;
};

type DistrictMappingRow = {
  id: string;
  name: string;
  state: string;
  isActive: boolean;
  managers: MappingUser[];
  executives: MappingUser[];
};

type DraftSelection = {
  managerIds: string[];
  executiveIds: string[];
};

const fetcher = <T,>(url: string) => api.get(url).then((r) => r.data?.data as T);

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export default function DistrictsPage() {
  const authUser = useAuthStore((state) => state.user);
  const canManageDistrict = authUser?.role === "SUPER_ADMIN";
  const canCreateDistrict = canManageDistrict;
  const [drafts, setDrafts] = useState<Record<string, DraftSelection>>({});
  const [saveState, setSaveState] = useState<Record<string, "idle" | "saving" | "saved" | "error">>({});
  const [message, setMessage] = useState<string | null>(null);
  const [newDistrictName, setNewDistrictName] = useState("");
  const [newDistrictState, setNewDistrictState] = useState("");
  const [newDistrictActive, setNewDistrictActive] = useState(true);
  const [createLoading, setCreateLoading] = useState(false);

  const {
    data: districtsData,
    isLoading,
    error,
    mutate: mutateDistricts
  } = useSWR<DistrictRow[]>("/api/districts", fetcher);
  const { data: mappingsData, mutate: mutateMappings } = useSWR<DistrictMappingRow[]>(
    "/api/districts/mappings",
    fetcher
  );
  const { data: managersData } = useSWR<UserOption[]>("/api/districts/users/managers", fetcher);
  const { data: executivesData } = useSWR<UserOption[]>("/api/districts/users/executives", fetcher);

  useEffect(() => {
    const mappingRows = asArray<DistrictMappingRow>(mappingsData);
    if (mappingRows.length === 0) return;
    const next: Record<string, DraftSelection> = {};
    for (const row of mappingRows) {
      next[row.id] = {
        managerIds: asArray<MappingUser>(row.managers).map((m) => m.id),
        executiveIds: asArray<MappingUser>(row.executives).map((e) => e.id)
      };
    }
    setDrafts(next);
  }, [mappingsData]);

  const rows = useMemo(() => asArray<DistrictRow>(districtsData), [districtsData]);
  const managers = useMemo(() => asArray<UserOption>(managersData), [managersData]);
  const executives = useMemo(() => asArray<UserOption>(executivesData), [executivesData]);
  const districtErrorStatus = axios.isAxiosError(error) ? error.response?.status : undefined;
  const isRoleUnavailable = districtErrorStatus === 403;
  const districtErrorMessage =
    error && !isRoleUnavailable
      ? getApiErrorMessage(error, "Failed to load districts. Please retry.")
      : null;

  const updateSelection = (districtId: string, key: "managerIds" | "executiveIds", values: string[]) => {
    setDrafts((prev) => ({
      ...prev,
      [districtId]: {
        managerIds: prev[districtId]?.managerIds ?? [],
        executiveIds: prev[districtId]?.executiveIds ?? [],
        [key]: values
      }
    }));
    setSaveState((prev) => ({ ...prev, [districtId]: "idle" }));
  };

  const onSave = async (districtId: string) => {
    const selection = drafts[districtId] ?? { managerIds: [], executiveIds: [] };
    setSaveState((prev) => ({ ...prev, [districtId]: "saving" }));
    setMessage(null);
    try {
      await api.put(`/api/districts/${districtId}/mappings`, selection);
      setSaveState((prev) => ({ ...prev, [districtId]: "saved" }));
      setMessage("District assignments updated.");
      await mutateMappings();
    } catch (saveError) {
      const maybe = saveError as { response?: { data?: { message?: string } } };
      setSaveState((prev) => ({ ...prev, [districtId]: "error" }));
      setMessage(maybe.response?.data?.message ?? "Failed to update assignments.");
    }
  };

  const onCreateDistrict = async () => {
    const name = newDistrictName.trim();
    const state = newDistrictState.trim();
    if (!name || !state) {
      setMessage("District name and state are required.");
      return;
    }

    setCreateLoading(true);
    setMessage(null);
    try {
      await api.post("/api/districts", {
        name,
        state,
        isActive: newDistrictActive
      });
      setNewDistrictName("");
      setNewDistrictState("");
      setNewDistrictActive(true);
      setMessage("District created.");
      await mutateDistricts();
      await mutateMappings();
    } catch (createError) {
      const maybe = createError as { response?: { data?: { message?: string } } };
      setMessage(maybe.response?.data?.message ?? "Failed to create district.");
    } finally {
      setCreateLoading(false);
    }
  };

  const onEditDistrict = async (district: DistrictRow) => {
    if (!canManageDistrict) return;

    const nextName = window.prompt("District name", district.name);
    if (nextName === null) return;
    const trimmedName = nextName.trim();
    if (!trimmedName) {
      setMessage("District name is required.");
      return;
    }

    const nextState = window.prompt("State", district.state);
    if (nextState === null) return;
    const trimmedState = nextState.trim();
    if (!trimmedState) {
      setMessage("State is required.");
      return;
    }

    const nextActive = window.confirm(
      "Click OK for Active district, Cancel for Inactive district."
    );

    setMessage(null);
    try {
      await api.patch(`/api/districts/${district.id}`, {
        name: trimmedName,
        state: trimmedState,
        isActive: nextActive
      });
      setMessage("District updated.");
      await mutateDistricts();
      await mutateMappings();
    } catch (editError) {
      const maybe = editError as { response?: { data?: { message?: string } } };
      setMessage(maybe.response?.data?.message ?? "Failed to update district.");
    }
  };

  const onDeleteDistrict = async (district: DistrictRow) => {
    if (!canManageDistrict) return;
    const confirmed = window.confirm(
      `Delete district "${district.name}, ${district.state}"? This cannot be undone.`
    );
    if (!confirmed) return;

    setMessage(null);
    try {
      await api.delete(`/api/districts/${district.id}`);
      setMessage("District deleted.");
      await mutateDistricts();
      await mutateMappings();
    } catch (deleteError) {
      const maybe = deleteError as { response?: { data?: { message?: string } } };
      setMessage(maybe.response?.data?.message ?? "Failed to delete district.");
    }
  };

  if (isRoleUnavailable) {
    return (
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
        District data/mappings are unavailable for your role.
      </div>
    );
  }

  return (
    <section className="space-y-3 rounded-xl bg-white p-4 shadow-sm">
      {districtErrorMessage ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {districtErrorMessage}
        </div>
      ) : null}
      {message ? (
        <div className="rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700">
          {message}
        </div>
      ) : null}
      <div className="rounded-lg border border-slate-200 p-3">
        <h3 className="text-sm font-semibold text-slate-800">Create District</h3>
        {canCreateDistrict ? (
          <div className="mt-2 grid gap-2 md:grid-cols-4">
            <input
              value={newDistrictName}
              onChange={(event) => setNewDistrictName(event.target.value)}
              placeholder="District name"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
            <input
              value={newDistrictState}
              onChange={(event) => setNewDistrictState(event.target.value)}
              placeholder="State"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
            <label className="inline-flex items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={newDistrictActive}
                onChange={(event) => setNewDistrictActive(event.target.checked)}
              />
              Active
            </label>
            <button
              type="button"
              onClick={() => void onCreateDistrict()}
              disabled={createLoading}
              className="rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {createLoading ? "Creating..." : "Create District"}
            </button>
          </div>
        ) : (
          <p className="mt-1 text-xs text-slate-500">
            Only Super Admin can create districts.
          </p>
        )}
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-100 text-left text-xs uppercase text-slate-600">
            <tr>
              <th className="px-4 py-3">District</th>
              <th className="px-4 py-3">State</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Leads</th>
              <th className="px-4 py-3">Assignments</th>
              <th className="px-4 py-3">Managers</th>
              <th className="px-4 py-3">Executives</th>
              <th className="px-4 py-3">Action</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td className="px-4 py-4 text-slate-500" colSpan={8}>
                  Loading districts...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td className="px-4 py-4 text-slate-500" colSpan={8}>
                  No districts found.
                </td>
              </tr>
            ) : (
              rows.map((district) => {
                const draft = drafts[district.id] ?? { managerIds: [], executiveIds: [] };
                const status = saveState[district.id] ?? "idle";
                const assignedCount = (draft.managerIds?.length ?? 0) + (draft.executiveIds?.length ?? 0);
                return (
                <tr key={district.id} className="border-t border-slate-100">
                  <td className="px-4 py-3 font-medium">{district.name}</td>
                  <td className="px-4 py-3">{district.state}</td>
                  <td className="px-4 py-3">
                    {district.isActive ? "Active" : "Inactive"}
                  </td>
                  <td className="px-4 py-3">{district._count?.leads ?? 0}</td>
                  <td className="px-4 py-3">{assignedCount}</td>
                  <td className="px-4 py-3">
                    <select
                      multiple
                      className="min-h-24 w-56 rounded-md border border-slate-300 px-2 py-1 text-xs"
                      value={draft.managerIds}
                      onChange={(event) => {
                        const selected = Array.from(event.target.selectedOptions).map((option) => option.value);
                        updateSelection(district.id, "managerIds", selected);
                      }}
                    >
                      {managers.map((manager) => (
                        <option key={manager.id} value={manager.id}>
                          {manager.fullName}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <select
                      multiple
                      className="min-h-24 w-56 rounded-md border border-slate-300 px-2 py-1 text-xs"
                      value={draft.executiveIds}
                      onChange={(event) => {
                        const selected = Array.from(event.target.selectedOptions).map((option) => option.value);
                        updateSelection(district.id, "executiveIds", selected);
                      }}
                    >
                      {executives.map((executive) => (
                        <option key={executive.id} value={executive.id}>
                          {executive.fullName}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      <button
                        type="button"
                        onClick={() => void onSave(district.id)}
                        disabled={status === "saving"}
                        className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                      >
                        {status === "saving" ? "Saving..." : "Save Mapping"}
                      </button>
                      {canManageDistrict ? (
                        <button
                          type="button"
                          onClick={() => void onEditDistrict(district)}
                          className="rounded-md border border-blue-300 px-3 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50"
                        >
                          Edit
                        </button>
                      ) : null}
                      {canManageDistrict ? (
                        <button
                          type="button"
                          onClick={() => void onDeleteDistrict(district)}
                          className="rounded-md border border-rose-300 px-3 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50"
                        >
                          Delete
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })
            )}
          </tbody>
        </table>
      </div>
      {managers.length === 0 || executives.length === 0 ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {managers.length === 0 ? "No active District Managers found. " : ""}
          {executives.length === 0 ? "No active Field Executives found. " : ""}
          Approve users and set status to Active before mapping.
        </div>
      ) : null}
      <p className="text-xs text-slate-500">Tip: Hold Ctrl/Cmd to select multiple managers/executives.</p>
    </section>
  );
}
