"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { api } from "@/lib/api";

type PaymentStatus = "PENDING" | "VERIFIED" | "REJECTED";
type PaymentMethod = "QR_UTR" | "UPI_GATEWAY";

type QueuePayment = {
  id: string;
  leadId: string;
  amount: string | number;
  method: PaymentMethod;
  status: PaymentStatus;
  utrNumber?: string | null;
  rejectionReason?: string | null;
  createdAt: string;
  verifiedAt?: string | null;
  lead: {
    id: string;
    externalId: string;
    name: string;
    phone: string;
    district?: { id: string; name: string; state: string } | null;
    currentStatus?: { id: string; name: string } | null;
    assignedExecutive?: { id: string; fullName: string; email: string } | null;
  };
  collectedByUser?: { id: string; fullName: string; email: string } | null;
  verifiedByUser?: { id: string; fullName: string; email: string } | null;
};

type Pagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

type QueueEnvelope = {
  data: QueuePayment[];
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

function formatAmount(value: string | number) {
  const amount = Number(value);
  if (Number.isNaN(amount)) return String(value);
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2
  }).format(amount);
}

export default function PaymentsVerificationPage() {
  const [status, setStatus] = useState<PaymentStatus>("PENDING");
  const [search, setSearch] = useState("");
  const [districtId, setDistrictId] = useState("");
  const [executiveId, setExecutiveId] = useState("");
  const [method, setMethod] = useState<PaymentMethod | "">("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [selectedPaymentId, setSelectedPaymentId] = useState<string | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [actionLoading, setActionLoading] = useState<"verify" | "reject" | null>(null);
  const [actionMessage, setActionMessage] = useState<{
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
    if (method) params.set("method", method);
    return `/api/payments/verification-queue?${params.toString()}`;
  }, [districtId, executiveId, method, page, pageSize, search, status]);

  const { data, isLoading, mutate } = useSWR(query, fetcher);
  const { data: districtsData } = useSWR("/public/districts", fetcher);
  const { data: dashboardSummary } = useSWR("/api/dashboard/summary", fetcher);

  const envelope = data as QueueEnvelope | undefined;
  const payments = useMemo(() => envelope?.data ?? [], [envelope?.data]);
  const pagination = envelope?.pagination;

  const districts = ((districtsData as DistrictEnvelope | undefined)?.data?.districts ??
    []) as District[];
  const executives = (
    (dashboardSummary as DashboardSummaryEnvelope | undefined)?.data?.fieldExecutivePerformance ??
    []
  ).map((item) => ({
    id: item.executiveId,
    name: item.fullName
  }));

  useEffect(() => {
    if (!payments.length) {
      setSelectedPaymentId(null);
      return;
    }
    if (!selectedPaymentId || !payments.some((payment) => payment.id === selectedPaymentId)) {
      setSelectedPaymentId(payments[0].id);
      setReviewNote("");
    }
  }, [payments, selectedPaymentId]);

  const selectedPayment = payments.find((payment) => payment.id === selectedPaymentId) ?? null;

  const submitAction = async (action: "verify" | "reject") => {
    if (!selectedPayment) return;
    if (selectedPayment.method !== "QR_UTR") {
      setActionMessage({
        type: "error",
        text: "UPI gateway payments are verified automatically via webhook and cannot be reviewed manually."
      });
      return;
    }
    if (reviewNote.trim().length < 3) {
      setActionMessage({
        type: "error",
        text: "Review note is required (minimum 3 characters)."
      });
      return;
    }
    if (action === "reject" && reviewNote.trim().length < 5) {
      setActionMessage({
        type: "error",
        text: "Rejection note is required (minimum 5 characters)."
      });
      return;
    }

    setActionLoading(action);
    setActionMessage(null);
    try {
      await api.post(`/api/payments/${selectedPayment.id}/review`, {
        action,
        note: reviewNote.trim() ? reviewNote.trim() : null
      });
      setActionMessage({
        type: "success",
        text: action === "verify" ? "Payment verified." : "Payment rejected."
      });
      setReviewNote("");
      await mutate();
    } catch (error) {
      setActionMessage({
        type: "error",
        text: extractApiMessage(error)
      });
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="min-w-0 space-y-4">
      <section className="rounded-xl bg-white p-3 shadow-sm sm:p-4">
        <h2 className="text-base font-semibold">Payments Verification Queue</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as PaymentStatus);
              setPage(1);
            }}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="PENDING">Pending</option>
            <option value="VERIFIED">Verified</option>
            <option value="REJECTED">Rejected</option>
          </select>
          <input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Search lead / UTR"
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
            {executives.map((executive) => (
              <option key={executive.id} value={executive.id}>
                {executive.name}
              </option>
            ))}
          </select>
          <select
            value={method}
            onChange={(event) => {
              setMethod(event.target.value as PaymentMethod | "");
              setPage(1);
            }}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">All methods</option>
            <option value="QR_UTR">QR UTR</option>
            <option value="UPI_GATEWAY">UPI Gateway</option>
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

      <section className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
        <div className="overflow-hidden rounded-xl bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-100 text-left text-xs uppercase text-slate-600">
                <tr>
                  <th className="px-4 py-3">Lead</th>
                  <th className="px-4 py-3">Amount</th>
                  <th className="px-4 py-3">Method</th>
                  <th className="px-4 py-3">UTR</th>
                  <th className="px-4 py-3">Field Executive</th>
                  <th className="px-4 py-3">Created</th>
                  <th className="px-4 py-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td className="px-4 py-4 text-slate-500" colSpan={7}>
                      Loading payments...
                    </td>
                  </tr>
                ) : payments.length === 0 ? (
                  <tr>
                    <td className="px-4 py-4 text-slate-500" colSpan={7}>
                      No payments found.
                    </td>
                  </tr>
                ) : (
                  payments.map((payment) => {
                    const selected = payment.id === selectedPaymentId;
                    return (
                      <tr
                        key={payment.id}
                        className={`border-t border-slate-100 align-top ${selected ? "bg-brand-50/30" : ""}`}
                      >
                        <td className="px-4 py-3">
                          <button
                            onClick={() => {
                              setSelectedPaymentId(payment.id);
                              setReviewNote(payment.rejectionReason ?? "");
                            }}
                            className="text-left"
                          >
                            <p className="font-medium text-brand-700 hover:underline">{payment.lead.name}</p>
                            <p className="text-xs text-slate-500">{payment.lead.externalId}</p>
                          </button>
                          <p className="text-xs text-slate-500">{payment.lead.phone}</p>
                        </td>
                        <td className="px-4 py-3">{formatAmount(payment.amount)}</td>
                        <td className="px-4 py-3">{payment.method}</td>
                        <td className="px-4 py-3">{payment.utrNumber ?? "-"}</td>
                        <td className="px-4 py-3">
                          {payment.collectedByUser?.fullName ??
                            payment.lead.assignedExecutive?.fullName ??
                            "-"}
                        </td>
                        <td className="px-4 py-3">{new Date(payment.createdAt).toLocaleString()}</td>
                        <td className="px-4 py-3">
                          <div className="space-y-1">
                            <button
                              onClick={() => {
                                setSelectedPaymentId(payment.id);
                                setReviewNote(payment.rejectionReason ?? "");
                              }}
                              className="block rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50"
                            >
                              Review
                            </button>
                            <Link
                              href={`/leads/${payment.lead.id}`}
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
          {selectedPayment ? (
            <div className="space-y-3">
              <div className="rounded-md border border-slate-200 p-3 text-sm">
                <p className="font-medium">{selectedPayment.lead.name}</p>
                <p className="text-xs text-slate-500">
                  Lead: {selectedPayment.lead.externalId} • {selectedPayment.lead.currentStatus?.name ?? "-"}
                </p>
                <p className="text-xs text-slate-500">
                  Amount: {formatAmount(selectedPayment.amount)} • Method: {selectedPayment.method}
                </p>
                <p className="text-xs text-slate-500">UTR: {selectedPayment.utrNumber ?? "-"}</p>
                <p className="text-xs text-slate-500">
                  Collected by: {selectedPayment.collectedByUser?.fullName ?? "-"}
                </p>
                <p className="text-xs text-slate-500">Status: {selectedPayment.status}</p>
                {selectedPayment.method !== "QR_UTR" ? (
                  <p className="mt-1 text-xs text-amber-700">
                    Manual review disabled for gateway payments; status is webhook-driven.
                  </p>
                ) : null}
              </div>
              <textarea
                value={reviewNote}
                onChange={(event) => setReviewNote(event.target.value)}
                placeholder="Review note (required for verify/reject)"
                className="min-h-28 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                disabled={selectedPayment.method !== "QR_UTR"}
              />
                <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => void submitAction("verify")}
                  disabled={
                    actionLoading !== null ||
                    selectedPayment.status !== "PENDING" ||
                    selectedPayment.method !== "QR_UTR"
                  }
                  className="rounded-md border border-emerald-300 px-3 py-2 text-sm font-medium text-emerald-700 disabled:opacity-50"
                >
                  {actionLoading === "verify" ? "Verifying..." : "Verify"}
                </button>
                <button
                  onClick={() => void submitAction("reject")}
                  disabled={
                    actionLoading !== null ||
                    selectedPayment.status !== "PENDING" ||
                    selectedPayment.method !== "QR_UTR"
                  }
                  className="rounded-md border border-rose-300 px-3 py-2 text-sm font-medium text-rose-700 disabled:opacity-50"
                >
                  {actionLoading === "reject" ? "Rejecting..." : "Reject"}
                </button>
                <button
                  onClick={() => void mutate()}
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                >
                  Refresh
                </button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-500">Select a payment from the queue.</p>
          )}
        </aside>
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
