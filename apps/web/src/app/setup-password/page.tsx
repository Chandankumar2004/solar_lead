"use client";

import Link from "next/link";
import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { strongPasswordSchema } from "@solar/shared";
import { api, getApiErrorMessage } from "@/lib/api";

const setupPasswordFormSchema = z
  .object({
    password: strongPasswordSchema,
    confirmPassword: z.string()
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match"
  });

type SetupPasswordFormValues = z.infer<typeof setupPasswordFormSchema>;

function SetupPasswordContent() {
  const searchParams = useSearchParams();
  const token = useMemo(() => searchParams.get("token")?.trim() ?? "", [searchParams]);
  const [apiError, setApiError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting }
  } = useForm<SetupPasswordFormValues>({
    resolver: zodResolver(setupPasswordFormSchema)
  });

  const onSubmit = handleSubmit(async (values) => {
    setApiError(null);
    setSuccessMessage(null);

    if (!token) {
      setApiError("Setup token is missing from the URL.");
      return;
    }

    try {
      const response = await api.post("/api/auth/setup-password", {
        token,
        newPassword: values.password
      });
      setSuccessMessage(
        response.data?.message ?? "Password set successfully. You can now sign in."
      );
    } catch (error) {
      setApiError(getApiErrorMessage(error, "Unable to set password"));
    }
  });

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 p-4 sm:p-6">
      <div className="w-full max-w-md rounded-xl bg-white p-4 shadow sm:p-6">
        <h1 className="text-lg font-semibold sm:text-xl">Set Password</h1>
        <p className="mt-1 text-sm text-slate-600">
          Create a password for your admin account.
        </p>

        <form onSubmit={onSubmit} className="mt-4 space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">New Password</label>
            <input
              type="password"
              className="w-full rounded border border-slate-300 px-3 py-2"
              {...register("password")}
            />
            {errors.password ? (
              <p className="mt-1 text-xs text-rose-600">{errors.password.message}</p>
            ) : null}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Confirm Password</label>
            <input
              type="password"
              className="w-full rounded border border-slate-300 px-3 py-2"
              {...register("confirmPassword")}
            />
            {errors.confirmPassword ? (
              <p className="mt-1 text-xs text-rose-600">{errors.confirmPassword.message}</p>
            ) : null}
          </div>

          {apiError ? <p className="text-sm text-rose-600">{apiError}</p> : null}
          {successMessage ? (
            <p className="text-sm text-emerald-700">{successMessage}</p>
          ) : null}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded bg-brand-600 px-4 py-2 font-medium text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {isSubmitting ? "Saving..." : "Set Password"}
          </button>
        </form>

        <div className="mt-4 text-center">
          <Link href="/login" className="text-sm text-brand-700 hover:underline">
            Back to login
          </Link>
        </div>
      </div>
    </main>
  );
}

export default function SetupPasswordPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
          <div className="w-full max-w-md rounded-xl bg-white p-4 shadow sm:p-6">
            <p className="text-sm text-slate-600">Loading setup form...</p>
          </div>
        </main>
      }
    >
      <SetupPasswordContent />
    </Suspense>
  );
}
