"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";

type LeadDetail = {
  id: string;
  externalId: string;
  name: string;
  phone: string;
  email?: string | null;
  state?: string | null;
  installationType?: string | null;
  message?: string | null;
  monthlyBill?: string | number | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmTerm?: string | null;
  utmContent?: string | null;
  sourceIp?: string | null;
  recaptchaScore?: string | number | null;
  consentGiven?: boolean;
  consentTimestamp?: string | null;
  consentIpAddress?: string | null;
  emailOptOut?: boolean;
  whatsappOptOut?: boolean;
  smsDndStatus?: boolean;
  optOutTimestamp?: string | null;
  optOutSource?: string | null;
  district?: { id: string; name: string; state: string } | null;
  currentStatus?: { id: string; name: string } | null;
  assignedExecutive?: { id: string; fullName: string; email: string } | null;
  assignedManager?: { id: string; fullName: string; email: string } | null;
  createdAt: string;
  updatedAt: string;
  customerDetail?: {
    fullName?: string | null;
    dateOfBirth?: string | null;
    gender?: string | null;
    fatherHusbandName?: string | null;
    addressLine1?: string | null;
    addressLine2?: string | null;
    villageLocality?: string | null;
    pincode?: string | null;
    alternatePhone?: string | null;
    propertyOwnership?: string | null;
    roofArea?: string | number | null;
    recommendedCapacity?: string | number | null;
    shadowFreeArea?: string | number | null;
    roofType?: string | null;
    verifiedMonthlyBill?: string | number | null;
    connectionType?: string | null;
    consumerNumber?: string | null;
    discomName?: string | null;
    bankName?: string | null;
    ifscCode?: string | null;
    accountHolderName?: string | null;
    loanRequired?: boolean | null;
    loanAmountRequired?: string | number | null;
    preferredLender?: string | null;
    createdAt?: string;
    updatedAt?: string;
  } | null;
  documents?: Array<{
    id: string;
    category: string;
    s3Key: string;
    fileName: string;
    fileType: string;
    fileSize: number;
    version: number;
    isLatest: boolean;
    reviewStatus: string;
    reviewNotes?: string | null;
    reviewedAt?: string | null;
    createdAt: string;
    uploadedByUser?: { fullName?: string | null; email?: string | null } | null;
    reviewedByUser?: { fullName?: string | null; email?: string | null } | null;
  }>;
  payments?: Array<{
    id: string;
    amount: string | number;
    method: string;
    status: string;
    gatewayOrderId?: string | null;
    gatewayPaymentId?: string | null;
    utrNumber?: string | null;
    rejectionReason?: string | null;
    verifiedAt?: string | null;
    createdAt: string;
    collectedByUser?: { fullName?: string | null } | null;
    verifiedByUser?: { fullName?: string | null } | null;
  }>;
  loanDetails?: {
    lenderName?: string | null;
    applicationNumber?: string | null;
    appliedAmount?: string | number | null;
    approvedAmount?: string | number | null;
    applicationStatus?: string | null;
    appliedAt?: string | null;
    approvedAt?: string | null;
    disbursedAt?: string | null;
    rejectionReason?: string | null;
    notes?: string | null;
    updatedAt?: string;
  } | null;
  statusHistory?: Array<{
    id: string;
    createdAt: string;
    notes?: string | null;
    fromStatus?: { name: string } | null;
    toStatus?: { name: string } | null;
    changedByUser?: { fullName: string; email: string } | null;
  }>;
  notificationLogs?: Array<{
    id: string;
    channel: string;
    recipient: string;
    deliveryStatus: string;
    contentSent: string;
    providerMessageId?: string | null;
    attempts: number;
    createdAt: string;
    lastAttemptedAt?: string | null;
    template?: { name: string; channel: string } | null;
  }>;
  internalNotes?: Array<{
    id: string;
    note: string;
    createdAt: string;
    actor?: { id: string; fullName: string; email: string } | null;
  }>;
  activityLog?: Array<{
    id: string;
    action: string;
    entityType: string;
    entityId?: string | null;
    details?: unknown;
    ipAddress?: string | null;
    createdAt: string;
    actor?: { id: string; fullName: string; email: string } | null;
  }>;
};

type DashboardSummaryEnvelope = {
  data?: {
    fieldExecutivePerformance?: Array<{
      executiveId: string;
      fullName: string;
      email: string;
      totalAssigned: number;
      activeLeads: number;
      terminalLeads: number;
      pendingDocuments: number;
      pendingPayments: number;
    }>;
  };
};

type DownloadEnvelope = {
  data?: {
    downloadUrl: string;
    fileType: string;
    fileName: string;
  };
};

const MAX_DOCUMENT_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED_DOCUMENT_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png"
]);

function inferDocumentMimeTypeFromName(fileName: string) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  return "";
}

function validateWebDocumentFile(file: File) {
  const normalizedType = (file.type || "").toLowerCase();
  const resolvedMimeType = ALLOWED_DOCUMENT_MIME_TYPES.has(normalizedType)
    ? normalizedType
    : inferDocumentMimeTypeFromName(file.name);

  if (!ALLOWED_DOCUMENT_MIME_TYPES.has(resolvedMimeType)) {
    return {
      fileType: null as string | null,
      error: "Unsupported file type. Only PDF, JPG, JPEG, and PNG are allowed."
    };
  }
  if (file.size > MAX_DOCUMENT_SIZE_BYTES) {
    return {
      fileType: null as string | null,
      error: "File size must be 10 MB or smaller."
    };
  }
  return { fileType: resolvedMimeType, error: null as string | null };
}

type TabId =
  | "overview"
  | "timeline"
  | "customer"
  | "documents"
  | "payments"
  | "loan"
  | "communications"
  | "notes"
  | "activity";

const baseTabs: Array<{ id: TabId; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "timeline", label: "Status Timeline" },
  { id: "customer", label: "Customer Information" },
  { id: "documents", label: "Documents" },
  { id: "payments", label: "Payments" },
  { id: "loan", label: "Loan Details" },
  { id: "communications", label: "Communications Log" },
  { id: "notes", label: "Internal Notes" },
  { id: "activity", label: "Activity Log" }
];

const fetcher = (url: string) => api.get(url).then((response) => response.data);

function extractApiMessage(error: unknown) {
  const maybe = error as { response?: { data?: { message?: string } } };
  return maybe.response?.data?.message ?? "Action failed";
}

function renderField(label: string, value: string | number | boolean | null | undefined) {
  let display: string;
  if (value === null || value === undefined || value === "") {
    display = "-";
  } else if (typeof value === "boolean") {
    display = value ? "Yes" : "No";
  } else {
    display = String(value);
  }
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-medium">{display}</p>
    </div>
  );
}

export default function LeadDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const leadId = params.id;
  const user = useAuthStore((state) => state.user);
  const isSuperAdmin = user?.role === "SUPER_ADMIN";
  const canWebUploadDocument = user?.role === "SUPER_ADMIN" || user?.role === "ADMIN";
  const canViewDocumentHistory = user?.role === "SUPER_ADMIN" || user?.role === "ADMIN";
  const canViewInternalNotes =
    user?.role === "SUPER_ADMIN" ||
    user?.role === "ADMIN" ||
    user?.role === "DISTRICT_MANAGER";
  const canReassign =
    user?.role === "SUPER_ADMIN" || user?.role === "ADMIN" || user?.role === "DISTRICT_MANAGER";
  const canSubmitQrUtr = user?.role === "FIELD_EXECUTIVE";
  const visibleTabs = useMemo(
    () => baseTabs.filter((tab) => (tab.id === "notes" ? canViewInternalNotes : true)),
    [canViewInternalNotes]
  );

  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [assignmentExecutiveId, setAssignmentExecutiveId] = useState("");
  const [assignmentReason, setAssignmentReason] = useState("");
  const [assignmentLoading, setAssignmentLoading] = useState(false);
  const [assignmentMessage, setAssignmentMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const [previewLoadingDocId, setPreviewLoadingDocId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewType, setPreviewType] = useState<string | null>(null);
  const [previewName, setPreviewName] = useState<string | null>(null);
  const [uploadCategory, setUploadCategory] = useState("general");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadSubmitting, setUploadSubmitting] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [showDocumentHistory, setShowDocumentHistory] = useState(false);
  const [uploadInputKey, setUploadInputKey] = useState(0);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentUtrNumber, setPaymentUtrNumber] = useState("");
  const [paymentSubmitting, setPaymentSubmitting] = useState(false);
  const [paymentMessage, setPaymentMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [internalNoteDraft, setInternalNoteDraft] = useState("");
  const [noteSubmitting, setNoteSubmitting] = useState(false);
  const [noteMessage, setNoteMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const { data: lead, isLoading, mutate } = useSWR(
    leadId ? `/api/leads/${leadId}` : null,
    (url: string) => api.get(url).then((response) => response.data?.data as LeadDetail)
  );

  const workloadKey = useMemo(() => {
    const districtId = lead?.district?.id;
    if (!districtId) return null;
    return `/api/dashboard/summary?districtId=${districtId}`;
  }, [lead?.district?.id]);

  const { data: workloadData, mutate: mutateWorkload } = useSWR(workloadKey, fetcher);
  const executives: NonNullable<
    NonNullable<DashboardSummaryEnvelope["data"]>["fieldExecutivePerformance"]
  > =
    (workloadData as DashboardSummaryEnvelope | undefined)?.data?.fieldExecutivePerformance ?? [];

  useEffect(() => {
    setAssignmentExecutiveId(lead?.assignedExecutive?.id ?? "");
  }, [lead?.assignedExecutive?.id]);

  useEffect(() => {
    if (activeTab === "notes" && !canViewInternalNotes) {
      setActiveTab("overview");
    }
  }, [activeTab, canViewInternalNotes]);

  const currentExecutiveId = lead?.assignedExecutive?.id ?? "";
  const isReassignment = Boolean(currentExecutiveId);
  const hasAssignmentChange =
    Boolean(assignmentExecutiveId) &&
    assignmentExecutiveId !== currentExecutiveId;
  const hasRequiredReason = !isReassignment || assignmentReason.trim().length >= 5;
  const canSubmitReassignment = hasAssignmentChange && hasRequiredReason && !assignmentLoading;
  const visibleDocuments = useMemo(() => {
    const documents = lead?.documents ?? [];
    if (showDocumentHistory) return documents;
    return documents.filter((document) => document.isLatest);
  }, [lead?.documents, showDocumentHistory]);

  const handleReassign = async () => {
    if (!lead || !canSubmitReassignment) return;
    const endpoint = isReassignment
      ? `/api/leads/${lead.id}/reassign`
      : `/api/leads/${lead.id}/assign`;
    const confirmed = window.confirm(
      isReassignment
        ? "Confirm reassignment for this lead?"
        : "Confirm manual assignment for this lead?"
    );
    if (!confirmed) return;

    setAssignmentLoading(true);
    setAssignmentMessage(null);
    try {
      await api.post(endpoint, {
        assignedExecutiveId: assignmentExecutiveId,
        ...(isReassignment ? { reason: assignmentReason.trim() } : {})
      });
      setAssignmentMessage({
        type: "success",
        text: isReassignment
          ? "Lead reassigned successfully."
          : "Lead assigned successfully."
      });
      setAssignmentReason("");
      await Promise.all([mutate(), mutateWorkload()]);
    } catch (error) {
      setAssignmentMessage({ type: "error", text: extractApiMessage(error) });
    } finally {
      setAssignmentLoading(false);
    }
  };

  const requestDocumentUrl = async (documentId: string) => {
    const response = await api.get(`/api/documents/${documentId}/download-url`);
    return response.data as DownloadEnvelope;
  };

  const handlePreview = async (documentId: string) => {
    try {
      setPreviewLoadingDocId(documentId);
      const payload = await requestDocumentUrl(documentId);
      const url = payload.data?.downloadUrl;
      if (!url) return;
      setPreviewUrl(url);
      setPreviewType(payload.data?.fileType ?? null);
      setPreviewName(payload.data?.fileName ?? null);
      setActiveTab("documents");
    } finally {
      setPreviewLoadingDocId(null);
    }
  };

  const handleDownload = async (documentId: string) => {
    try {
      setPreviewLoadingDocId(documentId);
      const payload = await requestDocumentUrl(documentId);
      const url = payload.data?.downloadUrl;
      if (!url) return;
      window.open(url, "_blank", "noopener,noreferrer");
    } finally {
      setPreviewLoadingDocId(null);
    }
  };

  const uploadLeadDocument = async () => {
    if (!lead || !canWebUploadDocument) return;
    if (!uploadFile) {
      setUploadMessage({ type: "error", text: "Please select a file to upload." });
      return;
    }
    const validation = validateWebDocumentFile(uploadFile);
    if (validation.error || !validation.fileType) {
      setUploadMessage({ type: "error", text: validation.error ?? "Invalid file selected." });
      return;
    }

    const category = uploadCategory.trim().length >= 2 ? uploadCategory.trim() : "general";
    const fileType = validation.fileType;

    setUploadSubmitting(true);
    setUploadMessage(null);
    try {
      const presignResponse = await api.post(`/api/leads/${lead.id}/documents/presign`, {
        category,
        fileName: uploadFile.name,
        fileType,
        fileSize: uploadFile.size
      });

      const uploadUrl = presignResponse.data?.data?.uploadUrl as string | undefined;
      const storagePath =
        (presignResponse.data?.data?.storagePath as string | undefined) ??
        (presignResponse.data?.data?.s3Key as string | undefined);
      if (!uploadUrl || !storagePath) {
        throw new Error("Upload URL generation failed.");
      }

      const putResponse = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Type": fileType
        },
        body: uploadFile
      });
      if (!putResponse.ok) {
        throw new Error(`File upload failed (${putResponse.status})`);
      }

      await api.post(`/api/leads/${lead.id}/documents/complete`, {
        category,
        storagePath,
        s3Key: storagePath,
        fileName: uploadFile.name,
        fileType,
        fileSize: uploadFile.size
      });

      setUploadMessage({ type: "success", text: "Document uploaded successfully." });
      setUploadFile(null);
      setUploadInputKey((current) => current + 1);
      await mutate();
    } catch (error) {
      setUploadMessage({ type: "error", text: extractApiMessage(error) });
    } finally {
      setUploadSubmitting(false);
    }
  };

  const submitQrUtrPayment = async () => {
    if (!lead) return;
    if (!canSubmitQrUtr) {
      setPaymentMessage({
        type: "error",
        text: "Only assigned field executive can submit QR UTR payment."
      });
      return;
    }

    const amount = Number(paymentAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setPaymentMessage({
        type: "error",
        text: "Enter a valid payment amount."
      });
      return;
    }
    if (paymentUtrNumber.trim().length < 6) {
      setPaymentMessage({
        type: "error",
        text: "UTR number must be at least 6 characters."
      });
      return;
    }

    setPaymentSubmitting(true);
    setPaymentMessage(null);
    try {
      await api.post("/api/payments/qr-utr", {
        leadId: lead.id,
        amount,
        utrNumber: paymentUtrNumber.trim()
      });
      setPaymentAmount("");
      setPaymentUtrNumber("");
      setPaymentMessage({
        type: "success",
        text: "QR-UTR payment created and queued for verification."
      });
      await mutate();
    } catch (error) {
      setPaymentMessage({
        type: "error",
        text: extractApiMessage(error)
      });
    } finally {
      setPaymentSubmitting(false);
    }
  };

  const addInternalNote = async () => {
    if (!lead || !canViewInternalNotes) return;
    const note = internalNoteDraft.trim();
    if (note.length < 3) {
      setNoteMessage({
        type: "error",
        text: "Internal note must be at least 3 characters."
      });
      return;
    }

    setNoteSubmitting(true);
    setNoteMessage(null);
    try {
      await api.post(`/api/leads/${lead.id}/internal-notes`, { note });
      setInternalNoteDraft("");
      setNoteMessage({
        type: "success",
        text: "Internal note added."
      });
      await mutate();
    } catch (error) {
      setNoteMessage({
        type: "error",
        text: extractApiMessage(error)
      });
    } finally {
      setNoteSubmitting(false);
    }
  };

  const deleteLead = async () => {
    if (!lead || !isSuperAdmin) return;
    const confirmed = window.confirm(
      `Delete lead "${lead.name}" (${lead.externalId})? This cannot be undone.`
    );
    if (!confirmed) return;

    try {
      await api.delete(`/api/leads/${lead.id}`);
      router.push("/leads");
    } catch (error) {
      setAssignmentMessage({ type: "error", text: extractApiMessage(error) });
    }
  };

  if (isLoading) {
    return <p className="text-sm text-slate-500">Loading lead details...</p>;
  }

  if (!lead) {
    return (
      <div className="space-y-3 rounded-xl bg-white p-4 shadow-sm">
        <p className="text-sm text-slate-600">Lead not found.</p>
        <Link href="/leads" className="text-sm font-medium text-brand-700 hover:underline">
          Back to Leads
        </Link>
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-4">
      <section className="rounded-xl bg-white p-3 shadow-sm sm:p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wide text-slate-500">{lead.externalId}</p>
            <h1 className="break-words text-lg font-semibold sm:text-xl">{lead.name}</h1>
            <p className="break-words text-sm text-slate-600">
              {lead.phone} {lead.email ? `• ${lead.email}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isSuperAdmin ? (
              <button
                onClick={() => void deleteLead()}
                className="rounded-md border border-rose-300 px-3 py-1 text-sm text-rose-700 hover:bg-rose-50"
              >
                Delete Lead
              </button>
            ) : null}
            <Link href="/leads" className="text-sm font-medium text-brand-700 hover:underline">
              Back to Leads
            </Link>
          </div>
        </div>
        <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
          {renderField("Current Status", lead.currentStatus?.name)}
          {renderField("District", lead.district?.name)}
          {renderField("State", lead.state ?? lead.district?.state)}
          {renderField("Installation Type", lead.installationType)}
          {renderField("Assigned Executive", lead.assignedExecutive?.fullName)}
          {renderField("Assigned Manager", lead.assignedManager?.fullName)}
          {renderField("Created At", new Date(lead.createdAt).toLocaleString())}
          {renderField("Updated At", new Date(lead.updatedAt).toLocaleString())}
        </div>
      </section>

      <section className="rounded-xl bg-white p-3 shadow-sm sm:p-4">
        <h2 className="text-base font-semibold">Assignment Panel</h2>
        <div className="mt-3 grid gap-4 xl:grid-cols-[360px_1fr]">
          <div className="space-y-2">
            <label className="block text-xs font-medium text-slate-600">Assign Executive</label>
            <select
              value={assignmentExecutiveId}
              onChange={(event) => setAssignmentExecutiveId(event.target.value)}
              disabled={!canReassign}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm disabled:opacity-60"
            >
              <option value="">Select executive</option>
              {executives.map((executive) => (
                <option key={executive.executiveId} value={executive.executiveId}>
                  {executive.fullName} (active {executive.activeLeads})
                </option>
              ))}
            </select>
            <label className="block text-xs font-medium text-slate-600">Reassignment Reason</label>
            <textarea
              value={assignmentReason}
              onChange={(event) => setAssignmentReason(event.target.value)}
              placeholder={
                isReassignment
                  ? "Reason is required for reassignment (min 5 chars)"
                  : "Optional note for assignment"
              }
              disabled={!canReassign}
              rows={3}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm disabled:opacity-60"
            />
            {!canReassign ? (
              <p className="text-xs text-slate-500">
                You do not have permission to reassign this lead.
              </p>
            ) : null}
            <button
              onClick={() => void handleReassign()}
              disabled={!canSubmitReassignment}
              className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {assignmentLoading
                ? isReassignment
                  ? "Reassigning..."
                  : "Assigning..."
                : isReassignment
                  ? "Reassign Lead"
                  : "Assign Lead"}
            </button>
            {assignmentMessage ? (
              <p
                className={`text-sm ${
                  assignmentMessage.type === "success" ? "text-emerald-700" : "text-rose-700"
                }`}
              >
                {assignmentMessage.text}
              </p>
            ) : null}
          </div>
          <div className="overflow-x-auto rounded-md border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-100 text-left text-xs uppercase text-slate-600">
                <tr>
                  <th className="px-3 py-2">Executive</th>
                  <th className="px-3 py-2">Assigned</th>
                  <th className="px-3 py-2">Active</th>
                  <th className="px-3 py-2">Pending Docs</th>
                  <th className="px-3 py-2">Pending Payments</th>
                </tr>
              </thead>
              <tbody>
                {executives.length === 0 ? (
                  <tr>
                    <td className="px-3 py-3 text-slate-500" colSpan={5}>
                      No workload data available.
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
                      <td className="px-3 py-2">{executive.pendingDocuments}</td>
                      <td className="px-3 py-2">{executive.pendingPayments}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="rounded-xl bg-white p-3 shadow-sm sm:p-4">
        <nav className="flex gap-2 overflow-x-auto border-b border-slate-200 pb-3">
          {visibleTabs.map((tab) => {
            const active = tab.id === activeTab;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`rounded-md px-3 py-1.5 text-sm ${
                  active
                    ? "bg-brand-50 font-medium text-brand-700"
                    : "text-slate-700 hover:bg-slate-100"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </nav>

        {activeTab === "overview" ? (
          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            <div className="space-y-3 rounded-md border border-slate-200 p-3">
              <h3 className="text-sm font-semibold">Lead Information</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                {renderField("Monthly Bill", lead.monthlyBill)}
                {renderField("Message", lead.message)}
                {renderField("Source IP", lead.sourceIp)}
                {renderField("reCAPTCHA Score", lead.recaptchaScore)}
                {renderField("Consent Given", lead.consentGiven)}
                {renderField(
                  "Consent Timestamp",
                  lead.consentTimestamp ? new Date(lead.consentTimestamp).toLocaleString() : null
                )}
                {renderField("Consent IP Address", lead.consentIpAddress)}
                {renderField("Email Opt-Out", lead.emailOptOut)}
                {renderField("WhatsApp Opt-Out", lead.whatsappOptOut)}
                {renderField("SMS DND", lead.smsDndStatus)}
                {renderField(
                  "Opt-Out Timestamp",
                  lead.optOutTimestamp ? new Date(lead.optOutTimestamp).toLocaleString() : null
                )}
                {renderField("Opt-Out Source", lead.optOutSource)}
              </div>
            </div>
            <div className="space-y-3 rounded-md border border-slate-200 p-3">
              <h3 className="text-sm font-semibold">UTM Attribution</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                {renderField("utm_source", lead.utmSource)}
                {renderField("utm_medium", lead.utmMedium)}
                {renderField("utm_campaign", lead.utmCampaign)}
                {renderField("utm_term", lead.utmTerm)}
                {renderField("utm_content", lead.utmContent)}
              </div>
            </div>
          </div>
        ) : null}

        {activeTab === "timeline" ? (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-100 text-left text-xs uppercase text-slate-600">
                <tr>
                  <th className="px-3 py-2">When</th>
                  <th className="px-3 py-2">From</th>
                  <th className="px-3 py-2">To</th>
                  <th className="px-3 py-2">By</th>
                  <th className="px-3 py-2">Notes</th>
                </tr>
              </thead>
              <tbody>
                {(lead.statusHistory ?? []).map((item) => (
                  <tr key={item.id} className="border-t border-slate-100">
                    <td className="px-3 py-2">{new Date(item.createdAt).toLocaleString()}</td>
                    <td className="px-3 py-2">{item.fromStatus?.name ?? "-"}</td>
                    <td className="px-3 py-2">{item.toStatus?.name ?? "-"}</td>
                    <td className="px-3 py-2">{item.changedByUser?.fullName ?? "-"}</td>
                    <td className="px-3 py-2">{item.notes ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {activeTab === "customer" ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {renderField("Full Name", lead.customerDetail?.fullName ?? lead.name)}
            {renderField(
              "Date of Birth",
              lead.customerDetail?.dateOfBirth
                ? new Date(lead.customerDetail.dateOfBirth).toLocaleDateString()
                : null
            )}
            {renderField("Gender", lead.customerDetail?.gender)}
            {renderField("Father/Husband Name", lead.customerDetail?.fatherHusbandName)}
            {renderField("Alternate Phone", lead.customerDetail?.alternatePhone)}
            {renderField("Address Line 1", lead.customerDetail?.addressLine1)}
            {renderField("Address Line 2", lead.customerDetail?.addressLine2)}
            {renderField("Village/Locality", lead.customerDetail?.villageLocality)}
            {renderField("Pincode", lead.customerDetail?.pincode)}
            {renderField("Property Ownership", lead.customerDetail?.propertyOwnership)}
            {renderField("Roof Area", lead.customerDetail?.roofArea)}
            {renderField("Recommended Capacity", lead.customerDetail?.recommendedCapacity)}
            {renderField("Shadow Free Area", lead.customerDetail?.shadowFreeArea)}
            {renderField("Roof Type", lead.customerDetail?.roofType)}
            {renderField("Verified Monthly Bill", lead.customerDetail?.verifiedMonthlyBill)}
            {renderField("Connection Type", lead.customerDetail?.connectionType)}
            {renderField("Consumer Number", lead.customerDetail?.consumerNumber)}
            {renderField("DISCOM Name", lead.customerDetail?.discomName)}
            {renderField("Bank Name", lead.customerDetail?.bankName)}
            {renderField("IFSC", lead.customerDetail?.ifscCode)}
            {renderField("Account Holder", lead.customerDetail?.accountHolderName)}
            {renderField("Loan Required", lead.customerDetail?.loanRequired)}
            {renderField("Loan Amount Required", lead.customerDetail?.loanAmountRequired)}
            {renderField("Preferred Lender", lead.customerDetail?.preferredLender)}
          </div>
        ) : null}

        {activeTab === "documents" ? (
          <div className="mt-4 space-y-4">
            {canWebUploadDocument ? (
              <div className="rounded-md border border-slate-200 p-3">
                <h3 className="text-sm font-semibold">Upload Document</h3>
                <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <input
                    value={uploadCategory}
                    onChange={(event) => setUploadCategory(event.target.value)}
                    placeholder="Category (e.g. aadhaar, pan, bill)"
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                  <input
                    key={uploadInputKey}
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png"
                    onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)}
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                  <button
                    onClick={() => void uploadLeadDocument()}
                    disabled={uploadSubmitting || !uploadFile}
                    className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
                  >
                    {uploadSubmitting ? "Uploading..." : "Upload Document"}
                  </button>
                </div>
                {uploadMessage ? (
                  <p
                    className={`mt-2 text-sm ${
                      uploadMessage.type === "success" ? "text-emerald-700" : "text-rose-700"
                    }`}
                  >
                    {uploadMessage.text}
                  </p>
                ) : null}
              </div>
            ) : null}
            <div className="rounded-md border border-slate-200 px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-slate-600">
                  Showing {showDocumentHistory ? "latest + previous" : "latest"} document versions.
                </p>
                {canViewDocumentHistory ? (
                  <button
                    onClick={() => setShowDocumentHistory((current) => !current)}
                    className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50"
                  >
                    {showDocumentHistory ? "Hide Previous Versions" : "Show Previous Versions"}
                  </button>
                ) : null}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-100 text-left text-xs uppercase text-slate-600">
                  <tr>
                    <th className="px-3 py-2">Document</th>
                    <th className="px-3 py-2">Category</th>
                    <th className="px-3 py-2">Review</th>
                    <th className="px-3 py-2">Uploaded By</th>
                    <th className="px-3 py-2">Created</th>
                    <th className="px-3 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleDocuments.length === 0 ? (
                    <tr className="border-t border-slate-100">
                      <td className="px-3 py-3 text-slate-500" colSpan={6}>
                        No documents found for the selected view.
                      </td>
                    </tr>
                  ) : (
                    visibleDocuments.map((document) => (
                      <tr key={document.id} className="border-t border-slate-100">
                        <td className="px-3 py-2">
                          <p className="font-medium">{document.fileName}</p>
                          <p className="text-xs text-slate-500">
                            v{document.version}
                            {document.isLatest ? " (latest)" : ""}
                            {" • "}
                            {document.fileType}
                            {" • "}
                            {(document.fileSize / 1024).toFixed(1)} KB
                          </p>
                        </td>
                        <td className="px-3 py-2">{document.category}</td>
                        <td className="px-3 py-2">
                          <p>{document.reviewStatus}</p>
                          <p className="text-xs text-slate-500">{document.reviewNotes ?? "-"}</p>
                        </td>
                        <td className="px-3 py-2">{document.uploadedByUser?.fullName ?? "-"}</td>
                        <td className="px-3 py-2">
                          {new Date(document.createdAt).toLocaleString()}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-2">
                            <button
                              onClick={() => void handlePreview(document.id)}
                              disabled={previewLoadingDocId === document.id}
                              className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-60"
                            >
                              {previewLoadingDocId === document.id ? "Loading..." : "Preview"}
                            </button>
                            <button
                              onClick={() => void handleDownload(document.id)}
                              disabled={previewLoadingDocId === document.id}
                              className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-60"
                            >
                              Download
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {previewUrl ? (
              <div className="rounded-md border border-slate-200 p-3">
                <p className="mb-2 text-sm font-medium">Preview: {previewName ?? "Document"}</p>
                {previewType?.startsWith("image/") ? (
                  <Image
                    src={previewUrl}
                    alt={previewName ?? "Document preview"}
                    width={1200}
                    height={800}
                    unoptimized
                    className="max-h-[420px] w-full max-w-full rounded-md border border-slate-200 object-contain"
                  />
                ) : (
                  <iframe
                    src={previewUrl}
                    title={previewName ?? "Document preview"}
                    className="h-[360px] w-full rounded-md border border-slate-200 sm:h-[460px]"
                  />
                )}
              </div>
            ) : null}
          </div>
        ) : null}

        {activeTab === "payments" ? (
          <div className="mt-4 space-y-4">
            <div className="rounded-md border border-slate-200 p-3">
              <h3 className="text-sm font-semibold">Create QR-UTR Payment</h3>
              {canSubmitQrUtr ? (
                <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={paymentAmount}
                    onChange={(event) => setPaymentAmount(event.target.value)}
                    placeholder="Amount"
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                  <input
                    value={paymentUtrNumber}
                    onChange={(event) => setPaymentUtrNumber(event.target.value)}
                    placeholder="UTR Number"
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                  <button
                    onClick={() => void submitQrUtrPayment()}
                    disabled={paymentSubmitting}
                    className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
                  >
                    {paymentSubmitting ? "Creating..." : "Create Pending Payment"}
                  </button>
                </div>
              ) : (
                <p className="mt-3 text-sm text-slate-600">
                  QR-UTR submission is allowed only for assigned field executives via mobile app.
                </p>
              )}
              {paymentMessage ? (
                <p
                  className={`mt-2 text-sm ${
                    paymentMessage.type === "success" ? "text-emerald-700" : "text-rose-700"
                  }`}
                >
                  {paymentMessage.text}
                </p>
              ) : null}
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-100 text-left text-xs uppercase text-slate-600">
                  <tr>
                    <th className="px-3 py-2">Amount</th>
                    <th className="px-3 py-2">Method</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Gateway / Token</th>
                    <th className="px-3 py-2">UTR</th>
                    <th className="px-3 py-2">Verified</th>
                    <th className="px-3 py-2">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {(lead.payments ?? []).map((payment) => (
                    <tr key={payment.id} className="border-t border-slate-100">
                      <td className="px-3 py-2">{payment.amount}</td>
                      <td className="px-3 py-2">{payment.method}</td>
                      <td className="px-3 py-2">{payment.status}</td>
                      <td className="px-3 py-2">
                        <p className="text-xs">order: {payment.gatewayOrderId ?? "-"}</p>
                        <p className="text-xs">payment: {payment.gatewayPaymentId ?? "-"}</p>
                      </td>
                      <td className="px-3 py-2">{payment.utrNumber ?? "-"}</td>
                      <td className="px-3 py-2">
                        {payment.verifiedAt ? new Date(payment.verifiedAt).toLocaleString() : "-"}
                      </td>
                      <td className="px-3 py-2">{new Date(payment.createdAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {activeTab === "loan" ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {renderField("Lender Name", lead.loanDetails?.lenderName)}
            {renderField("Application Number", lead.loanDetails?.applicationNumber)}
            {renderField("Application Status", lead.loanDetails?.applicationStatus)}
            {renderField("Applied Amount", lead.loanDetails?.appliedAmount)}
            {renderField("Approved Amount", lead.loanDetails?.approvedAmount)}
            {renderField(
              "Applied At",
              lead.loanDetails?.appliedAt
                ? new Date(lead.loanDetails.appliedAt).toLocaleString()
                : null
            )}
            {renderField(
              "Approved At",
              lead.loanDetails?.approvedAt
                ? new Date(lead.loanDetails.approvedAt).toLocaleString()
                : null
            )}
            {renderField(
              "Disbursed At",
              lead.loanDetails?.disbursedAt
                ? new Date(lead.loanDetails.disbursedAt).toLocaleString()
                : null
            )}
            {renderField("Rejection Reason", lead.loanDetails?.rejectionReason)}
            {renderField("Notes", lead.loanDetails?.notes)}
          </div>
        ) : null}

        {activeTab === "communications" ? (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-100 text-left text-xs uppercase text-slate-600">
                <tr>
                  <th className="px-3 py-2">When</th>
                  <th className="px-3 py-2">Channel</th>
                  <th className="px-3 py-2">Template</th>
                  <th className="px-3 py-2">Recipient</th>
                  <th className="px-3 py-2">Delivery</th>
                  <th className="px-3 py-2">Attempts</th>
                  <th className="px-3 py-2">Content</th>
                </tr>
              </thead>
              <tbody>
                {(lead.notificationLogs ?? []).map((log) => (
                  <tr key={log.id} className="border-t border-slate-100">
                    <td className="px-3 py-2">{new Date(log.createdAt).toLocaleString()}</td>
                    <td className="px-3 py-2">{log.channel}</td>
                    <td className="px-3 py-2">{log.template?.name ?? "-"}</td>
                    <td className="px-3 py-2">{log.recipient}</td>
                    <td className="px-3 py-2">{log.deliveryStatus}</td>
                    <td className="px-3 py-2">{log.attempts}</td>
                    <td className="px-3 py-2 max-w-[320px] whitespace-pre-wrap break-words text-xs">
                      {log.contentSent}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {activeTab === "notes" ? (
          <div className="mt-4 space-y-4">
            {canViewInternalNotes ? (
              <div className="rounded-md border border-slate-200 p-3">
                <h3 className="text-sm font-semibold">Add Internal Note</h3>
                <textarea
                  value={internalNoteDraft}
                  onChange={(event) => setInternalNoteDraft(event.target.value)}
                  rows={4}
                  placeholder="Add internal note (visible to admin and district manager roles only)"
                  className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => void addInternalNote()}
                    disabled={noteSubmitting}
                    className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
                  >
                    {noteSubmitting ? "Saving..." : "Save Note"}
                  </button>
                  {noteMessage ? (
                    <p
                      className={`text-sm ${
                        noteMessage.type === "success" ? "text-emerald-700" : "text-rose-700"
                      }`}
                    >
                      {noteMessage.text}
                    </p>
                  ) : null}
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-500">You do not have access to internal notes.</p>
            )}

            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-100 text-left text-xs uppercase text-slate-600">
                  <tr>
                    <th className="px-3 py-2">When</th>
                    <th className="px-3 py-2">By</th>
                    <th className="px-3 py-2">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {(lead.internalNotes ?? []).length === 0 ? (
                    <tr>
                      <td className="px-3 py-3 text-slate-500" colSpan={3}>
                        No internal notes yet.
                      </td>
                    </tr>
                  ) : (
                    (lead.internalNotes ?? []).map((note) => (
                      <tr key={note.id} className="border-t border-slate-100">
                        <td className="px-3 py-2">{new Date(note.createdAt).toLocaleString()}</td>
                        <td className="px-3 py-2">
                          {note.actor?.fullName ?? "-"}
                          <p className="text-xs text-slate-500">{note.actor?.email ?? ""}</p>
                        </td>
                        <td className="px-3 py-2 whitespace-pre-wrap break-words">{note.note}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {activeTab === "activity" ? (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-100 text-left text-xs uppercase text-slate-600">
                <tr>
                  <th className="px-3 py-2">When</th>
                  <th className="px-3 py-2">Action</th>
                  <th className="px-3 py-2">Actor</th>
                  <th className="px-3 py-2">Entity</th>
                  <th className="px-3 py-2">Details</th>
                </tr>
              </thead>
              <tbody>
                {(lead.activityLog ?? []).length === 0 ? (
                  <tr>
                    <td className="px-3 py-3 text-slate-500" colSpan={5}>
                      No activity logs available.
                    </td>
                  </tr>
                ) : (
                  (lead.activityLog ?? []).map((entry) => (
                    <tr key={entry.id} className="border-t border-slate-100 align-top">
                      <td className="px-3 py-2">{new Date(entry.createdAt).toLocaleString()}</td>
                      <td className="px-3 py-2">{entry.action}</td>
                      <td className="px-3 py-2">
                        {entry.actor?.fullName ?? "-"}
                        <p className="text-xs text-slate-500">{entry.actor?.email ?? ""}</p>
                      </td>
                      <td className="px-3 py-2">
                        <p>{entry.entityType}</p>
                        <p className="text-xs text-slate-500">{entry.entityId ?? "-"}</p>
                      </td>
                      <td className="px-3 py-2 max-w-[420px] whitespace-pre-wrap break-words text-xs">
                        {entry.details ? JSON.stringify(entry.details, null, 2) : "-"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </div>
  );
}
