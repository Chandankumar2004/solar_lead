"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";

type ReviewStatus = "PENDING" | "VERIFIED" | "REJECTED";

type ReviewDocument = {
  id: string;
  leadId: string;
  category: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  version: number;
  isLatest: boolean;
  reviewStatus: ReviewStatus;
  reviewNotes?: string | null;
  reviewedAt?: string | null;
  createdAt: string;
  lead: {
    id: string;
    externalId: string;
    name: string;
    phone: string;
    district?: { id: string; name: string; state: string } | null;
    assignedExecutive?: { id: string; fullName: string; email: string } | null;
  };
  uploadedByUser?: { id: string; fullName: string; email: string } | null;
  reviewedByUser?: { id: string; fullName: string; email: string } | null;
};

type Pagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

type DocumentsEnvelope = {
  data: ReviewDocument[];
  pagination: Pagination | null;
};

type District = {
  id: string;
  name: string;
  state: string;
};

type DistrictEnvelope = {
  data?: {
    districts?: District[];
  };
};

type DashboardSummaryEnvelope = {
  data?: {
    fieldExecutivePerformance?: Array<{
      executiveId: string;
      fullName: string;
    }>;
  };
};

const fetcher = (url: string) => api.get(url).then((response) => response.data);

function extractApiMessage(error: unknown) {
  const maybe = error as { response?: { data?: { message?: string } } };
  return maybe.response?.data?.message ?? "Operation failed";
}

function inferMimeType(fileName: string, fileType?: string) {
  if (fileType && fileType !== "application/octet-stream") {
    return fileType;
  }

  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".heic")) return "image/heic";
  if (lower.endsWith(".heif")) return "image/heif";
  return "image/jpeg";
}

const STATUS_OPTIONS: Array<{ value: ReviewStatus; label: string }> = [
  { value: "PENDING", label: "Pending" },
  { value: "VERIFIED", label: "Verified" },
  { value: "REJECTED", label: "Rejected" }
];

export default function DocumentsReviewPage() {
  const user = useAuthStore((state) => state.user);
  const canUploadDocuments = user?.role === "SUPER_ADMIN" || user?.role === "ADMIN";
  const [status, setStatus] = useState<ReviewStatus>("PENDING");
  const [search, setSearch] = useState("");
  const [districtId, setDistrictId] = useState("");
  const [executiveId, setExecutiveId] = useState("");
  const [category, setCategory] = useState("");
  const [uploadLeadId, setUploadLeadId] = useState("");
  const [uploadCategory, setUploadCategory] = useState("general");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadSubmitting, setUploadSubmitting] = useState(false);
  const [uploadInputKey, setUploadInputKey] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [reviewNotes, setReviewNotes] = useState("");
  const [actionLoading, setActionLoading] = useState<"verify" | "reject" | null>(null);
  const [actionMessage, setActionMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [uploadMessage, setUploadMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("pageSize", String(pageSize));
    params.set("status", status);
    if (search.trim()) params.set("search", search.trim());
    if (districtId) params.set("districtId", districtId);
    if (executiveId) params.set("executiveId", executiveId);
    if (category.trim()) params.set("category", category.trim());
    return `/api/documents/review?${params.toString()}`;
  }, [category, districtId, executiveId, page, pageSize, search, status]);

  const { data, isLoading, mutate } = useSWR(query, fetcher);
  const { data: districtsData } = useSWR("/public/districts", fetcher);
  const { data: dashboardSummary } = useSWR("/api/dashboard/summary", fetcher);

  const envelope = data as DocumentsEnvelope | undefined;
  const documents = useMemo(() => envelope?.data ?? [], [envelope?.data]);
  const pagination = envelope?.pagination;

  const districts = ((districtsData as DistrictEnvelope | undefined)?.data?.districts ??
    []) as District[];
  const executiveOptions = (
    (dashboardSummary as DashboardSummaryEnvelope | undefined)?.data?.fieldExecutivePerformance ??
    []
  ).map((item) => ({
    id: item.executiveId,
    name: item.fullName
  }));

  useEffect(() => {
    if (!documents.length) {
      setSelectedDocumentId(null);
      setPreviewUrl(null);
      return;
    }
    if (!selectedDocumentId || !documents.some((document) => document.id === selectedDocumentId)) {
      setSelectedDocumentId(documents[0].id);
      setReviewNotes("");
    }
  }, [documents, selectedDocumentId]);

  const selectedDocument =
    documents.find((document) => document.id === selectedDocumentId) ?? null;

  useEffect(() => {
    if (!selectedDocument) {
      setPreviewUrl(null);
      setPreviewError(null);
      return;
    }

    let active = true;
    setPreviewLoading(true);
    setPreviewError(null);

    api
      .get(`/api/documents/${selectedDocument.id}/download-url`)
      .then((response) => {
        if (!active) return;
        const url = response.data?.data?.downloadUrl as string | undefined;
        if (!url) {
          setPreviewError("Unable to generate preview URL");
          setPreviewUrl(null);
          return;
        }
        setPreviewUrl(url);
      })
      .catch((error) => {
        if (!active) return;
        setPreviewError(extractApiMessage(error));
        setPreviewUrl(null);
      })
      .finally(() => {
        if (!active) return;
        setPreviewLoading(false);
      });

    return () => {
      active = false;
    };
  }, [selectedDocument]);

  const onDownload = async (documentId: string) => {
    try {
      const response = await api.get(`/api/documents/${documentId}/download-url`);
      const url = response.data?.data?.downloadUrl as string | undefined;
      if (!url) {
        setActionMessage({ type: "error", text: "Unable to generate download URL" });
        return;
      }
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) {
      setActionMessage({ type: "error", text: extractApiMessage(error) });
    }
  };

  const submitReviewAction = async (action: "verify" | "reject") => {
    if (!selectedDocument) return;
    if (action === "reject" && reviewNotes.trim().length < 5) {
      setActionMessage({
        type: "error",
        text: "Rejection notes are required (minimum 5 characters)."
      });
      return;
    }

    setActionMessage(null);
    setActionLoading(action);
    try {
      await api.post(`/api/documents/${selectedDocument.id}/review`, {
        action,
        notes: reviewNotes.trim().length ? reviewNotes.trim() : null
      });
      setActionMessage({
        type: "success",
        text: action === "verify" ? "Document verified." : "Document rejected."
      });
      setReviewNotes("");
      await mutate();
    } catch (error) {
      setActionMessage({ type: "error", text: extractApiMessage(error) });
    } finally {
      setActionLoading(null);
    }
  };

  const submitUpload = async () => {
    if (!canUploadDocuments) return;
    const leadId = uploadLeadId.trim();
    const categoryValue = uploadCategory.trim().length >= 2 ? uploadCategory.trim() : "general";

    if (!leadId) {
      setUploadMessage({ type: "error", text: "Lead ID is required." });
      return;
    }
    if (!uploadFile) {
      setUploadMessage({ type: "error", text: "Please select a file." });
      return;
    }

    const fileType = inferMimeType(uploadFile.name, uploadFile.type);
    setUploadSubmitting(true);
    setUploadMessage(null);
    try {
      const presignResponse = await api.post(`/api/leads/${leadId}/documents/presign`, {
        category: categoryValue,
        fileName: uploadFile.name,
        fileType,
        fileSize: uploadFile.size
      });

      const uploadUrl = presignResponse.data?.data?.uploadUrl as string | undefined;
      const s3Key = presignResponse.data?.data?.s3Key as string | undefined;
      if (!uploadUrl || !s3Key) {
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

      await api.post(`/api/leads/${leadId}/documents/complete`, {
        category: categoryValue,
        s3Key,
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

  const renderPreview = () => {
    if (!selectedDocument) {
      return <p className="text-sm text-slate-500">Select a document to preview.</p>;
    }
    if (previewLoading) {
      return <p className="text-sm text-slate-500">Loading preview...</p>;
    }
    if (previewError) {
      return <p className="text-sm text-rose-600">{previewError}</p>;
    }
    if (!previewUrl) {
      return <p className="text-sm text-slate-500">Preview unavailable.</p>;
    }
    if (selectedDocument.fileType === "application/pdf") {
      return <iframe title="Document preview" src={previewUrl} className="h-[520px] w-full rounded border border-slate-200" />;
    }
    if (selectedDocument.fileType.startsWith("image/")) {
      return <iframe title="Image preview" src={previewUrl} className="h-[520px] w-full rounded border border-slate-200" />;
    }
    return (
      <div className="rounded border border-slate-200 p-4 text-sm text-slate-600">
        Preview is not supported for this file type.
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {canUploadDocuments ? (
        <section className="rounded-xl bg-white p-4 shadow-sm">
          <h2 className="text-base font-semibold">Upload Document</h2>
          <div className="mt-3 grid gap-3 lg:grid-cols-4">
            <input
              value={uploadLeadId}
              onChange={(event) => setUploadLeadId(event.target.value)}
              placeholder="Lead ID (UUID)"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
            <input
              value={uploadCategory}
              onChange={(event) => setUploadCategory(event.target.value)}
              placeholder="Category (e.g. aadhaar)"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
            <input
              key={uploadInputKey}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif"
              onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
            <button
              onClick={() => void submitUpload()}
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
        </section>
      ) : null}

      <section className="rounded-xl bg-white p-4 shadow-sm">
        <h2 className="text-base font-semibold">Documents Review Queue</h2>
        <div className="mt-3 grid gap-3 lg:grid-cols-5">
          <select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as ReviewStatus);
              setPage(1);
            }}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            {STATUS_OPTIONS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
          <input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Search lead / file"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
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
          <select
            value={executiveId}
            onChange={(event) => {
              setExecutiveId(event.target.value);
              setPage(1);
            }}
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
            value={category}
            onChange={(event) => {
              setCategory(event.target.value);
              setPage(1);
            }}
            placeholder="Category"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
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

      <section className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
        <div className="overflow-hidden rounded-xl bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-100 text-left text-xs uppercase text-slate-600">
                <tr>
                  <th className="px-4 py-3">Lead</th>
                  <th className="px-4 py-3">Document</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3">Uploaded</th>
                  <th className="px-4 py-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td className="px-4 py-4 text-slate-500" colSpan={5}>
                      Loading documents...
                    </td>
                  </tr>
                ) : documents.length === 0 ? (
                  <tr>
                    <td className="px-4 py-4 text-slate-500" colSpan={5}>
                      No documents found.
                    </td>
                  </tr>
                ) : (
                  documents.map((document) => {
                    const selected = selectedDocumentId === document.id;
                    return (
                      <tr
                        key={document.id}
                        className={`border-t border-slate-100 align-top ${selected ? "bg-brand-50/30" : ""}`}
                      >
                        <td className="px-4 py-3">
                          <button
                            onClick={() => {
                              setSelectedDocumentId(document.id);
                              setReviewNotes(document.reviewNotes ?? "");
                            }}
                            className="text-left"
                          >
                            <p className="font-medium text-brand-700 hover:underline">{document.lead.name}</p>
                            <p className="text-xs text-slate-500">{document.lead.externalId}</p>
                          </button>
                          <p className="text-xs text-slate-500">{document.lead.phone}</p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-medium">{document.fileName}</p>
                          <p className="text-xs text-slate-500">
                            v{document.version} • {document.fileType}
                          </p>
                        </td>
                        <td className="px-4 py-3">{document.category}</td>
                        <td className="px-4 py-3">
                          <p>{new Date(document.createdAt).toLocaleDateString()}</p>
                          <p className="text-xs text-slate-500">
                            {document.uploadedByUser?.fullName ?? "-"}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <div className="space-y-1">
                            <button
                              onClick={() => {
                                setSelectedDocumentId(document.id);
                                setReviewNotes(document.reviewNotes ?? "");
                              }}
                              className="block rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50"
                            >
                              Preview
                            </button>
                            <button
                              onClick={() => void onDownload(document.id)}
                              className="block rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50"
                            >
                              Download
                            </button>
                            <Link
                              href={`/leads/${document.lead.id}`}
                              className="block rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50"
                            >
                              Open Lead
                            </Link>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        <aside className="space-y-3 rounded-xl bg-white p-4 shadow-sm">
          <h3 className="text-base font-semibold">Review Panel</h3>
          {selectedDocument ? (
            <div className="space-y-3">
              <div className="rounded-md border border-slate-200 p-3 text-sm">
                <p className="font-medium">{selectedDocument.fileName}</p>
                <p className="text-xs text-slate-500">
                  Lead: {selectedDocument.lead.externalId} • {selectedDocument.lead.name}
                </p>
                <p className="text-xs text-slate-500">
                  Category: {selectedDocument.category} • Version: {selectedDocument.version}
                </p>
              </div>
              {renderPreview()}
              <textarea
                value={reviewNotes}
                onChange={(event) => setReviewNotes(event.target.value)}
                placeholder="Review notes (required for rejection)"
                className="min-h-28 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
              <div className="flex items-center gap-2">
                <button
                  onClick={() => void submitReviewAction("verify")}
                  disabled={actionLoading !== null}
                  className="rounded-md border border-emerald-300 px-3 py-2 text-sm font-medium text-emerald-700 disabled:opacity-50"
                >
                  {actionLoading === "verify" ? "Verifying..." : "Verify"}
                </button>
                <button
                  onClick={() => void submitReviewAction("reject")}
                  disabled={actionLoading !== null}
                  className="rounded-md border border-rose-300 px-3 py-2 text-sm font-medium text-rose-700 disabled:opacity-50"
                >
                  {actionLoading === "reject" ? "Rejecting..." : "Reject"}
                </button>
                <button
                  onClick={() => void onDownload(selectedDocument.id)}
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                >
                  Download
                </button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-500">Select a document from the queue.</p>
          )}
        </aside>
      </section>

      <section className="flex items-center justify-between rounded-xl bg-white px-4 py-3 shadow-sm">
        <div className="flex items-center gap-3">
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
        <div className="flex items-center gap-2">
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
      </section>
    </div>
  );
}
