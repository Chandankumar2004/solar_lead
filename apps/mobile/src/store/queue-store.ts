import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import axios from "axios";
import { api } from "../services/api";
import { uploadLeadDocument } from "../services/document-upload";
import type { LeadDocumentUploadFile } from "../services/document-upload";

const KEY = "offline_queue";

type LeadAttachment = {
  uri: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
};

type CreateLeadWithAttachmentsQueueItem = {
  id: string;
  kind: "CREATE_LEAD_WITH_ATTACHMENTS";
  payload: {
    lead: unknown;
    attachments: LeadAttachment[];
  };
};

type UploadLeadDocumentQueueItem = {
  id: string;
  kind: "UPLOAD_LEAD_DOCUMENT";
  payload: {
    leadId: string;
    category: string;
    file: LeadDocumentUploadFile;
  };
};

export type QueueItem =
  | CreateLeadWithAttachmentsQueueItem
  | UploadLeadDocumentQueueItem;

type QueueState = {
  items: QueueItem[];
  hydrate: () => Promise<void>;
  enqueue: (item: QueueItem) => Promise<void>;
  remove: (id: string) => Promise<void>;
  flush: () => Promise<void>;
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

export const useQueueStore = create<QueueState>((set, get) => ({
  items: [],
  hydrate: async () => {
    const raw = await AsyncStorage.getItem(KEY);
    set({ items: raw ? (JSON.parse(raw) as QueueItem[]) : [] });
  },
  enqueue: async (item) => {
    const next = [...get().items, item];
    set({ items: next });
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
  },
  remove: async (id) => {
    const next = get().items.filter((item) => item.id !== id);
    set({ items: next });
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
  },
  flush: async () => {
    const pending = [...get().items];
    const failed: QueueItem[] = [];
    for (const item of pending) {
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
          }
        } else if (item.kind === "UPLOAD_LEAD_DOCUMENT") {
          await uploadLeadDocument({
            leadId: item.payload.leadId,
            category: item.payload.category,
            file: item.payload.file,
            maxAttempts: 2
          });
        }
      } catch (error) {
        if (shouldRetryQueueItem(error)) {
          failed.push(item);
        }
      }
    }
    set({ items: failed });
    await AsyncStorage.setItem(KEY, JSON.stringify(failed));
  }
}));
