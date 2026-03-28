import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import axios from "axios";
import { api } from "../services/api";
import { uploadLeadDocument } from "../services/document-upload";
import type { LeadDocumentUploadFile } from "../services/document-upload";
import {
  cleanupPersistentUploadUri,
  ensurePersistentLeadAttachmentFile,
  ensurePersistentLeadDocumentFile
} from "../services/upload-persistence";

const KEY = "offline_queue";

type QueueItemBase = {
  id: string;
  ownerUserId?: string;
  dedupeKey?: string;
  failCount?: number;
  lastError?: string;
  retryable?: boolean;
};

type LeadAttachment = {
  uri: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
};

type CreateLeadWithAttachmentsQueueItem = QueueItemBase & {
  kind: "CREATE_LEAD_WITH_ATTACHMENTS";
  payload: {
    lead: unknown;
    attachments: LeadAttachment[];
  };
};

type UploadLeadDocumentQueueItem = QueueItemBase & {
  kind: "UPLOAD_LEAD_DOCUMENT";
  payload: {
    leadId: string;
    category: string;
    file: LeadDocumentUploadFile;
  };
};

type UpdateLeadStatusQueueItem = QueueItemBase & {
  kind: "UPDATE_LEAD_STATUS";
  payload: {
    leadId: string;
    nextStatusId: string;
    notes?: string;
    overrideReason?: string;
  };
};

type UpsertCustomerDetailsQueueItem = QueueItemBase & {
  kind: "UPSERT_CUSTOMER_DETAILS";
  payload: {
    leadId: string;
    data: unknown;
  };
};

export type QueueItem =
  | CreateLeadWithAttachmentsQueueItem
  | UploadLeadDocumentQueueItem
  | UpdateLeadStatusQueueItem
  | UpsertCustomerDetailsQueueItem;

type QueueEnqueueOptions = {
  ownerUserId?: string;
  dedupeKey?: string;
};

type QueueState = {
  items: QueueItem[];
  hydrate: () => Promise<void>;
  enqueue: (item: QueueItem, options?: QueueEnqueueOptions) => Promise<void>;
  remove: (id: string) => Promise<void>;
  flush: (ownerUserId?: string) => Promise<void>;
  clearByOwner: (ownerUserId: string) => Promise<void>;
};

type QueueLeadPayload = {
  districtId: string;
  source: string;
  customer: {
    fullName: string;
    phone: string;
    email?: string;
    address: string;
  };
};

function shouldRetryQueueItem(error: unknown) {
  if (!axios.isAxiosError(error)) {
    const message = String((error as { message?: string })?.message ?? "").toLowerCase();
    if (
      message.includes("unable to read selected file") ||
      message.includes("no such file") ||
      message.includes("cannot find file") ||
      message.includes("file not found")
    ) {
      return false;
    }
    return true;
  }

  if (!error.response) {
    const code = error.code?.toUpperCase();
    if (code === "ERR_NETWORK" || code === "ECONNABORTED" || code === "ETIMEDOUT") {
      return true;
    }
    return true;
  }

  const status = error.response.status;
  return status >= 500 || status === 429 || status === 408;
}

function extractQueueErrorMessage(error: unknown) {
  if (!axios.isAxiosError(error)) {
    return (error as { message?: string })?.message || "Queue sync failed";
  }
  const responseMessage = (error.response?.data as { message?: string } | undefined)?.message;
  if (typeof responseMessage === "string" && responseMessage.trim().length > 0) {
    return responseMessage.trim();
  }
  return error.message || "Queue sync failed";
}

function isInsufficientRoleError(error: unknown) {
  if (!axios.isAxiosError(error)) return false;
  if (error.response?.status !== 403) return false;
  const message = String((error.response?.data as { message?: string } | undefined)?.message ?? "")
    .toLowerCase()
    .trim();
  return message.includes("insufficient role") || message.includes("forbidden");
}

function shouldFallbackToPublicLead(error: unknown) {
  if (!axios.isAxiosError(error)) return false;
  const status = error.response?.status;
  if (!status) return false;
  return status === 403 || status === 404 || status >= 500;
}

function toPublicLeadPayload(raw: unknown) {
  const value = (raw ?? {}) as Partial<QueueLeadPayload>;
  const customer: Partial<QueueLeadPayload["customer"]> = value.customer ?? {};

  return {
    name: customer.fullName,
    phone: customer.phone,
    email: customer.email,
    districtId: value.districtId,
    installationType: value.source,
    message: customer.address
  };
}

function isValidPublicLeadPayload(payload: Record<string, unknown>) {
  return (
    typeof payload.name === "string" &&
    payload.name.trim().length >= 2 &&
    typeof payload.phone === "string" &&
    payload.phone.trim().length >= 8 &&
    typeof payload.districtId === "string" &&
    payload.districtId.trim().length > 0
  );
}

async function createLeadWithRoleFallback(rawLeadPayload: unknown) {
  try {
    const leadResp = await api.post("/api/leads", rawLeadPayload);
    return leadResp.data?.data?.id as string;
  } catch (error) {
    if (!isInsufficientRoleError(error) && !shouldFallbackToPublicLead(error)) {
      throw error;
    }

    const publicPayload = toPublicLeadPayload(rawLeadPayload);
    if (!isValidPublicLeadPayload(publicPayload as Record<string, unknown>)) {
      throw new Error("Invalid queued lead payload");
    }

    const leadResp = await api.post("/public/leads", publicPayload);
    return leadResp.data?.data?.id as string;
  }
}

function normalizeQueueItem(
  item: QueueItem,
  options?: QueueEnqueueOptions
): QueueItem {
  const ownerUserId =
    options?.ownerUserId ??
    item.ownerUserId;
  const dedupeKey = options?.dedupeKey ?? item.dedupeKey;

  return {
    ...item,
    ownerUserId,
    dedupeKey,
    failCount: item.failCount ?? 0,
    lastError: item.lastError,
    retryable: item.retryable ?? true
  };
}

async function prepareQueueItemForPersistence(item: QueueItem): Promise<QueueItem> {
  if (item.kind === "UPLOAD_LEAD_DOCUMENT") {
    const persistentFile = await ensurePersistentLeadDocumentFile(item.payload.file);
    return {
      ...item,
      payload: {
        ...item.payload,
        file: persistentFile
      }
    };
  }

  if (item.kind === "CREATE_LEAD_WITH_ATTACHMENTS") {
    const persistentAttachments: LeadAttachment[] = [];
    for (const file of item.payload.attachments) {
      const persistentFile = await ensurePersistentLeadAttachmentFile(file);
      persistentAttachments.push(persistentFile);
    }
    return {
      ...item,
      payload: {
        ...item.payload,
        attachments: persistentAttachments
      }
    };
  }

  return item;
}

export const useQueueStore = create<QueueState>((set, get) => ({
  items: [],
  hydrate: async () => {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) {
      set({ items: [] });
      return;
    }

    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        const items = (parsed as QueueItem[]).map((item) => normalizeQueueItem(item));
        set({ items });
        return;
      }
      set({ items: [] });
      await AsyncStorage.removeItem(KEY);
    } catch {
      // Corrupted queue should not crash app boot.
      set({ items: [] });
      await AsyncStorage.removeItem(KEY);
    }
  },
  enqueue: async (item, options) => {
    const preparedItem = await prepareQueueItemForPersistence(item);
    const normalized = normalizeQueueItem(preparedItem, options);
    const nextBase = [...get().items];

    const next =
      normalized.dedupeKey && normalized.ownerUserId
        ? nextBase.filter(
            (existing) =>
              !(
                existing.ownerUserId === normalized.ownerUserId &&
                existing.dedupeKey &&
                existing.dedupeKey === normalized.dedupeKey
              )
          )
        : nextBase;

    next.push(normalized);
    set({ items: next });
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
  },
  remove: async (id) => {
    const next = get().items.filter((item) => item.id !== id);
    set({ items: next });
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
  },
  flush: async (ownerUserId) => {
    if (!ownerUserId) {
      return;
    }

    const pending = [...get().items];
    const untouched: QueueItem[] = [];
    const failed: QueueItem[] = [];

    for (const item of pending) {
      if (item.ownerUserId && item.ownerUserId !== ownerUserId) {
        untouched.push(item);
        continue;
      }

      if (item.retryable === false) {
        failed.push(item);
        continue;
      }

      try {
        if (item.kind === "CREATE_LEAD_WITH_ATTACHMENTS") {
          const leadId = await createLeadWithRoleFallback(item.payload.lead);
          if (!leadId) {
            throw new Error("Lead id missing from queued create response");
          }

          for (const file of item.payload.attachments) {
            await uploadLeadDocument({
              leadId,
              category: "lead_attachment",
              file: {
                uri: file.uri,
                fileName: file.fileName,
                fileType: file.mimeType,
                fileSize: file.sizeBytes
              },
              maxAttempts: 2
            });
            await cleanupPersistentUploadUri(file.uri);
          }
        } else if (item.kind === "UPLOAD_LEAD_DOCUMENT") {
          await uploadLeadDocument({
            leadId: item.payload.leadId,
            category: item.payload.category,
            file: item.payload.file,
            maxAttempts: 2
          });
          await cleanupPersistentUploadUri(item.payload.file.uri);
        } else if (item.kind === "UPDATE_LEAD_STATUS") {
          await api.post(`/api/leads/${item.payload.leadId}/transition`, {
            nextStatusId: item.payload.nextStatusId,
            notes: item.payload.notes,
            overrideReason: item.payload.overrideReason
          });
        } else if (item.kind === "UPSERT_CUSTOMER_DETAILS") {
          await api.put(`/api/leads/${item.payload.leadId}/customer-details`, item.payload.data);
        }
      } catch (error) {
        const retryable = shouldRetryQueueItem(error);
        failed.push({
          ...item,
          failCount: (item.failCount ?? 0) + 1,
          lastError: extractQueueErrorMessage(error),
          retryable
        });
      }
    }

    const next = [...untouched, ...failed];
    set({ items: next });
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
  },
  clearByOwner: async (ownerUserId) => {
    const next = get().items.filter((item) => item.ownerUserId !== ownerUserId);
    set({ items: next });
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
  }
}));
