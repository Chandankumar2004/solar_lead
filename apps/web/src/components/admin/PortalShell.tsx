"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { ADMIN_NAV_ITEMS, hasRouteAccess, pageTitle } from "@/lib/rbac";
import { getSupabaseBrowserClient } from "@/lib/supabase";

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
    const allowed = hasRouteAccess(pathname, user.role);
    setForbidden(!allowed);
    if (!allowed) {
      router.replace("/dashboard");
    }
  }, [pathname, router, user]);

  const navItems = useMemo(() => {
    if (!user) return [];
    return ADMIN_NAV_ITEMS.filter((item) => item.roles.includes(user.role));
  }, [user]);

  const onLogout = async () => {
    const supabase = getSupabaseBrowserClient();
    try {
      await api.post("/api/auth/logout");
    } catch {
      // Ignore backend failures and clear browser auth state.
    }
    try {
      await supabase?.auth.signOut();
    } finally {
      setUser(null);
      router.replace("/login");
    }
  };

  if (loading || !user) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-100">
        <p className="text-sm text-slate-600">Loading admin portal...</p>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <div className="mx-auto grid min-h-screen max-w-[1600px] grid-cols-1 md:grid-cols-[250px_1fr]">
        <aside className="hidden border-r border-slate-200 bg-white md:block">
          <div className="border-b border-slate-200 px-5 py-4">
            <h1 className="text-lg font-semibold text-brand-700">Solar Admin</h1>
            <p className="mt-1 text-xs text-slate-500">{user.roleLabel}</p>
          </div>
          <nav className="space-y-1 px-3 py-3">
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
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </aside>
        <section className="flex min-h-screen flex-col">
          <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 md:px-6">
            <div>
              <h2 className="text-lg font-semibold">{pageTitle(pathname)}</h2>
              <p className="text-xs text-slate-500">{user.fullName}</p>
            </div>
            <button
              onClick={onLogout}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Logout
            </button>
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
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <main className="flex-1 p-4 md:p-6">
            {forbidden ? (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
                You are not allowed to access this page with role {user.roleLabel}.
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
