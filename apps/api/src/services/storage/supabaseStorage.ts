import { createClient } from "@supabase/supabase-js";
import { env } from "../../config/env.js";
import { AppError } from "../../lib/errors.js";

export const STORAGE_BUCKET_NAME = env.SUPABASE_DOCUMENTS_BUCKET;

const supabaseUrl = env.SUPABASE_URL;
const supabaseServiceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false
  }
});

function normalizeStoragePath(path: string) {
  return path.trim().replace(/^\/+/, "");
}

function toAbsoluteStorageUrl(url: string) {
  if (/^https?:\/\//i.test(url)) {
    return url;
  }
  if (url.startsWith("/storage/")) {
    return `${supabaseUrl}${url}`;
  }
  if (url.startsWith("storage/")) {
    return `${supabaseUrl}/${url}`;
  }
  if (url.startsWith("/object/")) {
    return `${supabaseUrl}/storage/v1${url}`;
  }
  if (url.startsWith("object/")) {
    return `${supabaseUrl}/storage/v1/${url}`;
  }
  return `${supabaseUrl}${url.startsWith("/") ? "" : "/"}${url}`;
}

function pickSignedUrl(data: unknown) {
  if (!data || typeof data !== "object") {
    return null;
  }
  const maybe = data as { signedUrl?: unknown; signedURL?: unknown };
  if (typeof maybe.signedUrl === "string" && maybe.signedUrl.length > 0) {
    return maybe.signedUrl;
  }
  if (typeof maybe.signedURL === "string" && maybe.signedURL.length > 0) {
    return maybe.signedURL;
  }
  return null;
}

export async function createDocumentUploadUrl(path: string) {
  const normalizedPath = normalizeStoragePath(path);
  const { data, error } = await supabaseAdmin.storage
    .from(STORAGE_BUCKET_NAME)
    .createSignedUploadUrl(normalizedPath);

  const signedUrl = pickSignedUrl(data);
  if (error || !signedUrl) {
    throw new AppError(500, "STORAGE_UPLOAD_URL_ERROR", "Unable to generate upload URL");
  }

  return toAbsoluteStorageUrl(signedUrl);
}

export async function createDocumentDownloadUrl(path: string, expiresInSeconds: number) {
  const normalizedPath = normalizeStoragePath(path);
  const { data, error } = await supabaseAdmin.storage
    .from(STORAGE_BUCKET_NAME)
    .createSignedUrl(normalizedPath, expiresInSeconds);

  const signedUrl = pickSignedUrl(data);
  if (error || !signedUrl) {
    throw new AppError(500, "STORAGE_DOWNLOAD_URL_ERROR", "Unable to generate download URL");
  }

  return toAbsoluteStorageUrl(signedUrl);
}

export async function removeDocumentObject(path: string) {
  const normalizedPath = normalizeStoragePath(path);
  const { error } = await supabaseAdmin.storage
    .from(STORAGE_BUCKET_NAME)
    .remove([normalizedPath]);

  if (error) {
    throw new AppError(500, "STORAGE_DELETE_ERROR", "Unable to delete document from storage");
  }
}

async function storageObjectExists(path: string) {
  const normalizedPath = normalizeStoragePath(path);
  const parts = normalizedPath.split("/").filter(Boolean);
  if (parts.length < 2) {
    return false;
  }

  const fileName = parts.pop();
  if (!fileName) {
    return false;
  }
  const folder = parts.join("/");

  const { data, error } = await supabaseAdmin.storage
    .from(STORAGE_BUCKET_NAME)
    .list(folder, {
      search: fileName,
      limit: 100
    });

  if (error) {
    throw new AppError(500, "STORAGE_LIST_ERROR", "Unable to verify uploaded file");
  }

  return (data ?? []).some((item) => item.name === fileName);
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function assertDocumentObjectExists(path: string) {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const exists = await storageObjectExists(path);
    if (exists) {
      return;
    }
    if (attempt < maxAttempts) {
      await wait(attempt * 200);
    }
  }

  throw new AppError(
    400,
    "STORAGE_OBJECT_NOT_FOUND",
    "Uploaded file not found in storage. Please upload again."
  );
}
