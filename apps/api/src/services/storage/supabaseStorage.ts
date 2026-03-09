import { createClient } from "@supabase/supabase-js";
import { env } from "../../config/env.js";
import { AppError } from "../../lib/errors.js";

export const STORAGE_BUCKET_NAME = "documents";

const supabaseUrl = env.SUPABASE_URL;
const supabaseServiceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false
  }
});

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
  const { data, error } = await supabaseAdmin.storage
    .from(STORAGE_BUCKET_NAME)
    .createSignedUploadUrl(path);

  const signedUrl = pickSignedUrl(data);
  if (error || !signedUrl) {
    throw new AppError(500, "STORAGE_UPLOAD_URL_ERROR", "Unable to generate upload URL");
  }

  return toAbsoluteStorageUrl(signedUrl);
}

export async function createDocumentDownloadUrl(path: string, expiresInSeconds: number) {
  const { data, error } = await supabaseAdmin.storage
    .from(STORAGE_BUCKET_NAME)
    .createSignedUrl(path, expiresInSeconds);

  const signedUrl = pickSignedUrl(data);
  if (error || !signedUrl) {
    throw new AppError(500, "STORAGE_DOWNLOAD_URL_ERROR", "Unable to generate download URL");
  }

  return toAbsoluteStorageUrl(signedUrl);
}
