import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system";
import { api } from "./api";

const CACHE_PREFIX = "mobile.document.cache.v1";

export type CachedDocument = {
  documentId: string;
  leadId: string;
  fileName: string;
  fileType: string;
  localUri: string;
  cachedAt: string;
};

function buildCacheKey(ownerUserId: string, documentId: string) {
  return `${CACHE_PREFIX}:${ownerUserId}:${documentId}`;
}

function sanitizeFileName(fileName: string) {
  const trimmed = fileName.trim();
  if (!trimmed) return "document";
  return trimmed.replace(/[^a-zA-Z0-9._-]/g, "_");
}

async function persistCachedDocument(ownerUserId: string, cached: CachedDocument) {
  await AsyncStorage.setItem(buildCacheKey(ownerUserId, cached.documentId), JSON.stringify(cached));
}

export async function getCachedDocument(
  ownerUserId: string,
  documentId: string
): Promise<CachedDocument | null> {
  if (!ownerUserId) return null;
  const raw = await AsyncStorage.getItem(buildCacheKey(ownerUserId, documentId));
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as CachedDocument;
    if (!parsed?.localUri) {
      return null;
    }
    const info = await FileSystem.getInfoAsync(parsed.localUri);
    if (!info.exists) {
      await AsyncStorage.removeItem(buildCacheKey(ownerUserId, documentId));
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function downloadAndCacheDocument(
  ownerUserId: string,
  documentId: string
): Promise<CachedDocument> {
  if (!ownerUserId) {
    throw new Error("Missing user session for document download.");
  }

  const response = await api.get(`/api/documents/${documentId}/download-url`);
  const payload = response.data?.data as {
    documentId?: string;
    leadId?: string;
    fileName?: string;
    fileType?: string;
    downloadUrl?: string;
  };

  if (!payload?.downloadUrl) {
    throw new Error("Download URL is unavailable for this document.");
  }

  const safeFileName = sanitizeFileName(payload.fileName ?? `document-${documentId}`);
  const baseDir = `${FileSystem.cacheDirectory ?? ""}documents/${ownerUserId}/`;
  await FileSystem.makeDirectoryAsync(baseDir, { intermediates: true });
  const localUri = `${baseDir}${documentId}-${safeFileName}`;

  const downloadResult = await FileSystem.downloadAsync(payload.downloadUrl, localUri);
  const cached: CachedDocument = {
    documentId: payload.documentId ?? documentId,
    leadId: payload.leadId ?? "",
    fileName: payload.fileName ?? safeFileName,
    fileType: payload.fileType ?? "",
    localUri: downloadResult.uri,
    cachedAt: new Date().toISOString()
  };

  await persistCachedDocument(ownerUserId, cached);
  return cached;
}

export async function clearDocumentCacheForOwner(ownerUserId: string) {
  if (!ownerUserId) return;
  const keys = await AsyncStorage.getAllKeys();
  const toRemove = keys.filter((key) => key.startsWith(`${CACHE_PREFIX}:${ownerUserId}:`));
  if (toRemove.length > 0) {
    await AsyncStorage.multiRemove(toRemove);
  }
}
