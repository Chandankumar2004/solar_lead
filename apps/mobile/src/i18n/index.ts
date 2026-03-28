import { useCallback, useMemo } from "react";
import { usePreferencesStore } from "../store/preferences-store";
import { MOBILE_DEFAULT_LANGUAGE, mobileTranslations } from "./translations";
import type { MobileLanguage } from "../store/preferences-store";

type TranslateParams = Record<string, string | number>;

function applyParams(template: string, params?: TranslateParams) {
  if (!params) return template;
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (raw, key: string) => {
    if (!(key in params)) return raw;
    return String(params[key]);
  });
}

function localeForLanguage(language: MobileLanguage) {
  if (language === "hi") return "hi-IN";
  if (language === "mr") return "mr-IN";
  return "en-IN";
}

export function useMobileI18n() {
  const language = usePreferencesStore((state) => state.language);
  const locale = useMemo(() => localeForLanguage(language), [language]);

  const t = useCallback(
    (key: string, params?: TranslateParams) => {
      const selected =
        mobileTranslations[language] ?? mobileTranslations[MOBILE_DEFAULT_LANGUAGE];
      const fallback = mobileTranslations[MOBILE_DEFAULT_LANGUAGE];
      const base = selected[key] ?? fallback[key] ?? key;
      return applyParams(base, params);
    },
    [language]
  );

  const formatDateTime = useCallback(
    (value: string | number | Date) => {
      const date = value instanceof Date ? value : new Date(value);
      if (Number.isNaN(date.getTime())) return String(value);
      return date.toLocaleString(locale);
    },
    [locale]
  );

  const formatNumber = useCallback(
    (value: number) => {
      return new Intl.NumberFormat(locale).format(value);
    },
    [locale]
  );

  return useMemo(
    () => ({ language, locale, t, formatDateTime, formatNumber }),
    [formatDateTime, formatNumber, language, locale, t]
  );
}
