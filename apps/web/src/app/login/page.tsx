"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { LoginForm } from "@/components/LoginForm";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";

export default function LoginPage() {
  const router = useRouter();
  const setUser = useAuthStore((state) => state.setUser);

  useEffect(() => {
    let active = true;
    const run = async () => {
      try {
        const response = await api.get("/api/auth/me");
        if (!active) return;
        const user = response.data?.data?.user ?? null;
        if (user) {
          setUser(user);
          router.replace("/dashboard");
        }
      } catch {
        // No active session cookie.
      }
    };
    void run();
    return () => {
      active = false;
    };
  }, [router, setUser]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 p-4 sm:p-6">
      <div className="w-full max-w-md sm:max-w-lg">
        <LoginForm />
      </div>
    </main>
  );
}
