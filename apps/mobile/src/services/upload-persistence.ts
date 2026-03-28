import * as FileSystem from "expo-file-system";
import type { LeadDocumentUploadFile } from "./document-upload";

type LeadAttachmentFile = {
  uri: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
};

const UPLOAD_DIR_NAME = "queued_uploads";
const MANAGED_UPLOAD_DIR = `${FileSystem.documentDirectory ?? ""}${UPLOAD_DIR_NAME}`;

function sanitizeFileName(name: string) {
  const trimmed = name.trim();
  const fallback = `upload-${Date.now()}`;
  const safe = (trimmed || fallback).replace(/[^a-zA-Z0-9._-]+/g, "_");
  return safe.slice(0, 120) || fallback;
}

function buildManagedFileUri(fileName: string) {
  const unique = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  return `${MANAGED_UPLOAD_DIR}/${unique}-${sanitizeFileName(fileName)}`;
}

function shouldSkipCopy(uri: string) {
  if (!uri) return true;
  if (!FileSystem.documentDirectory) return true;
  if (uri.startsWith(MANAGED_UPLOAD_DIR)) return true;
  if (uri.startsWith("http://") || uri.startsWith("https://")) return true;
  if (uri.startsWith("data:")) return true;
  return false;
}

async function ensureManagedUploadDir() {
  await FileSystem.makeDirectoryAsync(MANAGED_UPLOAD_DIR, { intermediates: true });
}

async function copyIntoManagedLocation(uri: string, fileName: string) {
  const targetUri = buildManagedFileUri(fileName);
  await ensureManagedUploadDir();
  await FileSystem.copyAsync({ from: uri, to: targetUri });
  return targetUri;
}

function inferResolvedSize(value: unknown, fallback: number) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  return fallback;
}

async function resolveFileSize(uri: string, fallback: number) {
  try {
    const info = await FileSystem.getInfoAsync(uri, { size: true });
    if (!info.exists) return fallback;
    const size = inferResolvedSize((info as { size?: number }).size, fallback);
    return size;
  } catch {
    return fallback;
  }
}

export function isManagedUploadUri(uri: string) {
  return Boolean(uri) && uri.startsWith(MANAGED_UPLOAD_DIR);
}

export async function ensurePersistentLeadDocumentFile(file: LeadDocumentUploadFile) {
  if (!file?.uri || shouldSkipCopy(file.uri)) {
    return file;
  }

  try {
    const persistedUri = await copyIntoManagedLocation(file.uri, file.fileName);
    const resolvedSize = await resolveFileSize(persistedUri, file.fileSize);
    return {
      ...file,
      uri: persistedUri,
      fileSize: resolvedSize
    };
  } catch {
    // Copy failure should not block queueing; caller can still retry using original URI.
    return file;
  }
}

export async function ensurePersistentLeadAttachmentFile(file: LeadAttachmentFile) {
  if (!file?.uri || shouldSkipCopy(file.uri)) {
    return file;
  }

  try {
    const persistedUri = await copyIntoManagedLocation(file.uri, file.fileName);
    const resolvedSize = await resolveFileSize(persistedUri, file.sizeBytes);
    return {
      ...file,
      uri: persistedUri,
      sizeBytes: resolvedSize
    };
  } catch {
    // Copy failure should not block queueing; caller can still retry using original URI.
    return file;
  }
}

export async function cleanupPersistentUploadUri(uri?: string | null) {
  if (!uri || !isManagedUploadUri(uri)) {
    return;
  }

  try {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch {
    // Best-effort cleanup only.
  }
}

