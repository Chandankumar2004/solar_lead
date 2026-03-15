import { api } from "./api";

export type LeadDocumentUploadFile = {
  uri: string;
  fileName: string;
  fileType: string;
  fileSize: number;
};

type UploadProgressCallback = (progressPercent: number) => void;

type UploadLeadDocumentInput = {
  leadId: string;
  category: string;
  file: LeadDocumentUploadFile;
  onProgress?: UploadProgressCallback;
  maxAttempts?: number;
};

const MAX_DOCUMENT_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png"
]);

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeCategory(category: string) {
  const normalized = category.trim().toLowerCase().replace(/\s+/g, "_");
  if (normalized.length >= 2) {
    return normalized.slice(0, 80);
  }
  return "general";
}

function inferMimeType(fileName: string, fileType?: string) {
  if (fileType && fileType !== "application/octet-stream") {
    const normalized = fileType.toLowerCase();
    if (ALLOWED_MIME_TYPES.has(normalized)) {
      return normalized;
    }
  }

  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  return "image/jpeg";
}

function extractErrorMessage(error: unknown, fallback: string) {
  const value = error as {
    response?: { data?: { message?: string } };
    message?: string;
  };
  return value?.response?.data?.message || value?.message || fallback;
}

async function readBlobFromUri(uri: string) {
  const response = await fetch(uri);
  if (!response.ok) {
    throw new Error("Unable to read selected file from local device.");
  }
  return response.blob();
}

function validateUploadFile(fileType: string, fileSize: number) {
  if (!ALLOWED_MIME_TYPES.has(fileType)) {
    throw new Error("Unsupported file type. Only JPEG, PNG, and PDF are allowed.");
  }
  if (fileSize > MAX_DOCUMENT_SIZE_BYTES) {
    throw new Error("File size must be 10 MB or smaller.");
  }
}

async function uploadBlobToSignedUrl(
  uploadUrl: string,
  fileType: string,
  blob: Blob,
  onProgress?: UploadProgressCallback
) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl);
    xhr.setRequestHeader("Content-Type", fileType);

    xhr.upload.onprogress = (event) => {
      if (!onProgress || !event.lengthComputable) return;
      const ratio = event.total > 0 ? event.loaded / event.total : 0;
      onProgress(Math.max(1, Math.min(99, Math.round(ratio * 100))));
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        if (onProgress) onProgress(100);
        resolve();
        return;
      }
      reject(new Error(`Storage upload failed (${xhr.status})`));
    };

    xhr.onerror = () => {
      reject(new Error("Storage upload failed due to network error."));
    };

    xhr.onabort = () => {
      reject(new Error("Storage upload was aborted."));
    };

    xhr.send(blob);
  });
}

export async function uploadLeadDocument(input: UploadLeadDocumentInput) {
  const maxAttempts = input.maxAttempts ?? 2;
  const category = normalizeCategory(input.category);
  const fileType = inferMimeType(input.file.fileName, input.file.fileType);
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      if (input.onProgress) input.onProgress(1);

      const blob = await readBlobFromUri(input.file.uri);
      const resolvedFileSize =
        input.file.fileSize && input.file.fileSize > 0 ? input.file.fileSize : blob.size;
      validateUploadFile(fileType, resolvedFileSize);

      const presignResp = await api.post(`/api/leads/${input.leadId}/documents/presign`, {
        category,
        fileName: input.file.fileName,
        fileType,
        fileSize: resolvedFileSize
      });

      const uploadUrl = presignResp.data?.data?.uploadUrl as string | undefined;
      const storagePath =
        (presignResp.data?.data?.storagePath as string | undefined) ??
        (presignResp.data?.data?.s3Key as string | undefined);
      if (!uploadUrl || !storagePath) {
        throw new Error("Invalid presign response from server.");
      }

      await uploadBlobToSignedUrl(uploadUrl, fileType, blob, input.onProgress);

      const completeResp = await api.post(`/api/leads/${input.leadId}/documents/complete`, {
        category,
        storagePath,
        s3Key: storagePath,
        fileName: input.file.fileName,
        fileType,
        fileSize: resolvedFileSize
      });

      return completeResp.data?.data;
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        await delay(attempt * 600);
      }
    }
  }

  throw new Error(
    extractErrorMessage(lastError, "Unable to upload document after retries.")
  );
}
