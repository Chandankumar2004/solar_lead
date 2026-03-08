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

export type GrecaptchaClient = {
  ready(cb: () => void): void;
  execute(siteKey: string, options: { action: string }): Promise<string>;
};

declare global {
  interface Window {
    grecaptcha?: GrecaptchaClient;
  }
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
