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
    api
      .get("/api/auth/me")
      .then((response) => {
        if (!active) return;
        const user = response.data?.data?.user ?? null;
        if (user) {
          setUser(user);
          router.replace("/dashboard");
        }
      })
      .catch(() => undefined);
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
