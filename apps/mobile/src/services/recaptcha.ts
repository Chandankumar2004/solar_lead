import Constants from "expo-constants";

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

export function resolveRecaptchaSiteKey(rawSiteKey: string | undefined) {
  const key = stripWrappingQuotes(rawSiteKey ?? "");
  if (!key) {
    return null;
  }

  const normalized = key.toLowerCase();
  const isPlaceholder =
    normalized === "recaptcha_site_key" ||
    normalized.includes("replace_with") ||
    normalized.includes("your_recaptcha") ||
    normalized.includes("site_key");

  if (isPlaceholder) {
    return null;
  }

  return key;
}

export const recaptchaSiteKey = resolveRecaptchaSiteKey(
  process.env.EXPO_PUBLIC_RECAPTCHA_SITE_KEY ??
    process.env.EXPO_PUBLIC_GOOGLE_RECAPTCHA_SITE_KEY ??
    process.env.EXPO_PUBLIC_RECAPTCHA_SITEKEY
);

export const recaptchaLoginAction = "admin_login";

export const recaptchaBypassToken = "dev-bypass";

export function isExpoGo() {
  return Constants.appOwnership === "expo";
}

export const recaptchaBypassEnabled = __DEV__ && isExpoGo();
