"use client";

import { WebI18nProvider } from "@/lib/i18n/provider";

export function AppProviders({ children }: { children: React.ReactNode }) {
  return <WebI18nProvider>{children}</WebI18nProvider>;
}

