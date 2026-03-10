"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { LoginForm } from "@/components/LoginForm";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { getSupabaseBrowserClient } from "@/lib/supabase";

export default function LoginPage() {
  const router = useRouter();
  const setUser = useAuthStore((state) => state.setUser);

  useEffect(() => {
    let active = true;
    const run = async () => {
      const supabase = getSupabaseBrowserClient();
      if (!supabase) {
        return;
      }

      const { data } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token;
      if (!accessToken) {
        return;
      }

      try {
        const response = await api.get("/api/auth/me", {
          headers: {
            Authorization: `Bearer ${accessToken}`
          }
        });
        if (!active) return;
        const user = response.data?.data?.user ?? null;
        if (user) {
          setUser(user);
          router.replace("/dashboard");
        }
      } catch {
        await supabase.auth.signOut();
      }
    };
    void run();
    return () => {
      active = false;
    };
  }, [router, setUser]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
      <div className="w-full max-w-md">
        <LoginForm />
      </div>
    </main>
  );
}
