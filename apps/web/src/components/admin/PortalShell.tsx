"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { ADMIN_NAV_ITEMS, hasRouteAccess, pageTitle } from "@/lib/rbac";
import { WebPushRegistrar } from "@/components/WebPushRegistrar";
import { useWebI18n } from "@/lib/i18n/provider";
import {
  WEB_DEFAULT_LANGUAGE,
  WEB_LANGUAGE_OPTIONS,
  WebLanguage
} from "@/lib/i18n/translations";

type PortalShellProps = {
  children: React.ReactNode;
};

export function PortalShell({ children }: PortalShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const user = useAuthStore((state) => state.user);
  const setUser = useAuthStore((state) => state.setUser);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const { language, setLanguage, t } = useWebI18n();

  useEffect(() => {
    let active = true;
    const run = async () => {
      try {
        const response = await api.get("/api/auth/me");
        if (!active) return;
        const nextUser = response.data?.data?.user ?? null;
        if (!nextUser) {
          router.replace("/login");
          return;
        }
        if (nextUser.role === "FIELD_EXECUTIVE") {
          setUser(null);
          router.replace("/login?error=portal_access_denied");
          return;
        }
        setUser(nextUser);
      } catch {
        if (!active) return;
        setUser(null);
        router.replace("/login");
        return;
      }
      if (active) {
        setLoading(false);
      }
    };
    void run();
    return () => {
      active = false;
    };
  }, [router, setUser]);

  useEffect(() => {
    if (!user) return;
    if (user.role === "FIELD_EXECUTIVE") {
      setForbidden(true);
      setUser(null);
      router.replace("/login?error=portal_access_denied");
      return;
    }
    const allowed = hasRouteAccess(pathname, user.role);
    setForbidden(!allowed);
    if (!allowed) {
      router.replace("/dashboard");
    }
  }, [pathname, router, setUser, user]);

  const navItems = useMemo(() => {
    if (!user) return [];
    return ADMIN_NAV_ITEMS.filter((item) => item.roles.includes(user.role));
  }, [user]);

  const onLogout = async () => {
    try {
      await api.post("/api/auth/logout");
    } catch {
      // Ignore backend failures and clear local user state.
    }
    setUser(null);
    router.replace("/login");
  };

  if (loading || !user) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-100">
        <p className="text-sm text-slate-600">{t("portal.loading")}</p>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <WebPushRegistrar />
      <div className="mx-auto grid min-h-screen max-w-[1600px] grid-cols-1 md:grid-cols-[250px_1fr]">
        <aside className="hidden border-r border-slate-200 bg-white md:sticky md:top-0 md:flex md:h-screen md:flex-col">
          <div className="border-b border-slate-200 px-5 py-4">
            <h1 className="text-lg font-semibold text-brand-700">{t("portal.brand")}</h1>
            <p className="mt-1 text-xs text-slate-500">{user.roleLabel}</p>
          </div>
          <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-3">
            {navItems.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`block rounded-md px-3 py-2 text-sm ${
                    active
                      ? "bg-brand-50 font-medium text-brand-700"
                      : "text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  {t(item.labelKey)}
                </Link>
              );
            })}
          </nav>
        </aside>
        <section className="flex min-h-screen min-w-0 flex-col">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-3 py-3 sm:px-4 md:px-6">
            <div className="min-w-0">
              <h2 className="break-words text-base font-semibold sm:text-lg">{t(pageTitle(pathname))}</h2>
              <p className="text-xs text-slate-500">{user.fullName}</p>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-500">{t("common.language")}</label>
              <select
                value={language}
                onChange={(event) =>
                  setLanguage(
                    WEB_LANGUAGE_OPTIONS.some((option) => option.value === event.target.value)
                      ? (event.target.value as WebLanguage)
                      : WEB_DEFAULT_LANGUAGE
                  )
                }
                className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700"
              >
                {WEB_LANGUAGE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <button
                onClick={onLogout}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                {t("common.logout")}
              </button>
            </div>
          </header>
          <nav className="flex gap-2 overflow-x-auto border-b border-slate-200 bg-white px-3 py-2 md:hidden">
            {navItems.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`whitespace-nowrap rounded-md px-3 py-1.5 text-xs ${
                    active ? "bg-brand-50 font-medium text-brand-700" : "text-slate-700"
                  }`}
                >
                  {t(item.labelKey)}
                </Link>
              );
            })}
          </nav>
          <main className="flex-1 p-3 sm:p-4 md:p-6">
            {forbidden ? (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
                {t("common.notAllowed", { role: user.roleLabel })}
              </div>
            ) : (
              children
            )}
          </main>
        </section>
      </div>
    </div>
  );
}
