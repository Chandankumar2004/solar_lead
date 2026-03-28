"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  WEB_LANGUAGE_OPTIONS,
  WEB_DEFAULT_LANGUAGE,
  WebLanguage,
  webTranslations
} from "./translations";

const STORAGE_KEY = "solar.web.language";

type TranslateParams = Record<string, string | number>;

type I18nContextValue = {
  language: WebLanguage;
  locale: string;
  setLanguage: (language: WebLanguage) => void;
  t: (key: string, params?: TranslateParams) => string;
  formatDateTime: (value: string | number | Date) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function isSupportedLanguage(value: unknown): value is WebLanguage {
  return WEB_LANGUAGE_OPTIONS.some((option) => option.value === value);
}

function applyParams(template: string, params?: TranslateParams) {
  if (!params) return template;
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (raw, key: string) => {
    if (!(key in params)) return raw;
    return String(params[key]);
  });
}

function localeForLanguage(language: WebLanguage) {
  if (language === "hi") return "hi-IN";
  if (language === "mr") return "mr-IN";
  return "en-IN";
}

export function WebI18nProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<WebLanguage>(WEB_DEFAULT_LANGUAGE);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (isSupportedLanguage(raw)) {
        setLanguageState(raw);
      }
    } catch {
      // Ignore localStorage failures.
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, language);
    } catch {
      // Ignore localStorage failures.
    }
  }, [language]);

  const value = useMemo<I18nContextValue>(() => {
    const locale = localeForLanguage(language);
    return {
      language,
      locale,
      setLanguage: (nextLanguage) => {
        setLanguageState(nextLanguage);
      },
      t: (key, params) => {
        const selected = webTranslations[language] ?? webTranslations[WEB_DEFAULT_LANGUAGE];
        const fallback = webTranslations[WEB_DEFAULT_LANGUAGE];
        const base = selected[key] ?? fallback[key] ?? key;
        return applyParams(base, params);
      },
      formatDateTime: (value) => {
        const date = value instanceof Date ? value : new Date(value);
        if (Number.isNaN(date.getTime())) return String(value);
        return date.toLocaleString(locale);
      }
    };
  }, [language]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useWebI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useWebI18n must be used inside WebI18nProvider");
  }
  return context;
}
