"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import axios from "axios";
import Script from "next/script";
import { loginSchema } from "@solar/shared";
import { api, getApiErrorMessage } from "@/lib/api";
import { resolveRecaptchaSiteKey } from "@/lib/recaptcha";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/lib/auth-store";

type LoginValues = z.infer<typeof loginSchema>;

export function LoginForm() {
  const [error, setError] = useState<string | null>(null);
  const [recaptchaScriptFailed, setRecaptchaScriptFailed] = useState(false);
  const router = useRouter();
  const setUser = useAuthStore((s) => s.setUser);
  const rawRecaptchaSiteKey =
    process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY ??
    process.env.NEXT_PUBLIC_GOOGLE_RECAPTCHA_SITE_KEY ??
    process.env.NEXT_PUBLIC_RECAPTCHA_SITEKEY;
  const recaptchaSiteKey = resolveRecaptchaSiteKey(rawRecaptchaSiteKey);
  const recaptchaConfigInvalid = Boolean(rawRecaptchaSiteKey?.trim()) && !recaptchaSiteKey;
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting }
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema)
  });

  useEffect(() => {
    const rawKey = rawRecaptchaSiteKey?.trim() ?? "";
    if (!rawKey) {
      if (process.env.NODE_ENV === "production") {
        console.error("RECAPTCHA_CONFIG_ERROR", {
          reason: "SITE_KEY_MISSING",
          target: "ADMIN_LOGIN"
        });
      }
      return;
    }

    if (!recaptchaSiteKey) {
      console.error("RECAPTCHA_CONFIG_ERROR", {
        reason: "SITE_KEY_INVALID_OR_PLACEHOLDER",
        target: "ADMIN_LOGIN"
      });
    }
  }, [rawRecaptchaSiteKey, recaptchaSiteKey]);

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    if (process.env.NODE_ENV === "production" && !recaptchaSiteKey) {
      console.error("RECAPTCHA_CONFIG_ERROR", {
        reason: "SITE_KEY_MISSING_OR_INVALID",
        target: "ADMIN_LOGIN"
      });
      setError("reCAPTCHA is not configured. Please contact support.");
      return;
    }

    const getRecaptchaToken = async () => {
      if (!recaptchaSiteKey) {
        return null;
      }

      if (recaptchaScriptFailed) {
        console.error("RECAPTCHA_CONFIG_ERROR", {
          reason: "SCRIPT_LOAD_FAILED",
          target: "ADMIN_LOGIN"
        });
        return null;
      }

      if (typeof window === "undefined") {
        return null;
      }

      for (let attempt = 0; attempt < 15; attempt += 1) {
        if (window.grecaptcha) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      if (!window.grecaptcha) {
        console.error("RECAPTCHA_CONFIG_ERROR", {
          reason: "GRECAPTCHA_NOT_READY",
          target: "ADMIN_LOGIN"
        });
        return null;
      }

      try {
        await new Promise<void>((resolve) => {
          window.grecaptcha?.ready(() => resolve());
        });
        return window.grecaptcha.execute(recaptchaSiteKey, { action: "admin_login" });
      } catch (error) {
        console.error("RECAPTCHA_CONFIG_ERROR", {
          reason: "EXECUTE_FAILED",
          target: "ADMIN_LOGIN",
          error
        });
        return null;
      }
    };

    const recaptchaToken = await getRecaptchaToken();
    if (recaptchaSiteKey && !recaptchaToken) {
      setError("reCAPTCHA verification failed. Please refresh and try again.");
      return;
    }

    try {
      const resp = await api.post("/api/auth/login", {
        ...values,
        recaptcha_token: recaptchaToken ?? undefined
      });
      setUser(resp.data.data.user);
      router.push("/dashboard");
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.code === "ERR_NETWORK") {
          console.error("AUTH_LOGIN_ERROR", {
            reason: "NETWORK_OR_CORS",
            apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL ?? null
          });
        } else {
          console.error("AUTH_LOGIN_ERROR", {
            reason: "LOGIN_REQUEST_FAILED",
            status: error.response?.status ?? null,
            code: error.response?.data?.error?.code ?? null,
            message: error.response?.data?.message ?? null
          });
        }
      }
      setError(getApiErrorMessage(error, "Login failed"));
    }
  });

  return (
    <>
      {recaptchaSiteKey ? (
        <Script
          id="recaptcha-login-v3"
          src={`https://www.google.com/recaptcha/api.js?render=${recaptchaSiteKey}`}
          strategy="afterInteractive"
          onError={() => {
            setRecaptchaScriptFailed(true);
            console.error("RECAPTCHA_CONFIG_ERROR", {
              reason: "SCRIPT_LOAD_ERROR",
              target: "ADMIN_LOGIN"
            });
          }}
        />
      ) : null}
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
        {recaptchaConfigInvalid ? (
          <p className="text-xs text-amber-700">
            reCAPTCHA site key is invalid. Set a valid `NEXT_PUBLIC_RECAPTCHA_SITE_KEY`.
          </p>
        ) : null}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          disabled={isSubmitting}
          className="w-full rounded bg-brand-600 px-4 py-2 font-medium text-white hover:bg-brand-700"
        >
          {isSubmitting ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </>
  );
}
