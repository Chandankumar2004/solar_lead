import { env } from "../config/env.js";

const RECAPTCHA_VERIFY_ENDPOINT = "https://www.google.com/recaptcha/api/siteverify";

function stripWrappingQuotes(raw: string) {
  const trimmed = raw.trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

type RecaptchaErrorReason =
  | "SECRET_MISSING"
  | "TOKEN_MISSING"
  | "VERIFY_REQUEST_FAILED"
  | "VERIFY_RESPONSE_INVALID"
  | "TOKEN_INVALID"
  | "ACTION_MISMATCH";

export type VerifyRecaptchaResult =
  | {
      ok: true;
      score: number | null;
      action: string | null;
    }
  | {
      ok: false;
      reason: RecaptchaErrorReason;
      errorCodes: string[];
      score: number | null;
      action: string | null;
    };

export function resolveRecaptchaSecret() {
  const secret = stripWrappingQuotes(
    env.RECAPTCHA_SECRET_KEY ??
    env.GOOGLE_RECAPTCHA_SECRET_KEY ??
    process.env.RECAPTCHA_SECRET ??
    process.env.GOOGLE_RECAPTCHA_SECRET ??
    process.env.RECAPTCHA_SECRET_KEY ??
    process.env.GOOGLE_RECAPTCHA_SECRET_KEY ??
    ""
  );

  return secret.length > 0 ? secret : null;
}

export async function verifyRecaptchaToken(params: {
  token: string | null | undefined;
  expectedAction?: string;
  remoteIp?: string | null;
}): Promise<VerifyRecaptchaResult> {
  const token = (params.token ?? "").trim();
  if (!token) {
    return {
      ok: false,
      reason: "TOKEN_MISSING",
      errorCodes: [],
      score: null,
      action: null
    };
  }

  const secret = resolveRecaptchaSecret();
  if (!secret) {
    return {
      ok: false,
      reason: "SECRET_MISSING",
      errorCodes: [],
      score: null,
      action: null
    };
  }

  const form = new URLSearchParams();
  form.set("secret", secret);
  form.set("response", token);
  if (params.remoteIp?.trim()) {
    form.set("remoteip", params.remoteIp.trim());
  }

  let response: Response;
  try {
    response = await fetch(RECAPTCHA_VERIFY_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: form.toString()
    });
  } catch {
    return {
      ok: false,
      reason: "VERIFY_REQUEST_FAILED",
      errorCodes: [],
      score: null,
      action: null
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      reason: "VERIFY_REQUEST_FAILED",
      errorCodes: [],
      score: null,
      action: null
    };
  }

  type RecaptchaVerifyResponse = {
    success?: boolean;
    score?: number;
    action?: string;
    "error-codes"?: string[];
  };

  let payload: RecaptchaVerifyResponse;
  try {
    payload = (await response.json()) as RecaptchaVerifyResponse;
  } catch {
    return {
      ok: false,
      reason: "VERIFY_RESPONSE_INVALID",
      errorCodes: [],
      score: null,
      action: null
    };
  }

  const score = typeof payload.score === "number" ? payload.score : null;
  const action = typeof payload.action === "string" ? payload.action : null;
  const errorCodes = Array.isArray(payload["error-codes"])
    ? payload["error-codes"].filter((value): value is string => typeof value === "string")
    : [];

  if (!payload.success) {
    return {
      ok: false,
      reason: "TOKEN_INVALID",
      errorCodes,
      score,
      action
    };
  }

  if (params.expectedAction && action && action !== params.expectedAction) {
    return {
      ok: false,
      reason: "ACTION_MISMATCH",
      errorCodes,
      score,
      action
    };
  }

  return {
    ok: true,
    score,
    action
  };
}
