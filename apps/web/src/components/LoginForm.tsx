"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import axios from "axios";
import { loginSchema } from "@solar/shared";
import { api, getApiErrorMessage } from "@/lib/api";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/lib/auth-store";

type LoginValues = z.infer<typeof loginSchema>;

export function LoginForm() {
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const setUser = useAuthStore((s) => s.setUser);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting }
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema)
  });

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      const resp = await api.post("/api/auth/login", values);
      setUser(resp.data.data.user);
      router.push("/dashboard");
    } catch (error) {
      if (axios.isAxiosError(error) && error.code === "ERR_NETWORK") {
        console.error("AUTH_LOGIN_ERROR", {
          reason: "NETWORK_OR_CORS",
          apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL ?? null
        });
      }
      setError(getApiErrorMessage(error, "Login failed"));
    }
  });

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-xl bg-white p-6 shadow">
      <h1 className="text-2xl font-semibold">Admin Login</h1>
      <div>
        <label className="mb-1 block text-sm font-medium">Email</label>
        <input
          className="w-full rounded border border-slate-300 px-3 py-2"
          {...register("email")}
        />
        {errors.email && <p className="mt-1 text-xs text-red-600">{errors.email.message}</p>}
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium">Password</label>
        <input
          type="password"
          className="w-full rounded border border-slate-300 px-3 py-2"
          {...register("password")}
        />
        {errors.password && (
          <p className="mt-1 text-xs text-red-600">{errors.password.message}</p>
        )}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        disabled={isSubmitting}
        className="w-full rounded bg-brand-600 px-4 py-2 font-medium text-white hover:bg-brand-700"
      >
        {isSubmitting ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}
