"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import Script from "next/script";
import axios from "axios";
import { loginSchema } from "@solar/shared";
import { api, getApiErrorMessage } from "@/lib/api";
import { resolveRecaptchaSiteKey } from "@/lib/recaptcha";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/lib/auth-store";
import { useWebI18n } from "@/lib/i18n/provider";
import {
  WEB_DEFAULT_LANGUAGE,
  WEB_LANGUAGE_OPTIONS,
  WebLanguage
} from "@/lib/i18n/translations";

type LoginValues = z.infer<typeof loginSchema>;

function extractRecaptchaFailureMeta(error: unknown) {
  if (!axios.isAxiosError(error)) {
    return {
      retryable: false,
      browserError: false
    };
  }

  const errorCode = error.response?.data?.error?.code;
  const reason = error.response?.data?.error?.details?.reason;
  const rawErrorCodes = error.response?.data?.error?.details?.errorCodes;
  const errorCodes = Array.isArray(rawErrorCodes)
    ? rawErrorCodes
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.toLowerCase())
    : [];

  const isTokenInvalid =
    errorCode === "RECAPTCHA_TOKEN_INVALID" && reason === "TOKEN_INVALID";
  const browserError = errorCodes.includes("browser-error");
  const timeoutOrDuplicate = errorCodes.includes("timeout-or-duplicate");

  return {
    retryable: isTokenInvalid && (browserError || timeoutOrDuplicate),
    browserError
  };
}

export function LoginForm() {
  const [error, setError] = useState<string | null>(null);
  const [recaptchaScriptFailed, setRecaptchaScriptFailed] = useState(false);
  const router = useRouter();
  const setUser = useAuthStore((s) => s.setUser);
  const { language, setLanguage, t } = useWebI18n();
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

    const submitLoginRequest = async (recaptchaToken: string | null) => {
      return api.post("/api/auth/login", {
        email: values.email.trim().toLowerCase(),
        password: values.password,
        recaptchaToken: recaptchaToken ?? undefined,
        recaptchaAction: "admin_login"
      });
    };

    const handleLoginSuccess = async (loginResponse: Awaited<ReturnType<typeof submitLoginRequest>>) => {
      const user = loginResponse.data?.data?.user ?? null;
      if (!user) {
        setError(t("login.failed"));
        return;
      }
      if (user.role === "FIELD_EXECUTIVE") {
        await api.post("/api/auth/logout").catch(() => undefined);
        setError(t("login.mobileOnly"));
        return;
      }

      setUser(user);
      router.push("/dashboard");
    };

    let recaptchaToken = await getRecaptchaToken();
    if (recaptchaSiteKey && !recaptchaToken) {
      console.warn("RECAPTCHA_EXECUTION_SKIPPED", {
        reason: "TOKEN_NOT_AVAILABLE",
        target: "ADMIN_LOGIN"
      });
    }

    let lastLoginError: unknown = null;
    try {
      const loginResponse = await submitLoginRequest(recaptchaToken);
      await handleLoginSuccess(loginResponse);
      return;
    } catch (error) {
      lastLoginError = error;
    }

    const recaptchaFailure = extractRecaptchaFailureMeta(lastLoginError);
    if (recaptchaSiteKey && recaptchaFailure.retryable) {
      recaptchaToken = await getRecaptchaToken();
      if (recaptchaToken) {
        try {
          const retriedLoginResponse = await submitLoginRequest(recaptchaToken);
          await handleLoginSuccess(retriedLoginResponse);
          return;
        } catch (error) {
          lastLoginError = error;
        }
      }
    }

    const finalRecaptchaFailure = extractRecaptchaFailureMeta(lastLoginError);
    if (finalRecaptchaFailure.browserError) {
      setError(t("login.recaptchaBrowserFailed"));
      return;
    }

    setError(getApiErrorMessage(lastLoginError, t("login.failed")));
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
      <form onSubmit={onSubmit} className="space-y-4 rounded-xl bg-white p-4 shadow sm:p-6">
        <div className="flex items-center justify-end gap-2">
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
        </div>
        <h1 className="text-xl font-semibold sm:text-2xl">{t("login.title")}</h1>
        <div>
          <label className="mb-1 block text-sm font-medium">{t("login.email")}</label>
          <input
            className="w-full rounded border border-slate-300 px-3 py-2"
            {...register("email")}
          />
          {errors.email && <p className="mt-1 text-xs text-red-600">{errors.email.message}</p>}
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">{t("login.password")}</label>
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
            {t("login.recaptchaInvalid")}
          </p>
        ) : null}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          disabled={isSubmitting}
          className="w-full rounded bg-brand-600 px-4 py-2 font-medium text-white hover:bg-brand-700"
        >
          {isSubmitting ? t("login.signingIn") : t("login.signIn")}
        </button>
      </form>
    </>
  );
}
