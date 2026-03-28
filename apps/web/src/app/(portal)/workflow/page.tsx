"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import useSWR from "swr";
import { z } from "zod";
import { api, getApiErrorMessage } from "@/lib/api";

type LeadStatus = {
  id: string;
  name: string;
  description?: string | null;
  orderIndex: number;
  isTerminal: boolean;
  slaDurationHours?: number | null;
  colorCode?: string | null;
  requiresNote: boolean;
  requiresDocument: boolean;
  notifyCustomer: boolean;
  notificationTemplateId?: string | null;
};

type Transition = {
  id: string;
  fromStatusId: string;
  toStatusId: string;
  fromStatus?: { id: string; name: string } | null;
  toStatus?: { id: string; name: string } | null;
};

type NotificationTemplate = {
  id: string;
  name: string;
  channel: "SMS" | "EMAIL" | "WHATSAPP" | "PUSH";
  isActive?: boolean;
};

type AutoAssignmentConfig = {
  maxActiveLeadsPerExecutive: number;
};

const fetcher = (url: string) => api.get(url).then((r) => r.data?.data);

function toArray<T>(value: unknown, keys: string[] = []): T[] {
  if (Array.isArray(value)) {
    return value as T[];
  }

  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    for (const key of keys) {
      const candidate = source[key];
      if (Array.isArray(candidate)) {
        return candidate as T[];
      }
    }
  }

  return [];
}

const statusFormSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    description: z.string().trim().max(300).optional(),
    colorCode: z
      .string()
      .trim()
      .regex(/^#[A-Fa-f0-9]{6}$/)
      .or(z.literal("")),
    isTerminal: z.boolean().default(false),
    requiresNote: z.boolean().default(false),
    requiresDocument: z.boolean().default(false),
    notifyCustomer: z.boolean().default(false),
    notificationTemplateId: z.string().uuid().or(z.literal("")).default(""),
    slaDurationHours: z.preprocess(
      (value) => {
        if (value === undefined || value === null || value === "") return undefined;
        if (typeof value === "number") return value;
        if (typeof value === "string") {
          const parsed = Number(value);
          return Number.isNaN(parsed) ? value : parsed;
        }
        return value;
      },
      z.number().int().min(1).max(24 * 365).optional()
    )
  })
  .superRefine((value, ctx) => {
    if (value.notifyCustomer && !value.notificationTemplateId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["notificationTemplateId"],
        message: "Template is required when customer notification is enabled"
      });
    }
  });

type StatusFormValues = z.infer<typeof statusFormSchema>;

const DEFAULT_FORM_VALUES: StatusFormValues = {
  name: "",
  description: "",
  colorCode: "#2563EB",
  isTerminal: false,
  requiresNote: false,
  requiresDocument: false,
  notifyCustomer: false,
  notificationTemplateId: "",
  slaDurationHours: undefined
};

function toFormValues(status: LeadStatus): StatusFormValues {
  return {
    name: status.name,
    description: status.description ?? "",
    colorCode: status.colorCode ?? "#2563EB",
    isTerminal: status.isTerminal,
    requiresNote: status.requiresNote,
    requiresDocument: status.requiresDocument,
    notifyCustomer: status.notifyCustomer,
    notificationTemplateId: status.notificationTemplateId ?? "",
    slaDurationHours: status.slaDurationHours ?? undefined
  };
}

export default function WorkflowPage() {
  const {
    data: statuses = [],
    mutate: mutateStatuses,
    isLoading: loadingStatuses
  } = useSWR("/api/lead-statuses?includeTransitions=true", fetcher);
  const { data: transitions = [], mutate: mutateTransitions } = useSWR(
    "/api/lead-statuses/transitions",
    fetcher
  );
  const { data: templates = [] } = useSWR(
    "/api/notifications/templates?isActive=true",
    fetcher
  );
  const {
    data: autoAssignmentConfigData,
    mutate: mutateAutoAssignmentConfig
  } = useSWR("/api/leads/auto-assignment/config", fetcher);

  const statusItems = useMemo(
    () =>
      toArray<LeadStatus>(statuses, ["statuses", "items", "data"]).sort((a, b) =>
        a.orderIndex - b.orderIndex
      ),
    [statuses]
  );
  const transitionItems = useMemo(
    () => toArray<Transition>(transitions, ["transitions", "items", "data"]),
    [transitions]
  );
  const notificationTemplates = useMemo(
    () =>
      toArray<NotificationTemplate>(templates, ["templates", "items", "data"]).filter(
        (template) => template.channel !== "PUSH"
      ),
    [templates]
  );
  const autoAssignmentConfig = useMemo(() => {
    const source = autoAssignmentConfigData as
      | AutoAssignmentConfig
      | { config?: AutoAssignmentConfig }
      | null
      | undefined;
    if (!source) {
      return null;
    }
    if (typeof source === "object" && "maxActiveLeadsPerExecutive" in source) {
      return source as AutoAssignmentConfig;
    }
    if (typeof source === "object" && source.config) {
      return source.config;
    }
    return null;
  }, [autoAssignmentConfigData]);

  const [editingStatusId, setEditingStatusId] = useState<string | null>(null);
  const [selectedStatusId, setSelectedStatusId] = useState<string | null>(null);
  const [selectedFromStatusId, setSelectedFromStatusId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [transitionError, setTransitionError] = useState<string | null>(null);
  const [transitionBusyKey, setTransitionBusyKey] = useState<string | null>(null);
  const [reorderBusyId, setReorderBusyId] = useState<string | null>(null);
  const [maxActiveLoadInput, setMaxActiveLoadInput] = useState<string>("50");
  const [savingAutoAssignmentConfig, setSavingAutoAssignmentConfig] = useState(false);
  const [autoAssignmentConfigError, setAutoAssignmentConfigError] = useState<string | null>(null);
  const [autoAssignmentConfigSuccess, setAutoAssignmentConfigSuccess] = useState<string | null>(null);

  const {
    register,
    reset,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting }
  } = useForm<StatusFormValues>({
    resolver: zodResolver(statusFormSchema),
    defaultValues: DEFAULT_FORM_VALUES
  });

  const notifyCustomerEnabled = watch("notifyCustomer");
  const selectedStatus =
    statusItems.find((status) => status.id === selectedStatusId) ?? statusItems[0] ?? null;
  const selectedFromStatus =
    statusItems.find((status) => status.id === selectedFromStatusId) ?? statusItems[0] ?? null;

  const allowedToStatusIds = useMemo(() => {
    if (!selectedFromStatus) return new Set<string>();
    return new Set(
      transitionItems
        .filter((transition) => transition.fromStatusId === selectedFromStatus.id)
        .map((transition) => transition.toStatusId)
    );
  }, [selectedFromStatus, transitionItems]);

  useEffect(() => {
    if (!statusItems.length) {
      setSelectedStatusId(null);
      setSelectedFromStatusId(null);
      return;
    }

    if (!selectedStatusId || !statusItems.some((status) => status.id === selectedStatusId)) {
      setSelectedStatusId(statusItems[0].id);
    }
    if (
      !selectedFromStatusId ||
      !statusItems.some((status) => status.id === selectedFromStatusId)
    ) {
      setSelectedFromStatusId(statusItems[0].id);
    }
  }, [selectedFromStatusId, selectedStatusId, statusItems]);

  useEffect(() => {
    if (!autoAssignmentConfig) return;
    setMaxActiveLoadInput(String(autoAssignmentConfig.maxActiveLeadsPerExecutive));
  }, [autoAssignmentConfig]);

  async function refreshWorkflowData() {
    await Promise.all([mutateStatuses(), mutateTransitions()]);
  }

  function resetToCreateMode() {
    setEditingStatusId(null);
    setFormError(null);
    setFormSuccess(null);
    reset(DEFAULT_FORM_VALUES);
  }

  function beginEdit(status: LeadStatus) {
    setEditingStatusId(status.id);
    setSelectedStatusId(status.id);
    setFormError(null);
    setFormSuccess(null);
    reset(toFormValues(status));
  }

  const submitStatusForm = handleSubmit(async (values) => {
    setFormError(null);
    setFormSuccess(null);

    const description = values.description?.trim() ? values.description.trim() : null;
    const payload = {
      name: values.name.trim(),
      description,
      isTerminal: values.isTerminal,
      slaDurationHours: values.slaDurationHours ?? null,
      colorCode: values.colorCode.trim(),
      requiresNote: values.requiresNote,
      requiresDocument: values.requiresDocument,
      notifyCustomer: values.notifyCustomer,
      notificationTemplateId: values.notifyCustomer
        ? values.notificationTemplateId || null
        : null
    };

    try {
      if (editingStatusId) {
        await api.patch(`/api/lead-statuses/${editingStatusId}`, payload);
        setFormSuccess("Lead status updated");
      } else {
        const response = await api.post("/api/lead-statuses", payload);
        const createdStatus = response.data?.data as LeadStatus | undefined;
        if (createdStatus?.id) {
          setSelectedStatusId(createdStatus.id);
          setSelectedFromStatusId(createdStatus.id);
        }
        setFormSuccess("Lead status created");
      }
      await refreshWorkflowData();
      if (!editingStatusId) {
        reset(DEFAULT_FORM_VALUES);
      }
    } catch (error) {
      setFormError(getApiErrorMessage(error, "Unable to save status"));
    }
  });

  async function moveStatus(status: LeadStatus, direction: -1 | 1) {
    if (reorderBusyId) return;
    const targetOrderIndex = status.orderIndex + direction;
    if (targetOrderIndex < 1 || targetOrderIndex > statusItems.length) return;

    setReorderBusyId(status.id);
    setFormError(null);
    try {
      await api.patch(`/api/lead-statuses/${status.id}`, {
        orderIndex: targetOrderIndex
      });
      await refreshWorkflowData();
    } catch (error) {
      setFormError(getApiErrorMessage(error, "Unable to reorder status"));
    } finally {
      setReorderBusyId(null);
    }
  }

  async function toggleTransition(toStatusId: string) {
    if (!selectedFromStatus || selectedFromStatus.isTerminal) return;
    const key = `${selectedFromStatus.id}:${toStatusId}`;
    if (transitionBusyKey) return;

    const alreadyAllowed = allowedToStatusIds.has(toStatusId);
    setTransitionBusyKey(key);
    setTransitionError(null);
    try {
      await api.post("/api/lead-statuses/transitions", {
        fromStatusId: selectedFromStatus.id,
        toStatusId,
        action: alreadyAllowed ? "delete" : "create"
      });
      await refreshWorkflowData();
    } catch (error) {
      setTransitionError(getApiErrorMessage(error, "Unable to update transition"));
    } finally {
      setTransitionBusyKey(null);
    }
  }

  async function saveAutoAssignmentConfig() {
    setAutoAssignmentConfigError(null);
    setAutoAssignmentConfigSuccess(null);

    const parsed = Number(maxActiveLoadInput);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 500) {
      setAutoAssignmentConfigError("Max active load must be an integer between 1 and 500.");
      return;
    }

    setSavingAutoAssignmentConfig(true);
    try {
      await api.put("/api/leads/auto-assignment/config", {
        maxActiveLeadsPerExecutive: parsed
      });
      await mutateAutoAssignmentConfig();
      setAutoAssignmentConfigSuccess("Auto-assignment load limit updated.");
    } catch (error) {
      setAutoAssignmentConfigError(
        getApiErrorMessage(error, "Unable to update auto-assignment config")
      );
    } finally {
      setSavingAutoAssignmentConfig(false);
    }
  }

  return (
    <div className="min-w-0 space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Lead Status Configuration</h2>
        <p className="text-sm text-slate-600">
          Configure ordered lead lifecycle statuses, transition rules, and status-level
          requirements.
        </p>
      </div>

      <section className="rounded-xl bg-white p-3 shadow-sm sm:p-4">
        <h3 className="text-base font-semibold">Auto-Assignment Capacity</h3>
        <p className="mt-1 text-sm text-slate-600">
          Maximum active (non-terminal) leads allowed per field executive for auto-assignment.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="min-w-[220px] text-sm">
            <span className="mb-1 block font-medium">Max Active Leads per Executive</span>
            <input
              type="number"
              min={1}
              max={500}
              value={maxActiveLoadInput}
              onChange={(event) => setMaxActiveLoadInput(event.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
          <button
            type="button"
            onClick={() => void saveAutoAssignmentConfig()}
            disabled={savingAutoAssignmentConfig}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {savingAutoAssignmentConfig ? "Saving..." : "Save Capacity"}
          </button>
        </div>
        {autoAssignmentConfigError ? (
          <div className="mt-2 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {autoAssignmentConfigError}
          </div>
        ) : null}
        {autoAssignmentConfigSuccess ? (
          <div className="mt-2 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            {autoAssignmentConfigSuccess}
          </div>
        ) : null}
      </section>

      <div className="grid gap-4 xl:grid-cols-[1.1fr_1fr]">
        <section className="rounded-xl bg-white p-3 shadow-sm sm:p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-base font-semibold">Statuses</h3>
            <button
              type="button"
              onClick={resetToCreateMode}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
            >
              Add Status
            </button>
          </div>

          {loadingStatuses ? (
            <p className="text-sm text-slate-500">Loading statuses...</p>
          ) : (
            <div className="space-y-2">
              {statusItems.map((status) => {
                const isSelected = selectedStatus?.id === status.id;
                const isEditing = editingStatusId === status.id;
                return (
                  <div
                    key={status.id}
                    className={`rounded-md border p-3 text-sm ${
                      isSelected
                        ? "border-brand-300 bg-brand-50/40"
                        : "border-slate-200 bg-white"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => setSelectedStatusId(status.id)}
                        className="text-left"
                      >
                        <p className="font-medium">
                          #{status.orderIndex} {status.name}
                        </p>
                        {status.description ? (
                          <p className="mt-0.5 text-xs text-slate-600">{status.description}</p>
                        ) : null}
                      </button>

                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => moveStatus(status, -1)}
                          disabled={status.orderIndex <= 1 || reorderBusyId === status.id}
                          className="rounded border border-slate-300 px-2 py-1 text-xs disabled:opacity-50"
                          title="Move up"
                        >
                          Up
                        </button>
                        <button
                          type="button"
                          onClick={() => moveStatus(status, 1)}
                          disabled={
                            status.orderIndex >= statusItems.length || reorderBusyId === status.id
                          }
                          className="rounded border border-slate-300 px-2 py-1 text-xs disabled:opacity-50"
                          title="Move down"
                        >
                          Down
                        </button>
                        <button
                          type="button"
                          onClick={() => beginEdit(status)}
                          className={`rounded border px-2 py-1 text-xs ${
                            isEditing
                              ? "border-brand-400 bg-brand-100 text-brand-800"
                              : "border-slate-300"
                          }`}
                        >
                          Edit
                        </button>
                      </div>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                      <span
                        className="inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-0.5"
                        title={status.colorCode ?? undefined}
                      >
                        <span
                          className="inline-block h-2.5 w-2.5 rounded-full border border-slate-200"
                          style={{ backgroundColor: status.colorCode ?? "#CBD5E1" }}
                        />
                        {status.colorCode ?? "No color"}
                      </span>
                      <span className="rounded border border-slate-200 px-2 py-0.5">
                        {status.isTerminal ? "Terminal" : "Non-terminal"}
                      </span>
                      <span className="rounded border border-slate-200 px-2 py-0.5">
                        {status.requiresNote ? "Note required" : "Note optional"}
                      </span>
                      <span className="rounded border border-slate-200 px-2 py-0.5">
                        {status.requiresDocument ? "Document required" : "Document optional"}
                      </span>
                      <span className="rounded border border-slate-200 px-2 py-0.5">
                        {status.notifyCustomer ? "Customer notified" : "No notification"}
                      </span>
                    </div>
                  </div>
                );
              })}
              {statusItems.length === 0 ? (
                <p className="text-sm text-slate-500">No statuses configured yet.</p>
              ) : null}
            </div>
          )}
        </section>

        <section className="rounded-xl bg-white p-3 shadow-sm sm:p-4">
          <h3 className="text-base font-semibold">
            {editingStatusId ? "Edit Status" : "Create Status"}
          </h3>
          <form className="mt-3 space-y-3" onSubmit={submitStatusForm}>
            <div>
              <label className="mb-1 block text-sm font-medium">Status Name</label>
              <input
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                {...register("name")}
              />
              {errors.name ? (
                <p className="mt-1 text-xs text-rose-600">{errors.name.message}</p>
              ) : null}
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium">Description</label>
              <textarea
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                rows={3}
                {...register("description")}
              />
              {errors.description ? (
                <p className="mt-1 text-xs text-rose-600">{errors.description.message}</p>
              ) : null}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium">Color Code</label>
                <input
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  placeholder="#2563EB"
                  {...register("colorCode")}
                />
                {errors.colorCode ? (
                  <p className="mt-1 text-xs text-rose-600">{errors.colorCode.message}</p>
                ) : null}
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">SLA Duration (Hours)</label>
                <input
                  type="number"
                  min={1}
                  max={24 * 365}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  {...register("slaDurationHours")}
                />
                {errors.slaDurationHours ? (
                  <p className="mt-1 text-xs text-rose-600">
                    {errors.slaDurationHours.message as string}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <label className="inline-flex items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4" {...register("isTerminal")} />
                Terminal status
              </label>
              <label className="inline-flex items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4" {...register("requiresNote")} />
                Require note on transition
              </label>
              <label className="inline-flex items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4" {...register("requiresDocument")} />
                Require document on transition
              </label>
              <label className="inline-flex items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4" {...register("notifyCustomer")} />
                Trigger customer notification
              </label>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium">Notification Template</label>
              <select
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-100"
                disabled={!notifyCustomerEnabled}
                {...register("notificationTemplateId")}
              >
                <option value="">Select template</option>
                {notificationTemplates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name} ({template.channel})
                  </option>
                ))}
              </select>
              {errors.notificationTemplateId ? (
                <p className="mt-1 text-xs text-rose-600">
                  {errors.notificationTemplateId.message}
                </p>
              ) : null}
            </div>

            {formError ? (
              <div className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {formError}
              </div>
            ) : null}
            {formSuccess ? (
              <div className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                {formSuccess}
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="submit"
                disabled={isSubmitting}
                className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
              >
                {isSubmitting
                  ? "Saving..."
                  : editingStatusId
                    ? "Update Status"
                    : "Create Status"}
              </button>
              {editingStatusId ? (
                <button
                  type="button"
                  onClick={resetToCreateMode}
                  className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
                >
                  Cancel Edit
                </button>
              ) : null}
            </div>
          </form>
        </section>
      </div>

      <section className="rounded-xl bg-white p-3 shadow-sm sm:p-4">
        <h3 className="text-base font-semibold">Allowed Next Statuses</h3>
        <p className="mt-1 text-sm text-slate-600">
          Configure which statuses can follow a selected source status.
        </p>

        <div className="mt-3 grid gap-3 lg:grid-cols-[280px_1fr]">
          <div>
            <label className="mb-1 block text-sm font-medium">From Status</label>
            <select
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={selectedFromStatus?.id ?? ""}
              onChange={(event) => setSelectedFromStatusId(event.target.value)}
            >
              {statusItems.map((status) => (
                <option key={status.id} value={status.id}>
                  #{status.orderIndex} {status.name}
                </option>
              ))}
            </select>
            {selectedFromStatus?.isTerminal ? (
              <p className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-800">
                Terminal statuses cannot have outgoing transitions.
              </p>
            ) : null}
          </div>

          <div>
            <p className="mb-1 text-sm font-medium">To Statuses</p>
            <div className="max-h-72 overflow-y-auto rounded-md border border-slate-200 p-2">
              {statusItems
                .filter((status) => status.id !== selectedFromStatus?.id)
                .map((status) => {
                  const checked = allowedToStatusIds.has(status.id);
                  const key = `${selectedFromStatus?.id ?? "none"}:${status.id}`;
                  const disabled =
                    !selectedFromStatus ||
                    selectedFromStatus.isTerminal ||
                    transitionBusyKey === key;
                  return (
                    <label
                      key={status.id}
                      className={`mb-1 flex cursor-pointer items-center justify-between rounded px-2 py-1 text-sm ${
                        checked ? "bg-emerald-50" : "hover:bg-slate-50"
                      } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
                    >
                      <span className="inline-flex items-center gap-2">
                        <input
                          type="checkbox"
                          className="h-4 w-4"
                          checked={checked}
                          disabled={disabled}
                          onChange={() => void toggleTransition(status.id)}
                        />
                        <span>
                          #{status.orderIndex} {status.name}
                        </span>
                      </span>
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-full border border-slate-200"
                        style={{ backgroundColor: status.colorCode ?? "#CBD5E1" }}
                      />
                    </label>
                  );
                })}
            </div>

            {transitionError ? (
              <div className="mt-2 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {transitionError}
              </div>
            ) : null}

            <p className="mt-2 text-xs text-slate-500">
              Changes are applied immediately and audited.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
