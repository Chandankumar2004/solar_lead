import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  LayoutChangeEvent,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View
} from "react-native";
import NetInfo from "@react-native-community/netinfo";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { api } from "../services/api";
import { useAppPalette, useTextInputStyle } from "../ui/primitives";
import { uploadLeadDocument } from "../services/document-upload";
import type { LeadDocumentUploadFile } from "../services/document-upload";
import {
  downloadAndCacheDocument,
  getCachedDocument,
  type CachedDocument
} from "../services/document-cache";
import { useQueueStore } from "../store/queue-store";
import type { QueueItem } from "../store/queue-store";
import { useAuthStore } from "../store/auth-store";
import { readOfflineCache, writeOfflineCache } from "../services/offline-cache";

type LeadsStackParamList = {
  LeadList: undefined;
  LeadCreate: undefined;
  LeadDetail: { leadId: string };
  CustomerDetails: { leadId: string; leadName?: string };
};

type LeadDetailScreenProps = NativeStackScreenProps<
  LeadsStackParamList,
  "LeadDetail"
>;

type LeadDetail = {
  id: string;
  externalId: string;
  name: string;
  phone: string;
  email?: string | null;
  state?: string | null;
  installationType?: string | null;
  updatedAt: string;
  currentStatus: {
    id: string;
    name: string;
    isTerminal?: boolean;
    colorCode?: string | null;
  };
  district?: {
    id: string;
    name: string;
    state: string;
  } | null;
  customerDetail?: {
    fullName?: string | null;
    addressLine1?: string | null;
    addressLine2?: string | null;
    villageLocality?: string | null;
    pincode?: string | null;
    alternatePhone?: string | null;
  } | null;
  statusHistory?: Array<{
    id: string;
    createdAt: string;
    notes?: string | null;
    fromStatus?: { id: string; name: string } | null;
    toStatus: { id: string; name: string };
    changedByUser?: { id: string; fullName: string } | null;
  }>;
  payments?: PaymentItem[];
};

type WorkflowStatus = {
  id: string;
  name: string;
  isTerminal: boolean;
  colorCode?: string | null;
  requiresNote: boolean;
  requiresDocument: boolean;
};

type PaymentItem = {
  id: string;
  amount: number | string;
  method: "QR_UTR" | "UPI_GATEWAY";
  status: "PENDING" | "VERIFIED" | "REJECTED";
  utrNumber?: string | null;
  gatewayOrderId?: string | null;
  gatewayPaymentId?: string | null;
  rejectionReason?: string | null;
  createdAt: string;
  verifiedAt?: string | null;
};

type PaymentMerchantDetails = {
  registeredName?: string | null;
  cin?: string | null;
  pan?: string | null;
  tan?: string | null;
  gst?: string | null;
};

type LeadDocumentSummary = {
  id: string;
  category: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  version: number;
  isLatest: boolean;
  reviewStatus: string;
  createdAt: string;
};

type InternalNote = {
  id: string;
  note: string;
  createdAt: string;
  actor?: {
    id: string;
    fullName: string;
    email: string;
  } | null;
};

type UploadSource = "camera" | "gallery" | "document";
type UploadState = "pending" | "uploading" | "queued" | "failed" | "uploaded";

type UploadUiItem = {
  id: string;
  source: UploadSource;
  category: string;
  file: LeadDocumentUploadFile;
  state: UploadState;
  progress: number;
  error?: string;
};

type CachedLeadDetailPayload = {
  lead: LeadDetail;
  nextStatuses: WorkflowStatus[];
  documents: LeadDocumentSummary[];
  merchantDetails: PaymentMerchantDetails | null;
  internalNotes: InternalNote[];
};

const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;
const SITE_PHOTO_MAX = 10;
const ALLOWED_UPLOAD_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png"
]);
type DocumentCategoryOption = {
  value: string;
  label: string;
  helper?: string;
};

const DOCUMENT_CATEGORIES: DocumentCategoryOption[] = [
  { value: "aadhaar_front", label: "Aadhaar Card Front" },
  { value: "aadhaar_back", label: "Aadhaar Card Back" },
  { value: "pan_card", label: "PAN Card" },
  { value: "electricity_bill", label: "Electricity Bill (latest)" },
  { value: "cancelled_cheque_passbook", label: "Cancelled Cheque / Passbook Front" },
  { value: "site_photo", label: "Site Photographs", helper: "Multiple photos allowed." },
  {
    value: "roof_assessment",
    label: "Roof Assessment / Site Plan (optional)",
    helper: "Optional document."
  }
];
const DEFAULT_DOCUMENT_CATEGORY = "site_photo";
const LEAD_DETAIL_CACHE_PREFIX = "lead-detail";

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "Unknown size";
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size < 10 && unitIndex > 0 ? 1 : 0)} ${units[unitIndex]}`;
}

function extractErrorMessage(error: unknown, fallback: string) {
  const value = error as {
    response?: { data?: { message?: string } };
    message?: string;
  };
  return value?.response?.data?.message || value?.message || fallback;
}

function formatInrAmount(value: number | string) {
  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(amount)) return "INR -";
  return `INR ${amount.toFixed(2)}`;
}

function getPaymentStatusColor(
  status: PaymentItem["status"],
  palette: { primary: string; danger: string; warning: string }
) {
  if (status === "VERIFIED") return palette.primary;
  if (status === "REJECTED") return palette.danger;
  return palette.warning;
}

function sanitizeUtr(value: string) {
  return value.trim().replace(/\s+/g, "").slice(0, 120);
}

function normalizeCategory(value: string) {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, "_");
  if (normalized.length >= 2) {
    return normalized.slice(0, 80);
  }
  return "general";
}

function isSitePhotoCategory(value: string) {
  return normalizeCategory(value).startsWith("site_photo");
}

function extractSitePhotoIndex(value: string) {
  const normalized = normalizeCategory(value);
  if (!normalized.startsWith("site_photo")) {
    return null;
  }
  const suffix = normalized.slice("site_photo".length);
  if (!suffix) {
    return 1;
  }
  if (suffix.startsWith("_")) {
    const numeric = Number(suffix.slice(1));
    if (Number.isFinite(numeric) && numeric > 0) {
      return numeric;
    }
  }
  return 1;
}

const CATEGORY_LABELS: Record<string, string> = {
  aadhaar_front: "Aadhaar Card Front",
  aadhaar_back: "Aadhaar Card Back",
  pan_card: "PAN Card",
  electricity_bill: "Electricity Bill (latest)",
  cancelled_cheque_passbook: "Cancelled Cheque / Passbook Front",
  site_photo: "Site Photographs",
  roof_assessment: "Roof Assessment / Site Plan",
  lead_attachment: "Lead Attachment",
  general: "General"
};

function formatCategoryLabel(value: string) {
  const normalized = normalizeCategory(value);
  if (normalized.startsWith("site_photo")) {
    const index = extractSitePhotoIndex(normalized);
    return index ? `Site Photograph ${index}` : "Site Photographs";
  }
  if (CATEGORY_LABELS[normalized]) {
    return CATEGORY_LABELS[normalized];
  }
  return normalized
    .replace(/_/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function inferMimeType(fileName: string, fallback?: string | null) {
  if (fallback && fallback.trim().length > 0) {
    const normalized = fallback.trim().toLowerCase();
    if (normalized === "image/jpg") return "image/jpeg";
    return normalized;
  }
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg")) return "image/jpeg";
  return "image/jpeg";
}

function validatePickedUploadFile(file: LeadDocumentUploadFile) {
  if (!ALLOWED_UPLOAD_MIME_TYPES.has(file.fileType)) {
    return "Unsupported file type. Only JPEG, PNG, and PDF are allowed.";
  }
  if (file.fileSize > 0 && file.fileSize > MAX_UPLOAD_SIZE_BYTES) {
    return "File size must be 10 MB or smaller.";
  }
  return null;
}

function createUploadId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function makeFileFromImageAsset(
  asset: ImagePicker.ImagePickerAsset,
  fallbackPrefix: string,
  index: number
): LeadDocumentUploadFile {
  const fileName =
    asset.fileName || `${fallbackPrefix}-${Date.now()}-${index + 1}.jpg`;
  return {
    uri: asset.uri,
    fileName,
    fileType: inferMimeType(fileName, asset.mimeType),
    fileSize: asset.fileSize ?? 0
  };
}

function makeFileFromDocumentAsset(
  asset: DocumentPicker.DocumentPickerAsset,
  index: number
): LeadDocumentUploadFile {
  const fileName = asset.name || `document-${Date.now()}-${index + 1}`;
  return {
    uri: asset.uri,
    fileName,
    fileType: inferMimeType(fileName, asset.mimeType),
    fileSize: asset.size ?? 0
  };
}

export function LeadDetailScreen({ route, navigation }: LeadDetailScreenProps) {
  const colors = useAppPalette();
  const textInputStyle = useTextInputStyle();
  const { leadId } = route.params;
  const user = useAuthStore((s) => s.user);
  const scrollRef = useRef<ScrollView>(null);
  const sectionOffsetsRef = useRef<{ documents?: number }>({});
  const companyUpiId = process.env.EXPO_PUBLIC_COMPANY_UPI_ID?.trim() || "";
  const companyUpiName =
    process.env.EXPO_PUBLIC_COMPANY_UPI_NAME?.trim() || "Solar Payments";
  const explicitQrUrl = process.env.EXPO_PUBLIC_COMPANY_UPI_QR_URL?.trim() || "";

  const [lead, setLead] = useState<LeadDetail | null>(null);
  const [documents, setDocuments] = useState<LeadDocumentSummary[]>([]);
  const [merchantDetails, setMerchantDetails] =
    useState<PaymentMerchantDetails | null>(null);
  const [nextStatuses, setNextStatuses] = useState<WorkflowStatus[]>([]);
  const [selectedNextStatusId, setSelectedNextStatusId] = useState<string | null>(
    null
  );
  const [notes, setNotes] = useState("");
  const [internalNotes, setInternalNotes] = useState<InternalNote[]>([]);
  const [internalNoteText, setInternalNoteText] = useState("");
  const [internalNoteSubmitting, setInternalNoteSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offlineNotice, setOfflineNotice] = useState<string | null>(null);

  const [uploadCategory, setUploadCategory] = useState(DEFAULT_DOCUMENT_CATEGORY);
  const [uploadItems, setUploadItems] = useState<UploadUiItem[]>([]);
  const [cachedDocuments, setCachedDocuments] = useState<Record<string, CachedDocument>>({});
  const [downloadStates, setDownloadStates] = useState<
    Record<string, "idle" | "downloading" | "failed">
  >({});
  const [paymentAmount, setPaymentAmount] = useState("");
  const [utrNumber, setUtrNumber] = useState("");
  const [paymentSubmitting, setPaymentSubmitting] = useState(false);
  const [gatewaySubmitting, setGatewaySubmitting] = useState(false);
  const [gatewayProvider, setGatewayProvider] = useState<"razorpay" | "payu">(
    "razorpay"
  );
  const [paymentSnapshot, setPaymentSnapshot] = useState<Record<string, string>>({});
  const [paymentSnapshotInitialized, setPaymentSnapshotInitialized] =
    useState(false);

  const queueItems = useQueueStore((s) => s.items);
  const enqueue = useQueueStore((s) => s.enqueue);
  const flushQueue = useQueueStore((s) => s.flush);

  const queuedUploadCount = useMemo(
    () =>
      queueItems.filter(
        (item: QueueItem) =>
          item.kind === "UPLOAD_LEAD_DOCUMENT" &&
          item.payload.leadId === leadId &&
          (!item.ownerUserId || item.ownerUserId === user?.id)
      ).length,
    [queueItems, leadId, user?.id]
  );

  const buildSitePhotoIndexSet = useCallback(() => {
    const used = new Set<number>();
    documents.forEach((doc) => {
      const index = extractSitePhotoIndex(doc.category);
      if (index) {
        used.add(index);
      }
    });
    queueItems.forEach((item: QueueItem) => {
      if (
        item.kind === "UPLOAD_LEAD_DOCUMENT" &&
        item.payload.leadId === leadId &&
        (!item.ownerUserId || item.ownerUserId === user?.id) &&
        isSitePhotoCategory(item.payload.category)
      ) {
        const index = extractSitePhotoIndex(item.payload.category);
        if (index) {
          used.add(index);
        }
      }
    });
    return used;
  }, [documents, leadId, queueItems, user?.id]);

  const selectedCategory = useMemo(
    () => DOCUMENT_CATEGORIES.find((option) => option.value === uploadCategory) ?? null,
    [uploadCategory]
  );

  const cacheKey = useMemo(() => `${LEAD_DETAIL_CACHE_PREFIX}:${leadId}`, [leadId]);

  const registerSectionOffset = useCallback(
    (key: "documents") =>
      (event: LayoutChangeEvent) => {
        sectionOffsetsRef.current[key] = event.nativeEvent.layout.y;
      },
    []
  );

  const scrollToSection = useCallback((key: "documents") => {
    const offset = sectionOffsetsRef.current[key];
    if (typeof offset !== "number") return;
    scrollRef.current?.scrollTo({ y: Math.max(0, offset - 12), animated: true });
  }, []);

  const applyLoadedData = useCallback((payload: CachedLeadDetailPayload) => {
    setLead(payload.lead);
    setNextStatuses(Array.isArray(payload.nextStatuses) ? payload.nextStatuses : []);
    setDocuments(Array.isArray(payload.documents) ? payload.documents : []);
    setMerchantDetails(payload.merchantDetails ?? null);
    setInternalNotes(Array.isArray(payload.internalNotes) ? payload.internalNotes : []);

    setPaymentAmount((current) => {
      if (current.trim().length > 0) return current;
      if (!Array.isArray(payload.lead.payments) || payload.lead.payments.length === 0) {
        return current;
      }
      const latestAmount = payload.lead.payments[0]?.amount;
      if (latestAmount === undefined || latestAmount === null) return current;
      return String(latestAmount);
    });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setOfflineNotice(null);
    try {
      const internalNotesPromise = api
        .get(`/api/leads/${leadId}/internal-notes`)
        .catch(() => ({ data: { data: [] as InternalNote[] } }));
      const [detailResp, workflowResp, docsResp, merchantResp, internalNotesResp] = await Promise.all([
        api.get(`/api/leads/${leadId}`),
        api.get(`/api/leads/${leadId}/allowed-next-statuses`),
        api.get(`/api/leads/${leadId}/documents`, {
          params: { latestOnly: true }
        }),
        api.get("/api/payments/merchant-details"),
        internalNotesPromise
      ]);

      const leadDetail = detailResp.data?.data as LeadDetail;
      const workflow = workflowResp.data?.data as {
        currentStatus?: WorkflowStatus;
        nextStatuses?: WorkflowStatus[];
      };
      const docs = docsResp.data?.data as LeadDocumentSummary[] | undefined;
      const merchant = merchantResp.data?.data as PaymentMerchantDetails | undefined;
      const notesList = internalNotesResp.data?.data as InternalNote[] | undefined;

      const loadedPayload: CachedLeadDetailPayload = {
        lead: leadDetail,
        nextStatuses: Array.isArray(workflow?.nextStatuses) ? workflow.nextStatuses : [],
        documents: Array.isArray(docs) ? docs : [],
        merchantDetails: merchant ?? null,
        internalNotes: Array.isArray(notesList) ? notesList : []
      };

      applyLoadedData(loadedPayload);
      if (user?.id) {
        await writeOfflineCache(user.id, cacheKey, loadedPayload);
      }
    } catch (err) {
      if (user?.id) {
        const cached = await readOfflineCache<CachedLeadDetailPayload>(user.id, cacheKey);
        if (cached) {
          applyLoadedData(cached);
          setOfflineNotice("Offline mode: showing cached lead detail.");
          setLoading(false);
          return;
        }
      }

      setError(extractErrorMessage(err, "Failed to load lead detail."));
      setLead(null);
      setNextStatuses([]);
      setDocuments([]);
      setMerchantDetails(null);
      setInternalNotes([]);
    } finally {
      setLoading(false);
    }
  }, [applyLoadedData, cacheKey, leadId, user?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const hydrateCachedDocuments = useCallback(async () => {
    if (!user?.id || documents.length === 0) {
      setCachedDocuments({});
      return;
    }

    const entries = await Promise.all(
      documents.map((doc) => getCachedDocument(user.id, doc.id))
    );
    const next: Record<string, CachedDocument> = {};
    entries.forEach((entry, index) => {
      if (entry) {
        next[documents[index].id] = entry;
      }
    });
    setCachedDocuments(next);
  }, [documents, user?.id]);

  useEffect(() => {
    void hydrateCachedDocuments();
  }, [hydrateCachedDocuments]);

  useEffect(() => {
    setPaymentSnapshot({});
    setPaymentSnapshotInitialized(false);
  }, [leadId]);

  useEffect(() => {
    const timer = setInterval(() => {
      void load();
    }, 60000);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    const payments = lead?.payments ?? [];
    const nextSnapshot = payments.reduce<Record<string, string>>((acc, payment) => {
      acc[payment.id] = payment.status;
      return acc;
    }, {});
    const keys = Object.keys(nextSnapshot);
    const sameSnapshot =
      keys.length === Object.keys(paymentSnapshot).length &&
      keys.every((key) => paymentSnapshot[key] === nextSnapshot[key]);

    if (!paymentSnapshotInitialized) {
      setPaymentSnapshot(nextSnapshot);
      setPaymentSnapshotInitialized(true);
      return;
    }

    if (sameSnapshot) {
      return;
    }

    const changedToTerminal = payments.filter((payment) => {
      const previous = paymentSnapshot[payment.id];
      if (!previous || previous === payment.status) return false;
      return payment.status === "VERIFIED" || payment.status === "REJECTED";
    });

    if (changedToTerminal.length > 0) {
      const lines = changedToTerminal
        .slice(0, 3)
        .map(
          (payment) =>
            `${formatInrAmount(payment.amount)} -> ${payment.status}${
              payment.utrNumber ? ` (UTR ${payment.utrNumber})` : ""
            }`
        );
      const suffix =
        changedToTerminal.length > 3
          ? `\n+${changedToTerminal.length - 3} more payment update(s)`
          : "";
      Alert.alert("Payment status updated", `${lines.join("\n")}${suffix}`);
    }

    setPaymentSnapshot(nextSnapshot);
  }, [lead?.payments, paymentSnapshot, paymentSnapshotInitialized]);

  const selectedStatus = useMemo(
    () =>
      nextStatuses.find((status) => status.id === selectedNextStatusId) ?? null,
    [nextStatuses, selectedNextStatusId]
  );

  const isNotesRequired = selectedStatus?.requiresNote ?? false;
  const isDocumentRequired = selectedStatus?.requiresDocument ?? false;
  const hasAnyUploadedDocument = documents.length > 0;
  const canSubmitTransition =
    !submitting &&
    !!selectedNextStatusId &&
    (!isNotesRequired || notes.trim().length > 0);
  const paymentSummary = useMemo(() => {
    const payments = lead?.payments ?? [];
    return {
      total: payments.length,
      pending: payments.filter((item) => item.status === "PENDING").length,
      verified: payments.filter((item) => item.status === "VERIFIED").length,
      rejected: payments.filter((item) => item.status === "REJECTED").length
    };
  }, [lead?.payments]);

  const destination = useMemo(() => {
    if (!lead) return "";
    const pieces = [
      lead.customerDetail?.addressLine1,
      lead.customerDetail?.addressLine2,
      lead.customerDetail?.villageLocality,
      lead.customerDetail?.pincode,
      lead.district?.name,
      lead.state || lead.district?.state
    ]
      .map((value) => (value || "").trim())
      .filter(Boolean);
    return pieces.join(", ");
  }, [lead]);

  const companyUpiQrUrl = useMemo(() => {
    if (explicitQrUrl) return explicitQrUrl;
    if (!companyUpiId) return "";
    const upiUri = `upi://pay?pa=${companyUpiId}&pn=${companyUpiName}`;
    return `https://quickchart.io/qr?size=280&text=${encodeURIComponent(upiUri)}`;
  }, [companyUpiId, companyUpiName, explicitQrUrl]);
  const fallbackMerchantQrUrl = useMemo(() => {
    if (companyUpiQrUrl) return companyUpiQrUrl;
    const merchantText = [
      merchantDetails?.registeredName || companyUpiName,
      merchantDetails?.gst ? `GST ${merchantDetails.gst}` : null
    ]
      .filter(Boolean)
      .join(" | ");
    if (!merchantText) return "";
    return `https://quickchart.io/qr?size=280&text=${encodeURIComponent(merchantText)}`;
  }, [companyUpiName, companyUpiQrUrl, merchantDetails?.gst, merchantDetails?.registeredName]);

  const updateUploadItem = useCallback(
    (uploadId: string, patch: Partial<UploadUiItem>) => {
      setUploadItems((prev) =>
        prev.map((item) => (item.id === uploadId ? { ...item, ...patch } : item))
      );
    },
    []
  );

  const queueUploadForLater = useCallback(
    async (uploadId: string, file: LeadDocumentUploadFile, category: string) => {
      await enqueue({
        id: `${uploadId}-queue`,
        kind: "UPLOAD_LEAD_DOCUMENT",
        payload: {
          leadId,
          category,
          file
        }
      }, {
        ownerUserId: user?.id,
        dedupeKey: `upload:${leadId}:${category}:${file.fileName}:${file.fileSize}`
      });
      updateUploadItem(uploadId, {
        state: "queued",
        progress: 0,
        error: "Queued for auto-upload when internet reconnects."
      });
    },
    [enqueue, leadId, updateUploadItem, user?.id]
  );

  const runUpload = useCallback(
    async (uploadId: string, file: LeadDocumentUploadFile, category: string) => {
      const netState = await NetInfo.fetch();
      if (!netState.isConnected) {
        await queueUploadForLater(uploadId, file, category);
        return;
      }

      updateUploadItem(uploadId, {
        state: "uploading",
        progress: 1,
        error: undefined
      });

      try {
        await uploadLeadDocument({
          leadId,
          category,
          file,
          maxAttempts: 2,
          onProgress: (progress) => {
            updateUploadItem(uploadId, { progress, state: "uploading" });
          }
        });

        updateUploadItem(uploadId, {
          state: "uploaded",
          progress: 100,
          error: undefined
        });
        await load();
      } catch (err) {
        updateUploadItem(uploadId, {
          state: "failed",
          progress: 0,
          error: extractErrorMessage(err, "Upload failed.")
        });
      }
    },
    [leadId, load, queueUploadForLater, updateUploadItem]
  );

  const handlePickedFiles = useCallback(
    async (files: LeadDocumentUploadFile[], source: UploadSource) => {
      if (!files.length) return;
      const baseCategory = normalizeCategory(uploadCategory);
      const sitePhotoIndices = isSitePhotoCategory(baseCategory)
        ? buildSitePhotoIndexSet()
        : new Set<number>();

      for (const file of files) {
        const validationError = validatePickedUploadFile(file);
        if (validationError) {
          Alert.alert("File not supported", validationError);
          continue;
        }

        let resolvedCategory = baseCategory;
        if (isSitePhotoCategory(baseCategory)) {
          let nextIndex = 1;
          while (sitePhotoIndices.has(nextIndex) && nextIndex <= SITE_PHOTO_MAX) {
            nextIndex += 1;
          }
          if (nextIndex > SITE_PHOTO_MAX) {
            Alert.alert(
              "Site photo limit reached",
              `A maximum of ${SITE_PHOTO_MAX} site photographs can be uploaded for this lead.`
            );
            break;
          }
          resolvedCategory = `site_photo_${nextIndex}`;
          sitePhotoIndices.add(nextIndex);
        }

        const uploadId = createUploadId();
        setUploadItems((prev) => [
          {
            id: uploadId,
            source,
            category: resolvedCategory,
            file,
            state: "pending",
            progress: 0
          },
          ...prev
        ]);

        await runUpload(uploadId, file, resolvedCategory);
      }
    },
    [buildSitePhotoIndexSet, runUpload, uploadCategory]
  );

  const handleDownloadDocument = useCallback(
    async (doc: LeadDocumentSummary) => {
      if (!user?.id) return;
      const netState = await NetInfo.fetch();
      const connected = Boolean(netState.isConnected) && netState.isInternetReachable !== false;
      if (!connected) {
        Alert.alert("Offline", "Connect to the internet to download this document.");
        return;
      }

      setDownloadStates((prev) => ({ ...prev, [doc.id]: "downloading" }));
      try {
        const cached = await downloadAndCacheDocument(user.id, doc.id);
        setCachedDocuments((prev) => ({ ...prev, [doc.id]: cached }));
        setDownloadStates((prev) => ({ ...prev, [doc.id]: "idle" }));
        Alert.alert("Downloaded", "Document saved for offline access.");
      } catch (err) {
        setDownloadStates((prev) => ({ ...prev, [doc.id]: "failed" }));
        Alert.alert("Download failed", extractErrorMessage(err, "Unable to download document."));
      }
    },
    [user?.id]
  );

  const openCachedDocument = useCallback(
    async (documentId: string) => {
      const cached = cachedDocuments[documentId];
      if (!cached) return;
      try {
        const uri =
          Platform.OS === "android"
            ? await FileSystem.getContentUriAsync(cached.localUri)
            : cached.localUri;
        await Linking.openURL(uri);
      } catch (err) {
        Alert.alert("Open failed", extractErrorMessage(err, "Unable to open document."));
      }
    },
    [cachedDocuments]
  );

  const pickFromCamera = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (permission.status !== "granted") {
      Alert.alert("Camera permission required", "Please allow camera access.");
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      quality: 0.8,
      mediaTypes: ImagePicker.MediaTypeOptions.Images
    });
    if (result.canceled || !result.assets?.length) return;

    const files = result.assets.map((asset, index) =>
      makeFileFromImageAsset(asset, "camera", index)
    );
    await handlePickedFiles(files, "camera");
  };

  const pickFromGallery = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (permission.status !== "granted") {
      Alert.alert(
        "Gallery permission required",
        "Please allow media library access."
      );
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      quality: 0.8,
      allowsMultipleSelection: true,
      mediaTypes: ImagePicker.MediaTypeOptions.Images
    });
    if (result.canceled || !result.assets?.length) return;

    const files = result.assets.map((asset, index) =>
      makeFileFromImageAsset(asset, "gallery", index)
    );
    await handlePickedFiles(files, "gallery");
  };

  const pickFromDocument = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      multiple: true,
      copyToCacheDirectory: true,
      type: ["application/pdf", "image/jpeg", "image/png"]
    });
    if (result.canceled || !result.assets?.length) return;

    const files = result.assets.map((asset, index) =>
      makeFileFromDocumentAsset(asset, index)
    );
    await handlePickedFiles(files, "document");
  };

  const retryUpload = async (item: UploadUiItem) => {
    updateUploadItem(item.id, { state: "pending", error: undefined, progress: 0 });
    await runUpload(item.id, item.file, item.category);
  };

  const retryQueuedUploads = async () => {
    await flushQueue(user?.id);
    await load();
  };

  const openDialer = async () => {
    const phone = (lead?.phone || "").trim();
    if (!phone) {
      Alert.alert("Phone unavailable", "No phone number available for this lead.");
      return;
    }
    const url = `tel:${phone}`;
    const canOpen = await Linking.canOpenURL(url);
    if (!canOpen) {
      Alert.alert("Dialer unavailable", "Your device cannot open phone dialer.");
      return;
    }
    await Linking.openURL(url);
  };

  const openMaps = async () => {
    if (!destination) {
      Alert.alert("Address unavailable", "No destination address found for this lead.");
      return;
    }

    const encoded = encodeURIComponent(destination);
    const candidates =
      Platform.OS === "ios"
        ? [
            `http://maps.apple.com/?daddr=${encoded}`,
            `http://maps.apple.com/?q=${encoded}`
          ]
        : [
            `google.navigation:q=${encoded}`,
            `geo:0,0?q=${encoded}`,
            `https://www.google.com/maps/search/?api=1&query=${encoded}`
          ];

    for (const url of candidates) {
      const canOpen = await Linking.canOpenURL(url);
      if (canOpen) {
        await Linking.openURL(url);
        return;
      }
    }

    Alert.alert("Maps unavailable", "Could not open maps app.");
  };

  const submitQrUtrPayment = async () => {
    const amount = Number(paymentAmount);
    const cleanUtr = sanitizeUtr(utrNumber);

    if (!Number.isFinite(amount) || amount <= 0) {
      Alert.alert("Invalid amount", "Enter a valid payment amount.");
      return;
    }
    if (cleanUtr.length < 6) {
      Alert.alert("Invalid UTR", "UTR number must be at least 6 characters.");
      return;
    }

    setPaymentSubmitting(true);
    try {
      await api.post("/api/payments/qr-utr", {
        leadId,
        amount,
        utrNumber: cleanUtr
      });
      setUtrNumber("");
      Alert.alert("Submitted", "UTR submitted for verification.");
      await load();
    } catch (err) {
      Alert.alert(
        "Payment submit failed",
        extractErrorMessage(err, "Unable to submit QR payment.")
      );
    } finally {
      setPaymentSubmitting(false);
    }
  };

  const createGatewayOrderAndOpenUpi = async () => {
    const amount = Number(paymentAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      Alert.alert("Invalid amount", "Enter a valid payment amount.");
      return;
    }

    setGatewaySubmitting(true);
    try {
      const response = await api.post(`/api/payments/gateway/${gatewayProvider}/order`, {
        leadId,
        amount,
        currency: "INR",
        notes: {
          source: "mobile_placeholder"
        }
      });

      const orderId = response.data?.data?.orderId as string | undefined;
      const provider = response.data?.data?.provider as string | undefined;
      if (!orderId) {
        throw new Error("Gateway placeholder orderId not found.");
      }

      if (!companyUpiId) {
        Alert.alert(
          "Order created",
          `${provider ?? gatewayProvider} order ${orderId} created. Configure EXPO_PUBLIC_COMPANY_UPI_ID to open UPI intent automatically.`
        );
        return;
      }

      const upiUrl = `upi://pay?pa=${encodeURIComponent(
        companyUpiId
      )}&pn=${encodeURIComponent(companyUpiName)}&am=${encodeURIComponent(
        amount.toFixed(2)
      )}&cu=INR&tn=${encodeURIComponent(`Order ${orderId}`)}`;

      const canOpen = await Linking.canOpenURL(upiUrl);
      if (!canOpen) {
        Alert.alert(
          "UPI app unavailable",
          `Order ${orderId} created, but no UPI app is available on this device.`
        );
        return;
      }

      await Linking.openURL(upiUrl);
      Alert.alert(
        "Gateway order created",
        `Opened UPI app for order ${orderId}. Submit final UTR if needed.`
      );
    } catch (err) {
      Alert.alert(
        "Gateway order failed",
        extractErrorMessage(err, "Unable to create gateway placeholder order.")
      );
    } finally {
      setGatewaySubmitting(false);
    }
  };

  const queueStatusTransitionForLater = useCallback(
    async (nextStatusId: string, transitionNotes?: string) => {
      await enqueue(
        {
          id: `${Date.now()}-status-${leadId}`,
          kind: "UPDATE_LEAD_STATUS",
          payload: {
            leadId,
            nextStatusId,
            notes: transitionNotes
          }
        },
        {
          ownerUserId: user?.id,
          dedupeKey: `status-transition:${leadId}`
        }
      );

      Alert.alert(
        "Saved offline",
        "Status change is queued and will sync when internet reconnects."
      );
      setSelectedNextStatusId(null);
      setNotes("");
    },
    [enqueue, leadId, user?.id]
  );

  const performTransition = async () => {
    if (!selectedNextStatusId) return;
    setSubmitting(true);
    const transitionNotes = notes.trim() ? notes.trim() : undefined;
    try {
      const netState = await NetInfo.fetch();
      const connected = Boolean(netState.isConnected) && netState.isInternetReachable !== false;
      if (!connected) {
        await queueStatusTransitionForLater(selectedNextStatusId, transitionNotes);
        return;
      }

      await api.post(`/api/leads/${leadId}/transition`, {
        nextStatusId: selectedNextStatusId,
        notes: transitionNotes
      });
      Alert.alert("Status updated", "Lead status has been updated.");
      setSelectedNextStatusId(null);
      setNotes("");
      await load();
    } catch (err) {
      const netState = await NetInfo.fetch();
      const connected = Boolean(netState.isConnected) && netState.isInternetReachable !== false;
      const hasHttpResponse = Boolean((err as { response?: unknown })?.response);
      if (!connected || !hasHttpResponse) {
        await queueStatusTransitionForLater(selectedNextStatusId, transitionNotes);
        return;
      }

      Alert.alert(
        "Update failed",
        extractErrorMessage(err, "Unable to update lead status.")
      );
    } finally {
      setSubmitting(false);
    }
  };

  const submitTransition = async () => {
    if (!selectedNextStatusId || !selectedStatus) return;
    if (isNotesRequired && !notes.trim()) {
      Alert.alert("Notes required", "Please enter notes before changing status.");
      return;
    }

    if (isDocumentRequired && !hasAnyUploadedDocument) {
      Alert.alert(
        "Document required",
        `Status "${selectedStatus.name}" requires at least one uploaded document. Upload a document first.`
      );
      return;
    }

    Alert.alert(
      "Confirm status update",
      `Move lead to "${selectedStatus.name}"?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Confirm",
          style: "default",
          onPress: () => {
            void performTransition();
          }
        }
      ]
    );
  };

  const submitInternalNote = async () => {
    const trimmedNote = internalNoteText.trim();
    if (trimmedNote.length < 3) {
      Alert.alert("Note required", "Please enter at least 3 characters.");
      return;
    }

    setInternalNoteSubmitting(true);
    try {
      await api.post(`/api/leads/${leadId}/internal-notes`, {
        note: trimmedNote
      });
      setInternalNoteText("");
      await load();
    } catch (err) {
      Alert.alert(
        "Note save failed",
        extractErrorMessage(err, "Unable to save internal note.")
      );
    } finally {
      setInternalNoteSubmitting(false);
    }
  };

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12 }}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text>Loading lead detail...</Text>
      </View>
    );
  }

  if (!lead) {
    return (
      <View style={{ flex: 1, padding: 16, gap: 12 }}>
        <Text style={{ color: colors.danger }}>{error ?? "Lead detail is unavailable."}</Text>
        <Pressable
          onPress={() => {
            void load();
          }}
          style={{ backgroundColor: colors.primary, borderRadius: 8, padding: 12 }}
        >
          <Text style={{ color: "#fff", textAlign: "center", fontWeight: "700" }}>
            Retry
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView
      ref={scrollRef}
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 120 }}
    >
      <View
        onLayout={registerSectionOffset("documents")}
        style={{
          backgroundColor: colors.surface,
          borderRadius: 10,
          padding: 12,
          borderWidth: 1,
          borderColor: colors.border,
          gap: 6
        }}
      >
        {offlineNotice ? (
          <Text style={{ color: colors.warning, fontWeight: "700" }}>{offlineNotice}</Text>
        ) : null}
        <Text style={{ fontSize: 20, fontWeight: "700" }}>{lead.name}</Text>
        <Text>ID: {lead.externalId}</Text>
        <Text>{lead.phone}</Text>
        {lead.email ? <Text>{lead.email}</Text> : null}
        <Text
          style={{
            color: lead.currentStatus?.colorCode ?? colors.primary,
            fontWeight: "700",
            marginTop: 4
          }}
        >
          Current Status: {lead.currentStatus?.name}
        </Text>
        <Text style={{ fontSize: 12, color: colors.textMuted }}>
          Last updated: {formatDateTime(lead.updatedAt)}
        </Text>
      </View>

      <View
        style={{
          backgroundColor: colors.surface,
          borderRadius: 10,
          padding: 12,
          borderWidth: 1,
          borderColor: colors.border,
          gap: 10
        }}
      >
        <Text style={{ fontSize: 16, fontWeight: "700" }}>Quick Actions</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          <Pressable
            onPress={() => {
              void openDialer();
            }}
            style={{
              flexGrow: 1,
              flexBasis: "48%",
              minWidth: 140,
              backgroundColor: colors.primary,
              borderRadius: 8,
              paddingVertical: 12,
              paddingHorizontal: 8,
              alignItems: "center",
              justifyContent: "center"
            }}
          >
            <Text style={{ color: "#fff", textAlign: "center", fontWeight: "700" }}>
              Call
            </Text>
          </Pressable>
          <Pressable
            onPress={() => {
              void openMaps();
            }}
            style={{
              flexGrow: 1,
              flexBasis: "48%",
              minWidth: 140,
              backgroundColor: colors.info,
              borderRadius: 8,
              paddingVertical: 12,
              paddingHorizontal: 8,
              alignItems: "center",
              justifyContent: "center"
            }}
          >
            <Text style={{ color: "#fff", textAlign: "center", fontWeight: "700" }}>
              Navigate
            </Text>
          </Pressable>
          <Pressable
            onPress={() =>
              navigation.navigate("CustomerDetails", { leadId, leadName: lead.name })
            }
            style={{
              flexGrow: 1,
              flexBasis: "48%",
              minWidth: 140,
              backgroundColor: colors.primaryDark,
              borderRadius: 8,
              paddingVertical: 12,
              paddingHorizontal: 8,
              alignItems: "center",
              justifyContent: "center"
            }}
          >
            <Text style={{ color: "#fff", textAlign: "center", fontWeight: "700" }}>
              Customer Form
            </Text>
          </Pressable>
          <Pressable
            onPress={() => {
              scrollToSection("documents");
            }}
            style={{
              flexGrow: 1,
              flexBasis: "48%",
              minWidth: 140,
              backgroundColor: colors.warning,
              borderRadius: 8,
              paddingVertical: 12,
              paddingHorizontal: 8,
              alignItems: "center",
              justifyContent: "center"
            }}
          >
            <Text style={{ color: "#fff", textAlign: "center", fontWeight: "700" }}>
              Upload Docs
            </Text>
          </Pressable>
        </View>
      </View>

      <View
        style={{
          backgroundColor: colors.surface,
          borderRadius: 10,
          padding: 12,
          borderWidth: 1,
          borderColor: colors.border,
          gap: 10
        }}
      >
        <Text style={{ fontSize: 16, fontWeight: "700" }}>Payment Collection</Text>
        <Text style={{ color: colors.text }}>
          Merchant: {merchantDetails?.registeredName || companyUpiName}
        </Text>
        {merchantDetails?.gst ? <Text style={{ color: colors.textMuted }}>GST: {merchantDetails.gst}</Text> : null}

        {fallbackMerchantQrUrl ? (
          <Image
            source={{ uri: fallbackMerchantQrUrl }}
            style={{ width: 220, height: 220, alignSelf: "center", borderRadius: 10 }}
            resizeMode="contain"
          />
        ) : (
          <View
            style={{
              alignSelf: "center",
              width: 220,
              height: 220,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 10,
              alignItems: "center",
              justifyContent: "center",
              padding: 12
            }}
          >
            <Text style={{ textAlign: "center", color: colors.textMuted }}>
              Unable to generate QR. Configure EXPO_PUBLIC_COMPANY_UPI_QR_URL or merchant details.
            </Text>
          </View>
        )}

        {companyUpiId ? <Text style={{ color: colors.text }}>UPI ID: {companyUpiId}</Text> : null}
        {!companyUpiId ? (
          <Text style={{ color: colors.warning }}>
            UPI ID is not configured; QR shows merchant reference, and gateway UPI deep-link will stay disabled.
          </Text>
        ) : null}

        <TextInput
          value={paymentAmount}
          onChangeText={setPaymentAmount}
          placeholder="Amount (INR)"
          keyboardType="decimal-pad"
          style={textInputStyle}
        />
        <TextInput
          value={utrNumber}
          onChangeText={(text) => setUtrNumber(sanitizeUtr(text))}
          placeholder="Enter UTR number"
          autoCapitalize="characters"
          style={textInputStyle}
        />

        <Pressable
          onPress={() => {
            void submitQrUtrPayment();
          }}
          disabled={paymentSubmitting}
          style={{
            backgroundColor: paymentSubmitting ? colors.textMuted : colors.primary,
            borderRadius: 8,
            padding: 12
          }}
        >
          <Text style={{ color: "#fff", textAlign: "center", fontWeight: "700" }}>
            {paymentSubmitting ? "Submitting..." : "Submit QR UTR"}
          </Text>
        </Pressable>

        <View
          style={{
            borderTopWidth: 1,
            borderTopColor: colors.border,
            paddingTop: 10,
            gap: 8
          }}
        >
          <Text style={{ fontWeight: "700", color: colors.text }}>
            Gateway Placeholder (Optional)
          </Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Pressable
              onPress={() => setGatewayProvider("razorpay")}
              style={{
                flex: 1,
                borderWidth: 1,
                borderColor: gatewayProvider === "razorpay" ? colors.primary : colors.border,
                backgroundColor:
                  gatewayProvider === "razorpay" ? colors.accent : colors.surface,
                borderRadius: 8,
                padding: 10
              }}
            >
              <Text
                style={{
                  textAlign: "center",
                  fontWeight: "700",
                  color: gatewayProvider === "razorpay" ? colors.primary : colors.text
                }}
              >
                Razorpay
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setGatewayProvider("payu")}
              style={{
                flex: 1,
                borderWidth: 1,
                borderColor: gatewayProvider === "payu" ? colors.primary : colors.border,
                backgroundColor:
                  gatewayProvider === "payu" ? colors.accent : colors.surface,
                borderRadius: 8,
                padding: 10
              }}
            >
              <Text
                style={{
                  textAlign: "center",
                  fontWeight: "700",
                  color: gatewayProvider === "payu" ? colors.primary : colors.text
                }}
              >
                PayU
              </Text>
            </Pressable>
          </View>

          <Pressable
            onPress={() => {
              void createGatewayOrderAndOpenUpi();
            }}
            disabled={gatewaySubmitting}
            style={{
              backgroundColor: gatewaySubmitting ? colors.textMuted : colors.info,
              borderRadius: 8,
              padding: 12
            }}
          >
            <Text style={{ color: "#fff", textAlign: "center", fontWeight: "700" }}>
              {gatewaySubmitting ? "Creating Order..." : "Create Gateway Order & Open UPI"}
            </Text>
          </Pressable>
        </View>
      </View>

      <View
        style={{
          backgroundColor: colors.surface,
          borderRadius: 10,
          padding: 12,
          borderWidth: 1,
          borderColor: colors.border,
          gap: 8
        }}
      >
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Text style={{ fontSize: 16, fontWeight: "700" }}>Payment Status</Text>
          <Pressable
            onPress={() => {
              void load();
            }}
            style={{
              paddingVertical: 4,
              paddingHorizontal: 8,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: colors.border
            }}
          >
            <Text style={{ fontWeight: "700", color: colors.text }}>Refresh</Text>
          </Pressable>
        </View>

        <Text style={{ color: colors.textMuted }}>
          Total: {paymentSummary.total} | Pending: {paymentSummary.pending} | Verified:{" "}
          {paymentSummary.verified} | Rejected: {paymentSummary.rejected}
        </Text>

        {(lead.payments ?? []).length === 0 ? (
          <Text style={{ color: colors.textMuted }}>No payment records for this lead yet.</Text>
        ) : (
          (lead.payments ?? []).slice(0, 10).map((payment) => (
            <View
              key={payment.id}
              style={{
                borderBottomWidth: 1,
                borderBottomColor: colors.border,
                paddingBottom: 8,
                gap: 2
              }}
            >
              <Text style={{ fontWeight: "700" }}>
                {formatInrAmount(payment.amount)} | {payment.method}
              </Text>
              <Text
                style={{ color: getPaymentStatusColor(payment.status, colors), fontWeight: "700" }}
              >
                {payment.status}
              </Text>
              {payment.utrNumber ? <Text>UTR: {payment.utrNumber}</Text> : null}
              {payment.gatewayOrderId ? <Text>Order: {payment.gatewayOrderId}</Text> : null}
              {payment.rejectionReason ? (
                <Text style={{ color: colors.danger }}>Reason: {payment.rejectionReason}</Text>
              ) : null}
              <Text style={{ color: colors.textMuted, fontSize: 12 }}>
                Created: {formatDateTime(payment.createdAt)}
              </Text>
              {payment.verifiedAt ? (
                <Text style={{ color: colors.textMuted, fontSize: 12 }}>
                  Reviewed: {formatDateTime(payment.verifiedAt)}
                </Text>
              ) : null}
            </View>
          ))
        )}
      </View>

      <View
        style={{
          backgroundColor: colors.surface,
          borderRadius: 10,
          padding: 12,
          borderWidth: 1,
          borderColor: colors.border,
          gap: 10
        }}
      >
        <Text style={{ fontSize: 16, fontWeight: "700" }}>Document Upload</Text>
        <View style={{ gap: 8 }}>
          <Text style={{ color: colors.textMuted, fontWeight: "600" }}>Category</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {DOCUMENT_CATEGORIES.map((option) => {
              const active = uploadCategory === option.value;
              return (
                <Pressable
                  key={option.value}
                  onPress={() => setUploadCategory(option.value)}
                  style={{
                    borderWidth: 1,
                    borderColor: active ? colors.primary : colors.border,
                    backgroundColor: active ? colors.accent : colors.surface,
                    borderRadius: 999,
                    paddingVertical: 6,
                    paddingHorizontal: 12
                  }}
                >
                  <Text
                    style={{
                      fontWeight: active ? "700" : "500",
                      color: active ? colors.primary : colors.text
                    }}
                  >
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {selectedCategory?.helper ? (
            <Text style={{ color: colors.textMuted }}>{selectedCategory.helper}</Text>
          ) : null}
        </View>

        <View style={{ flexDirection: "row", gap: 8 }}>
          <Pressable
            onPress={() => {
              void pickFromCamera();
            }}
            style={{ flex: 1, backgroundColor: colors.primaryDark, borderRadius: 8, padding: 10 }}
          >
            <Text style={{ textAlign: "center", color: "#fff", fontWeight: "700" }}>
              Camera
            </Text>
          </Pressable>
          <Pressable
            onPress={() => {
              void pickFromGallery();
            }}
            style={{ flex: 1, backgroundColor: colors.info, borderRadius: 8, padding: 10 }}
          >
            <Text style={{ textAlign: "center", color: "#fff", fontWeight: "700" }}>
              Gallery
            </Text>
          </Pressable>
          <Pressable
            onPress={() => {
              void pickFromDocument();
            }}
            style={{ flex: 1, backgroundColor: colors.warning, borderRadius: 8, padding: 10 }}
          >
            <Text style={{ textAlign: "center", color: "#fff", fontWeight: "700" }}>
              Files
            </Text>
          </Pressable>
        </View>

        {queuedUploadCount > 0 ? (
          <View style={{ gap: 8 }}>
            <Text style={{ color: colors.warning, fontWeight: "700" }}>
              {queuedUploadCount} upload(s) pending offline sync.
            </Text>
            <Pressable
              onPress={() => {
                void retryQueuedUploads();
              }}
              style={{
                borderWidth: 1,
                borderColor: colors.warning,
                borderRadius: 8,
                padding: 10
              }}
            >
              <Text style={{ textAlign: "center", color: colors.warning, fontWeight: "700" }}>
                Retry Queued Uploads
              </Text>
            </Pressable>
          </View>
        ) : null}

        {uploadItems.length ? (
          <View style={{ gap: 8 }}>
            {uploadItems.map((item) => (
              <View
                key={item.id}
                style={{
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: 8,
                  padding: 10,
                  gap: 4
                }}
              >
                <Text style={{ fontWeight: "700" }}>{item.file.fileName}</Text>
                <Text style={{ color: colors.textMuted }}>
                  {formatCategoryLabel(item.category)} | {formatBytes(item.file.fileSize)}
                </Text>
                <Text>
                  Status:{" "}
                  {item.state === "uploading"
                    ? `Uploading ${item.progress}%`
                    : item.state === "uploaded"
                      ? "Uploaded"
                      : item.state === "queued"
                        ? "Queued"
                        : item.state === "failed"
                          ? "Failed"
                          : "Pending"}
                </Text>
                {item.error ? <Text style={{ color: colors.danger }}>{item.error}</Text> : null}
                {item.state === "failed" ? (
                  <Pressable
                    onPress={() => {
                      void retryUpload(item);
                    }}
                    style={{ backgroundColor: colors.danger, borderRadius: 8, padding: 8 }}
                  >
                    <Text style={{ color: "#fff", textAlign: "center", fontWeight: "700" }}>
                      Retry
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            ))}
          </View>
        ) : (
          <Text style={{ color: colors.textMuted }}>
            Pick from camera, gallery, or files to upload lead documents.
          </Text>
        )}
      </View>

      <View
        style={{
          backgroundColor: colors.surface,
          borderRadius: 10,
          padding: 12,
          borderWidth: 1,
          borderColor: colors.border,
          gap: 8
        }}
      >
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Text style={{ fontSize: 16, fontWeight: "700" }}>Uploaded Documents</Text>
          <Pressable
            onPress={() => {
              void load();
            }}
            style={{ paddingVertical: 4, paddingHorizontal: 8, borderRadius: 8, borderWidth: 1, borderColor: colors.border }}
          >
            <Text style={{ fontWeight: "700", color: colors.text }}>Refresh</Text>
          </Pressable>
        </View>

        {documents.length === 0 ? (
          <Text style={{ color: colors.textMuted }}>No documents uploaded for this lead yet.</Text>
        ) : (
          documents.slice(0, 10).map((doc) => {
            const cached = cachedDocuments[doc.id];
            const downloadState = downloadStates[doc.id] ?? "idle";
            return (
              <View
                key={doc.id}
                style={{ borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: 8 }}
              >
                <Text style={{ fontWeight: "700" }}>{doc.fileName}</Text>
                <Text style={{ color: colors.textMuted, fontSize: 12 }}>
                  {formatCategoryLabel(doc.category)} | v{doc.version} | {doc.reviewStatus}
                </Text>
                <Text style={{ color: colors.textMuted, fontSize: 12 }}>
                  {formatDateTime(doc.createdAt)}
                </Text>
                {cached ? (
                  <Text style={{ color: colors.primary, fontSize: 12 }}>
                    Available offline
                  </Text>
                ) : null}
                <View style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
                  {cached ? (
                    <Pressable
                      onPress={() => {
                        void openCachedDocument(doc.id);
                      }}
                      style={{
                        borderWidth: 1,
                        borderColor: colors.primary,
                        borderRadius: 8,
                        paddingVertical: 6,
                        paddingHorizontal: 10
                      }}
                    >
                      <Text style={{ color: colors.primary, fontWeight: "700" }}>
                        Open Offline
                      </Text>
                    </Pressable>
                  ) : (
                    <Pressable
                      onPress={() => {
                        void handleDownloadDocument(doc);
                      }}
                      disabled={downloadState === "downloading"}
                      style={{
                        borderWidth: 1,
                        borderColor: colors.border,
                        borderRadius: 8,
                        paddingVertical: 6,
                        paddingHorizontal: 10,
                        opacity: downloadState === "downloading" ? 0.6 : 1
                      }}
                    >
                      <Text style={{ color: colors.text, fontWeight: "700" }}>
                        {downloadState === "downloading" ? "Downloading..." : "Download for Offline"}
                      </Text>
                    </Pressable>
                  )}
                </View>
                {downloadState === "failed" ? (
                  <Text style={{ color: colors.danger, fontSize: 12 }}>
                    Download failed. Retry when online.
                  </Text>
                ) : null}
              </View>
            );
          })
        )}
      </View>

      <View
        style={{
          backgroundColor: colors.surface,
          borderRadius: 10,
          padding: 12,
          borderWidth: 1,
          borderColor: colors.border,
          gap: 8
        }}
      >
        <Text style={{ fontSize: 16, fontWeight: "700" }}>Next Status</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {nextStatuses.length === 0 ? (
            <Text style={{ color: colors.textMuted }}>No workflow transitions available.</Text>
          ) : (
            nextStatuses.map((status) => {
              const active = selectedNextStatusId === status.id;
              return (
                <Pressable
                  key={status.id}
                  onPress={() => setSelectedNextStatusId(status.id)}
                  style={{
                    borderWidth: 1,
                    borderColor: active ? colors.primary : colors.border,
                    backgroundColor: active ? colors.accent : colors.surface,
                    borderRadius: 999,
                    paddingVertical: 8,
                    paddingHorizontal: 12
                  }}
                >
                  <Text
                    style={{
                      fontWeight: active ? "700" : "500",
                      color: active ? colors.primary : colors.text
                    }}
                  >
                    {status.name}
                  </Text>
                </Pressable>
              );
            })
          )}
        </View>

        {selectedStatus ? (
          <Text style={{ color: colors.textMuted }}>
            Requirements:
            {selectedStatus.requiresNote ? " note required;" : " note optional;"}
            {selectedStatus.requiresDocument ? " document required." : " document optional."}
          </Text>
        ) : null}
        {isDocumentRequired && !hasAnyUploadedDocument ? (
          <Text style={{ color: colors.warning }}>
            Upload at least one document before this transition.
          </Text>
        ) : null}

        <Text style={{ fontWeight: "700", marginTop: 4 }}>
          Notes {isNotesRequired ? "(required)" : "(optional)"}
        </Text>
        <TextInput
          value={notes}
          onChangeText={setNotes}
          placeholder="Add notes for this status update"
          multiline
          style={[textInputStyle, { minHeight: 80, textAlignVertical: "top" }]}
        />

        <Pressable
          onPress={() => {
            void submitTransition();
          }}
          disabled={!canSubmitTransition}
          style={{
            backgroundColor: canSubmitTransition ? colors.primary : colors.textMuted,
            borderRadius: 8,
            padding: 12
          }}
        >
          <Text style={{ color: "#fff", textAlign: "center", fontWeight: "700" }}>
            {submitting ? "Updating..." : "Update Status"}
          </Text>
        </Pressable>
      </View>

      <View
        style={{
          backgroundColor: colors.surface,
          borderRadius: 10,
          padding: 12,
          borderWidth: 1,
          borderColor: colors.border,
          gap: 8
        }}
      >
        <Text style={{ fontSize: 16, fontWeight: "700" }}>Internal Notes</Text>

        <TextInput
          value={internalNoteText}
          onChangeText={setInternalNoteText}
          placeholder="Add internal note for admin + executive"
          multiline
          style={[textInputStyle, { minHeight: 80, textAlignVertical: "top" }]}
        />

        <Pressable
          onPress={() => {
            void submitInternalNote();
          }}
          disabled={internalNoteSubmitting}
          style={{
            backgroundColor: internalNoteSubmitting ? colors.textMuted : colors.primaryDark,
            borderRadius: 8,
            padding: 12
          }}
        >
          <Text style={{ color: "#fff", textAlign: "center", fontWeight: "700" }}>
            {internalNoteSubmitting ? "Saving..." : "Add Internal Note"}
          </Text>
        </Pressable>

        {internalNotes.length === 0 ? (
          <Text style={{ color: colors.textMuted }}>No internal notes yet.</Text>
        ) : (
          internalNotes.slice(0, 12).map((entry) => (
            <View
              key={entry.id}
              style={{
                borderBottomWidth: 1,
                borderBottomColor: colors.border,
                paddingBottom: 8
              }}
            >
              <Text style={{ fontWeight: "700", color: colors.text }}>{entry.note}</Text>
              <Text style={{ color: colors.textMuted, fontSize: 12 }}>
                {entry.actor?.fullName ?? "Unknown"} | {formatDateTime(entry.createdAt)}
              </Text>
            </View>
          ))
        )}
      </View>

      <View
        style={{
          backgroundColor: colors.surface,
          borderRadius: 10,
          padding: 12,
          borderWidth: 1,
          borderColor: colors.border,
          gap: 8
        }}
      >
        <Text style={{ fontSize: 16, fontWeight: "700" }}>Status Timeline</Text>
        {lead.statusHistory?.length ? (
          lead.statusHistory.slice(0, 8).map((entry) => (
            <View
              key={entry.id}
              style={{
                borderBottomWidth: 1,
                borderBottomColor: colors.border,
                paddingBottom: 8
              }}
            >
              <Text style={{ fontWeight: "700" }}>
                {entry.fromStatus?.name ?? "Start"}
                {" -> "}
                {entry.toStatus?.name}
              </Text>
              <Text style={{ color: colors.textMuted, fontSize: 12 }}>
                {formatDateTime(entry.createdAt)}
              </Text>
              {entry.notes ? <Text style={{ marginTop: 2 }}>{entry.notes}</Text> : null}
            </View>
          ))
        ) : (
          <Text style={{ color: colors.textMuted }}>No status history found.</Text>
        )}
      </View>
    </ScrollView>
  );
}
