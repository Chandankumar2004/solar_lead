"use client";

import { FormEvent, useMemo, useState } from "react";
import useSWR from "swr";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { RealtimeNotifications } from "@/components/RealtimeNotifications";

type TemplateChannel = "SMS" | "EMAIL" | "WHATSAPP";

type NotificationTemplate = {
  id: string;
  name: string;
  channel: TemplateChannel;
  subject?: string | null;
  bodyTemplate: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

type NotificationLog = {
  id: string;
  leadId?: string | null;
  channel: string;
  recipient: string;
  contentSent: string;
  deliveryStatus: string;
  providerMessageId?: string | null;
  attempts: number;
  createdAt: string;
  lastAttemptedAt?: string | null;
  template?: {
    id: string;
    name: string;
    channel: string;
  } | null;
  lead?: {
    id: string;
    externalId: string;
    name: string;
    phone: string;
  } | null;
};

type Pagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

const fetcher = (url: string) => api.get(url).then((r) => r.data);

function extractApiMessage(error: unknown) {
  const maybe = error as { response?: { data?: { message?: string } } };
  return maybe.response?.data?.message ?? "Operation failed";
}

export default function NotificationsPage() {
  const user = useAuthStore((state) => state.user);
  const canManageTemplates = user?.role === "SUPER_ADMIN" || user?.role === "ADMIN";
  const canViewTemplates = user?.role === "SUPER_ADMIN" || user?.role === "ADMIN";
  const canViewLogs =
    user?.role === "SUPER_ADMIN" ||
    user?.role === "ADMIN" ||
    user?.role === "DISTRICT_MANAGER";
  const canPublishInternal = user?.role === "SUPER_ADMIN" || user?.role === "ADMIN";

  const [tab, setTab] = useState<"templates" | "logs" | "internal">(
    canViewTemplates ? "templates" : canViewLogs ? "logs" : "internal"
  );

  const [templateSearch, setTemplateSearch] = useState("");
  const [templateChannel, setTemplateChannel] = useState<TemplateChannel | "">("");
  const [templateIsActive, setTemplateIsActive] = useState<"" | "true" | "false">("");

  const templatesQuery = useMemo(() => {
    const params = new URLSearchParams();
    if (templateSearch.trim()) params.set("search", templateSearch.trim());
    if (templateChannel) params.set("channel", templateChannel);
    if (templateIsActive) params.set("isActive", templateIsActive);
    const query = params.toString();
    return `/api/notifications/templates${query ? `?${query}` : ""}`;
  }, [templateChannel, templateIsActive, templateSearch]);

  const {
    data: templatesResponse,
    mutate: mutateTemplates,
    isLoading: templatesLoading
  } = useSWR(canViewTemplates ? templatesQuery : null, fetcher);
  const templates = (templatesResponse?.data ?? []) as NotificationTemplate[];

  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [templateName, setTemplateName] = useState("");
  const [formChannel, setFormChannel] = useState<TemplateChannel>("SMS");
  const [templateSubject, setTemplateSubject] = useState("");
  const [templateBody, setTemplateBody] = useState("");
  const [formIsActive, setFormIsActive] = useState(true);
  const [templateLeadPreviewId, setTemplateLeadPreviewId] = useState("");
  const [renderedPreview, setRenderedPreview] = useState<{
    subject?: string | null;
    body: string;
  } | null>(null);
  const [templateSubmitting, setTemplateSubmitting] = useState(false);
  const [templateMessage, setTemplateMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const [logsPage, setLogsPage] = useState(1);
  const [logsPageSize, setLogsPageSize] = useState(20);
  const [logsChannel, setLogsChannel] = useState<"" | TemplateChannel | "PUSH">("");
  const [logsStatus, setLogsStatus] = useState("");
  const [logsSearch, setLogsSearch] = useState("");
  const [logsLeadId, setLogsLeadId] = useState("");
  const [logsTemplateId, setLogsTemplateId] = useState("");
  const [logsDateFrom, setLogsDateFrom] = useState("");
  const [logsDateTo, setLogsDateTo] = useState("");
  const logsQuery = useMemo(() => {
    const params = new URLSearchParams();
    params.set("page", String(logsPage));
    params.set("pageSize", String(logsPageSize));
    if (logsChannel) params.set("channel", logsChannel);
    if (logsStatus.trim()) params.set("status", logsStatus.trim());
    if (logsSearch.trim()) params.set("search", logsSearch.trim());
    if (logsLeadId.trim()) params.set("leadId", logsLeadId.trim());
    if (logsTemplateId.trim()) params.set("templateId", logsTemplateId.trim());
    if (logsDateFrom) params.set("dateFrom", logsDateFrom);
    if (logsDateTo) params.set("dateTo", logsDateTo);
    return `/api/notifications/logs?${params.toString()}`;
  }, [
    logsChannel,
    logsDateFrom,
    logsDateTo,
    logsLeadId,
    logsPage,
    logsPageSize,
    logsSearch,
    logsStatus,
    logsTemplateId
  ]);
  const { data: logsResponse, mutate: mutateLogs, isLoading: logsLoading } = useSWR(
    canViewLogs ? logsQuery : null,
    fetcher
  );
  const logs = (logsResponse?.data ?? []) as NotificationLog[];
  const logsPagination = (logsResponse?.pagination ?? null) as Pagination | null;

  const [feedTitle, setFeedTitle] = useState("");
  const [feedBody, setFeedBody] = useState("");
  const [feedSubmitting, setFeedSubmitting] = useState(false);
  const [feedError, setFeedError] = useState<string | null>(null);
  const { data: feedResponse, mutate: mutateFeed } = useSWR(
    "/api/notifications/feed",
    fetcher
  );
  const feedLogs = (feedResponse?.data ?? []) as NotificationLog[];

  const resetTemplateForm = () => {
    setEditingTemplateId(null);
    setTemplateName("");
    setFormChannel("SMS");
    setTemplateSubject("");
    setTemplateBody("");
    setFormIsActive(true);
    setTemplateLeadPreviewId("");
    setRenderedPreview(null);
  };

  const loadTemplateToForm = (template: NotificationTemplate) => {
    setEditingTemplateId(template.id);
    setTemplateName(template.name);
    setFormChannel(template.channel);
    setTemplateSubject(template.subject ?? "");
    setTemplateBody(template.bodyTemplate);
    setFormIsActive(template.isActive);
    setRenderedPreview(null);
  };

  const onTemplateSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canManageTemplates) return;

    setTemplateSubmitting(true);
    setTemplateMessage(null);
    try {
      const payload = {
        name: templateName,
        channel: formChannel,
        subject: templateSubject.trim().length ? templateSubject.trim() : null,
        bodyTemplate: templateBody,
        isActive: formIsActive
      };
      if (editingTemplateId) {
        await api.patch(`/api/notifications/templates/${editingTemplateId}`, payload);
      } else {
        await api.post("/api/notifications/templates", payload);
      }
      setTemplateMessage({
        type: "success",
        text: editingTemplateId ? "Template updated." : "Template created."
      });
      resetTemplateForm();
      await mutateTemplates();
    } catch (error) {
      setTemplateMessage({
        type: "error",
        text: extractApiMessage(error)
      });
    } finally {
      setTemplateSubmitting(false);
    }
  };

  const onDeleteTemplate = async (templateId: string) => {
    if (!canManageTemplates) return;
    if (!window.confirm("Delete this template?")) return;
    setTemplateMessage(null);
    try {
      await api.delete(`/api/notifications/templates/${templateId}`);
      if (editingTemplateId === templateId) {
        resetTemplateForm();
      }
      setTemplateMessage({
        type: "success",
        text: "Template deleted."
      });
      await mutateTemplates();
    } catch (error) {
      setTemplateMessage({
        type: "error",
        text: extractApiMessage(error)
      });
    }
  };

  const onRenderPreview = async () => {
    if (!editingTemplateId || !templateLeadPreviewId.trim()) {
      setTemplateMessage({
        type: "error",
        text: "Enter a lead ID and select a template to render preview."
      });
      return;
    }
    try {
      const response = await api.post(
        `/api/notifications/templates/${editingTemplateId}/render`,
        {
          leadId: templateLeadPreviewId.trim()
        }
      );
      const rendered = response.data?.data?.rendered as
        | { subject?: string | null; body: string }
        | undefined;
      if (!rendered) {
        setTemplateMessage({
          type: "error",
          text: "Template preview unavailable."
        });
        return;
      }
      setRenderedPreview(rendered);
      setTemplateMessage(null);
    } catch (error) {
      setRenderedPreview(null);
      setTemplateMessage({
        type: "error",
        text: extractApiMessage(error)
      });
    }
  };

  const onInternalSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setFeedError(null);
    setFeedSubmitting(true);
    try {
      await api.post("/api/notifications/internal", {
        title: feedTitle,
        body: feedBody
      });
      setFeedTitle("");
      setFeedBody("");
      await mutateFeed();
    } catch (submitError) {
      setFeedError(extractApiMessage(submitError));
    } finally {
      setFeedSubmitting(false);
    }
  };

  return (
    <div className="min-w-0 space-y-4">
      <section className="rounded-xl bg-white p-3 shadow-sm">
        <div className="flex flex-wrap gap-2">
          {canViewTemplates ? (
            <>
              <button
                onClick={() => setTab("templates")}
                className={`rounded-md px-3 py-1.5 text-sm ${
                  tab === "templates"
                    ? "bg-brand-50 font-medium text-brand-700"
                    : "text-slate-700 hover:bg-slate-100"
                }`}
              >
                Templates
              </button>
            </>
          ) : null}
          {canViewLogs ? (
            <button
              onClick={() => setTab("logs")}
              className={`rounded-md px-3 py-1.5 text-sm ${
                tab === "logs"
                  ? "bg-brand-50 font-medium text-brand-700"
                  : "text-slate-700 hover:bg-slate-100"
              }`}
            >
              Logs
            </button>
          ) : null}
          <button
            onClick={() => setTab("internal")}
            className={`rounded-md px-3 py-1.5 text-sm ${
              tab === "internal"
                ? "bg-brand-50 font-medium text-brand-700"
                : "text-slate-700 hover:bg-slate-100"
            }`}
          >
            Internal
          </button>
        </div>
      </section>

      {tab === "templates" && canViewTemplates ? (
        <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
          <section className="rounded-xl bg-white p-3 shadow-sm sm:p-4">
            <h2 className="text-base font-semibold">Notification Templates</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <input
                value={templateSearch}
                onChange={(event) => setTemplateSearch(event.target.value)}
                placeholder="Search templates"
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
              <select
                value={templateChannel}
                onChange={(event) => setTemplateChannel(event.target.value as TemplateChannel | "")}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">All channels</option>
                <option value="SMS">SMS</option>
                <option value="EMAIL">Email</option>
                <option value="WHATSAPP">WhatsApp</option>
              </select>
              <select
                value={templateIsActive}
                onChange={(event) =>
                  setTemplateIsActive(event.target.value as "" | "true" | "false")
                }
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">All states</option>
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </select>
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-100 text-left text-xs uppercase text-slate-600">
                  <tr>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Channel</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Updated</th>
                    <th className="px-3 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {templatesLoading ? (
                    <tr>
                      <td className="px-3 py-3 text-slate-500" colSpan={5}>
                        Loading templates...
                      </td>
                    </tr>
                  ) : templates.length === 0 ? (
                    <tr>
                      <td className="px-3 py-3 text-slate-500" colSpan={5}>
                        No templates found.
                      </td>
                    </tr>
                  ) : (
                    templates.map((template) => (
                      <tr key={template.id} className="border-t border-slate-100">
                        <td className="px-3 py-2">
                          <p className="font-medium">{template.name}</p>
                          <p className="text-xs text-slate-500">{template.subject ?? "-"}</p>
                        </td>
                        <td className="px-3 py-2">{template.channel}</td>
                        <td className="px-3 py-2">
                          {template.isActive ? "Active" : "Inactive"}
                        </td>
                        <td className="px-3 py-2">
                          {new Date(template.updatedAt).toLocaleString()}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex gap-2">
                            <button
                              onClick={() => loadTemplateToForm(template)}
                              className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50"
                            >
                              Edit
                            </button>
                            {canManageTemplates ? (
                              <button
                                onClick={() => void onDeleteTemplate(template.id)}
                                className="rounded border border-rose-300 px-2 py-1 text-xs text-rose-700 hover:bg-rose-50"
                              >
                                Delete
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <aside className="space-y-3 rounded-xl bg-white p-3 shadow-sm sm:p-4">
            <h3 className="text-base font-semibold">
              {editingTemplateId ? "Edit Template" : "Create Template"}
            </h3>
            <form onSubmit={onTemplateSubmit} className="space-y-3">
              <input
                value={templateName}
                onChange={(event) => setTemplateName(event.target.value)}
                placeholder="Template name"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                disabled={!canManageTemplates}
                required
              />
              <select
                value={formChannel}
                onChange={(event) => setFormChannel(event.target.value as TemplateChannel)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                disabled={!canManageTemplates}
              >
                <option value="SMS">SMS</option>
                <option value="EMAIL">Email</option>
                <option value="WHATSAPP">WhatsApp</option>
              </select>
              <input
                value={templateSubject}
                onChange={(event) => setTemplateSubject(event.target.value)}
                placeholder="Subject (required for email)"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                disabled={!canManageTemplates}
              />
              <textarea
                value={templateBody}
                onChange={(event) => setTemplateBody(event.target.value)}
                placeholder="Body template (use {{customer_name}}, {{lead_id}}, {{status}})"
                rows={6}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                disabled={!canManageTemplates}
                required
              />
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={formIsActive}
                  onChange={(event) => setFormIsActive(event.target.checked)}
                  disabled={!canManageTemplates}
                />
                Active
              </label>
              {canManageTemplates ? (
                <div className="flex items-center gap-2">
                  <button
                    disabled={templateSubmitting}
                    className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-70"
                  >
                    {templateSubmitting
                      ? "Saving..."
                      : editingTemplateId
                        ? "Update Template"
                        : "Create Template"}
                  </button>
                  {editingTemplateId ? (
                    <button
                      type="button"
                      onClick={resetTemplateForm}
                      className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50"
                    >
                      Cancel
                    </button>
                  ) : null}
                </div>
              ) : (
                <p className="text-sm text-slate-500">
                  You have read-only access to templates.
                </p>
              )}
            </form>

            <div className="rounded-md border border-slate-200 p-3">
              <p className="text-sm font-medium">Render Preview</p>
              <div className="mt-2 space-y-2">
                <input
                  value={templateLeadPreviewId}
                  onChange={(event) => setTemplateLeadPreviewId(event.target.value)}
                  placeholder="Lead ID (UUID)"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  onClick={() => void onRenderPreview()}
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50"
                >
                  Render
                </button>
                {renderedPreview ? (
                  <div className="space-y-1 rounded bg-slate-50 p-2 text-xs text-slate-700">
                    <p>
                      <span className="font-medium">Subject:</span>{" "}
                      {renderedPreview.subject ?? "-"}
                    </p>
                    <p className="whitespace-pre-wrap">
                      <span className="font-medium">Body:</span> {renderedPreview.body}
                    </p>
                  </div>
                ) : null}
              </div>
            </div>

            {templateMessage ? (
              <p
                className={`text-sm ${
                  templateMessage.type === "success" ? "text-emerald-700" : "text-rose-700"
                }`}
              >
                {templateMessage.text}
              </p>
            ) : null}
          </aside>
        </div>
      ) : null}

      {tab === "logs" && canViewLogs ? (
        <div className="space-y-4">
          <section className="rounded-xl bg-white p-3 shadow-sm sm:p-4">
            <h2 className="text-base font-semibold">Notification Logs</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <select
                value={logsChannel}
                onChange={(event) =>
                  setLogsChannel(event.target.value as "" | TemplateChannel | "PUSH")
                }
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">All channels</option>
                <option value="SMS">SMS</option>
                <option value="EMAIL">Email</option>
                <option value="WHATSAPP">WhatsApp</option>
                <option value="PUSH">Push</option>
              </select>
              <input
                value={logsStatus}
                onChange={(event) => setLogsStatus(event.target.value)}
                placeholder="Status (sent/failed/retrying)"
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
              <input
                value={logsSearch}
                onChange={(event) => setLogsSearch(event.target.value)}
                placeholder="Search recipient/content"
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
              <input
                value={logsLeadId}
                onChange={(event) => setLogsLeadId(event.target.value)}
                placeholder="Lead ID (UUID)"
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
              <input
                value={logsTemplateId}
                onChange={(event) => setLogsTemplateId(event.target.value)}
                placeholder="Template ID (UUID)"
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
              <input
                type="date"
                value={logsDateFrom}
                onChange={(event) => setLogsDateFrom(event.target.value)}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
              <input
                type="date"
                value={logsDateTo}
                onChange={(event) => setLogsDateTo(event.target.value)}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
              <button
                onClick={() => void mutateLogs()}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50"
              >
                Refresh
              </button>
            </div>
          </section>

          <section className="overflow-hidden rounded-xl bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-100 text-left text-xs uppercase text-slate-600">
                  <tr>
                    <th className="px-3 py-2">When</th>
                    <th className="px-3 py-2">Channel</th>
                    <th className="px-3 py-2">Template</th>
                    <th className="px-3 py-2">Recipient</th>
                    <th className="px-3 py-2">Lead</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Attempts</th>
                    <th className="px-3 py-2">Provider ID</th>
                  </tr>
                </thead>
                <tbody>
                  {logsLoading ? (
                    <tr>
                      <td className="px-3 py-3 text-slate-500" colSpan={8}>
                        Loading logs...
                      </td>
                    </tr>
                  ) : logs.length === 0 ? (
                    <tr>
                      <td className="px-3 py-3 text-slate-500" colSpan={8}>
                        No logs found.
                      </td>
                    </tr>
                  ) : (
                    logs.map((log) => (
                      <tr key={log.id} className="border-t border-slate-100">
                        <td className="px-3 py-2">
                          {new Date(log.createdAt).toLocaleString()}
                        </td>
                        <td className="px-3 py-2">{log.channel}</td>
                        <td className="px-3 py-2">{log.template?.name ?? "-"}</td>
                        <td className="px-3 py-2">{log.recipient || "-"}</td>
                        <td className="px-3 py-2">
                          {log.lead ? `${log.lead.externalId} (${log.lead.name})` : "-"}
                        </td>
                        <td className="px-3 py-2">{log.deliveryStatus}</td>
                        <td className="px-3 py-2">{log.attempts}</td>
                        <td className="px-3 py-2">{log.providerMessageId ?? "-"}</td>
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
                <p className="text-sm text-slate-600">Total: {logsPagination?.total ?? 0}</p>
                <select
                  value={logsPageSize}
                  onChange={(event) => {
                    setLogsPageSize(Number(event.target.value));
                    setLogsPage(1);
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
                  onClick={() => setLogsPage((current) => Math.max(1, current - 1))}
                  disabled={(logsPagination?.page ?? 1) <= 1}
                  className="rounded border border-slate-300 px-3 py-1 text-sm disabled:opacity-50"
                >
                  Previous
                </button>
                <span className="text-sm text-slate-600">
                  Page {logsPagination?.page ?? 1} / {logsPagination?.totalPages ?? 1}
                </span>
                <button
                  onClick={() =>
                    setLogsPage((current) =>
                      Math.min(logsPagination?.totalPages ?? 1, current + 1)
                    )
                  }
                  disabled={(logsPagination?.page ?? 1) >= (logsPagination?.totalPages ?? 1)}
                  className="rounded border border-slate-300 px-3 py-1 text-sm disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {tab === "internal" ? (
        <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
          <section className="rounded-xl bg-white p-3 shadow-sm sm:p-4">
            <h2 className="text-base font-semibold">My Notification Feed</h2>
            <div className="mt-3 space-y-2">
              {feedLogs.length === 0 ? (
                <p className="text-sm text-slate-500">No notifications yet.</p>
              ) : (
                feedLogs.map((item) => (
                  <div key={item.id} className="rounded border border-slate-200 p-3 text-sm">
                    <p className="font-medium">{item.channel}</p>
                    <p className="text-slate-600">{item.deliveryStatus}</p>
                    <p className="text-xs text-slate-500">
                      {new Date(item.createdAt).toLocaleString()}
                    </p>
                  </div>
                ))
              )}
            </div>
          </section>

          <div className="space-y-4">
            <section className="rounded-xl bg-white p-3 shadow-sm sm:p-4">
              <h2 className="text-base font-semibold">Publish Internal Notification</h2>
              {canPublishInternal ? (
                <form onSubmit={onInternalSubmit} className="mt-3 space-y-3">
                  <input
                    value={feedTitle}
                    onChange={(event) => setFeedTitle(event.target.value)}
                    placeholder="Title"
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    required
                  />
                  <textarea
                    value={feedBody}
                    onChange={(event) => setFeedBody(event.target.value)}
                    placeholder="Body"
                    rows={4}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    required
                  />
                  {feedError ? <p className="text-sm text-rose-600">{feedError}</p> : null}
                  <button
                    disabled={feedSubmitting}
                    className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-70"
                  >
                    {feedSubmitting ? "Sending..." : "Send Notification"}
                  </button>
                </form>
              ) : (
                <p className="mt-3 text-sm text-slate-600">
                  Internal publish is restricted to Super Admin and Admin.
                </p>
              )}
            </section>
            <RealtimeNotifications />
          </div>
        </div>
      ) : null}
    </div>
  );
}
