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
  const key = (rawSiteKey ?? "").trim();
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
