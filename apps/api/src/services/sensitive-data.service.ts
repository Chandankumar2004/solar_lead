import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "../config/env.js";

const ENCRYPTED_PREFIX = "enc:v1";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

let cachedKey: Buffer | null | undefined;

function decodeBase64Key(raw: string) {
  try {
    const key = Buffer.from(raw, "base64");
    if (key.length === 32) {
      return key;
    }
    return null;
  } catch {
    return null;
  }
}

function resolveSensitiveDataKey() {
  if (cachedKey !== undefined) {
    return cachedKey;
  }

  const configured = env.CUSTOMER_DATA_ENCRYPTION_KEY?.trim();
  const fallbackSecret =
    env.JWT_ACCESS_SECRET?.trim() ||
    env.JWT_REFRESH_SECRET?.trim() ||
    env.SUPABASE_SERVICE_ROLE_KEY.trim();
  const keySource = configured || fallbackSecret;

  if (!keySource) {
    cachedKey = null;
    return cachedKey;
  }

  const base64Key = decodeBase64Key(keySource);
  if (base64Key) {
    cachedKey = base64Key;
    return cachedKey;
  }

  cachedKey = createHash("sha256").update(keySource, "utf8").digest();
  return cachedKey;
}

export function isEncryptedSensitiveValue(value: string | null | undefined) {
  if (!value) {
    return false;
  }
  return value.startsWith(`${ENCRYPTED_PREFIX}:`);
}

export function encryptSensitiveValue(value: string | null | undefined) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  if (isEncryptedSensitiveValue(normalized)) {
    return normalized;
  }

  const key = resolveSensitiveDataKey();
  if (!key) {
    return normalized;
  }

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(normalized, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${ENCRYPTED_PREFIX}:${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

export function decryptSensitiveValue(value: string | null | undefined) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  if (!isEncryptedSensitiveValue(normalized)) {
    return normalized;
  }

  const key = resolveSensitiveDataKey();
  if (!key) {
    return null;
  }

  const parts = normalized.split(":");
  if (parts.length !== 5) {
    return null;
  }

  const ivRaw = parts[2];
  const tagRaw = parts[3];
  const encryptedRaw = parts[4];

  try {
    const iv = Buffer.from(ivRaw, "base64");
    const tag = Buffer.from(tagRaw, "base64");
    const encrypted = Buffer.from(encryptedRaw, "base64");

    if (iv.length !== IV_LENGTH || tag.length !== AUTH_TAG_LENGTH || encrypted.length === 0) {
      return null;
    }

    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    const plaintext = decrypted.toString("utf8").trim();
    return plaintext || null;
  } catch {
    return null;
  }
}
