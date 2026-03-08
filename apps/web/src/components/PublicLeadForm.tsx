"use client";

import { useEffect, useMemo, useState } from "react";
import Script from "next/script";
import { useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { api, getApiErrorMessage } from "@/lib/api";
import { resolveRecaptchaSiteKey } from "@/lib/recaptcha";
import {
  type DistrictMappingPayload,
  type PublicLeadFormValues,
  INSTALLATION_TYPES,
  publicLeadFormSchema
} from "@/lib/landing";

type SubmitSuccess = {
  id: string;
  externalId: string;
};

type DuplicateCheckData = {
  isDuplicate: boolean;
  count: number;
};

type PublicLeadFormProps = {
  districtMapping: DistrictMappingPayload;
};

export function PublicLeadForm({ districtMapping }: PublicLeadFormProps) {
  const searchParams = useSearchParams();
  const rawRecaptchaSiteKey = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;
  const recaptchaSiteKey = resolveRecaptchaSiteKey(rawRecaptchaSiteKey);
  const recaptchaConfigInvalid = Boolean(rawRecaptchaSiteKey?.trim()) && !recaptchaSiteKey;
  const [districtSearch, setDistrictSearch] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<SubmitSuccess | null>(null);
  const [recaptchaScriptFailed, setRecaptchaScriptFailed] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors, isSubmitting }
  } = useForm<PublicLeadFormValues>({
    resolver: zodResolver(publicLeadFormSchema),
    defaultValues: {
      name: "",
      phone: "",
      email: "",
      monthly_bill: undefined,
      district_id: "",
      state: "",
      installation_type: "Residential Rooftop",
      message: "",
      consent_given: false
    }
  });

  const districtById = useMemo(
    () => new Map(districtMapping.districts.map((district) => [district.id, district])),
    [districtMapping.districts]
  );
  const selectedDistrictId = watch("district_id");
  const phone = watch("phone");

  const filteredDistricts = useMemo(() => {
    const needle = districtSearch.trim().toLowerCase();
    if (!needle) {
      return districtMapping.districts;
    }
    return districtMapping.districts.filter((district) =>
      `${district.name} ${district.state}`.toLowerCase().includes(needle)
    );
  }, [districtMapping.districts, districtSearch]);

  useEffect(() => {
    const district = selectedDistrictId ? districtById.get(selectedDistrictId) : undefined;
    setValue("state", district?.state ?? "", { shouldValidate: true, shouldDirty: true });
  }, [districtById, selectedDistrictId, setValue]);

  useEffect(() => {
    setDuplicateWarning(null);
    const normalizedPhone = phone?.trim() ?? "";
    if (normalizedPhone.length < 8) {
      return;
    }
    let cancelled = false;

    const timeout = setTimeout(async () => {
      try {
        const response = await api.get("/public/leads/duplicate-check", {
          params: { phone: normalizedPhone }
        });
        if (cancelled) {
          return;
        }
        const data = response.data?.data as DuplicateCheckData | undefined;
        if (data?.isDuplicate) {
          setDuplicateWarning(
            `This phone already exists in ${data.count} lead${data.count > 1 ? "s" : ""}. You can still submit.`
          );
        }
      } catch (error: unknown) {
        const message = getApiErrorMessage(error, "Duplicate check unavailable");
        if (message.startsWith("Network/CORS error")) {
          setDuplicateWarning(
            "Duplicate check is temporarily unavailable due to network/CORS. You can still submit."
          );
          return;
        }
        setDuplicateWarning(null);
      }
    }, 450);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [phone]);

  useEffect(() => {
    const rawKey = rawRecaptchaSiteKey?.trim() ?? "";
    if (!rawKey) {
      if (process.env.NODE_ENV === "production") {
        console.error("RECAPTCHA_CONFIG_ERROR", {
          reason: "SITE_KEY_MISSING"
        });
      }
      return;
    }

    if (!recaptchaSiteKey) {
      console.error("RECAPTCHA_CONFIG_ERROR", {
        reason: "SITE_KEY_INVALID_OR_PLACEHOLDER"
      });
    }
  }, [rawRecaptchaSiteKey, recaptchaSiteKey]);

  const getRecaptchaToken = async () => {
    if (!recaptchaSiteKey) {
      return null;
    }

    if (recaptchaScriptFailed) {
      console.error("RECAPTCHA_CONFIG_ERROR", {
        reason: "SCRIPT_LOAD_FAILED"
      });
      return null;
    }

    if (typeof window === "undefined" || !window.grecaptcha) {
      console.error("RECAPTCHA_CONFIG_ERROR", {
        reason: "GRECAPTCHA_NOT_READY"
      });
      return null;
    }

    try {
      await new Promise<void>((resolve) => {
        window.grecaptcha?.ready(() => resolve());
      });
      return window.grecaptcha.execute(recaptchaSiteKey, { action: "public_lead_submit" });
    } catch (error) {
      console.error("RECAPTCHA_CONFIG_ERROR", {
        reason: "EXECUTE_FAILED",
        error
      });
      return null;
    }
  };

  const onSubmit = handleSubmit(async (values) => {
    setSubmitError(null);
    const recaptchaToken = await getRecaptchaToken();
    if (recaptchaSiteKey && !recaptchaToken) {
      setSubmitError("reCAPTCHA verification failed. Please refresh and try again.");
      return;
    }
    const utmPayload = {
      utm_source: searchParams.get("utm_source") ?? undefined,
      utm_medium: searchParams.get("utm_medium") ?? undefined,
      utm_campaign: searchParams.get("utm_campaign") ?? undefined,
      utm_term: searchParams.get("utm_term") ?? undefined,
      utm_content: searchParams.get("utm_content") ?? undefined
    };

    try {
      const response = await api.post("/public/leads", {
        name: values.name.trim(),
        phone: values.phone.trim(),
        email: values.email?.trim() || undefined,
        monthly_bill: values.monthly_bill,
        district_id: values.district_id,
        state: values.state,
        installation_type: values.installation_type,
        message: values.message?.trim() || undefined,
        consent_given: values.consent_given,
        recaptcha_token: recaptchaToken ?? undefined,
        ...utmPayload
      });

      const payload = response.data?.data as SubmitSuccess | undefined;
      if (!payload?.id || !payload.externalId) {
        setSubmitError("Lead submission failed. Please try again.");
        return;
      }

      setSubmitSuccess(payload);
      reset();
    } catch (error: unknown) {
      setSubmitError(getApiErrorMessage(error, "Lead submission failed. Please try again."));
    }
  });

  if (submitSuccess) {
    return (
      <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 shadow-sm">
        <h2 className="text-2xl font-semibold text-emerald-900">Request submitted successfully</h2>
        <p className="mt-2 text-sm text-emerald-900/80">
          Our solar advisor will contact you shortly.
        </p>
        <p className="mt-4 text-sm text-emerald-800">
          Reference ID: <span className="font-semibold">{submitSuccess.externalId}</span>
        </p>
        <button
          type="button"
          onClick={() => {
            setSubmitSuccess(null);
            setDuplicateWarning(null);
            setSubmitError(null);
          }}
          className="mt-5 rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800"
        >
          Submit another request
        </button>
      </section>
    );
  }

  return (
    <>
      {recaptchaSiteKey ? (
        <Script
          id="recaptcha-v3"
          src={`https://www.google.com/recaptcha/api.js?render=${recaptchaSiteKey}`}
          strategy="afterInteractive"
          onError={() => {
            setRecaptchaScriptFailed(true);
            console.error("RECAPTCHA_CONFIG_ERROR", {
              reason: "SCRIPT_LOAD_ERROR"
            });
          }}
        />
      ) : null}
      <form onSubmit={onSubmit} className="space-y-4 rounded-2xl bg-white p-6 shadow-lg">
        <h2 className="text-2xl font-semibold text-slate-900">Book Free Solar Consultation</h2>
        <p className="text-sm text-slate-600">
          Fill the form and our district team will contact you with a customized proposal.
        </p>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Full Name</label>
          <input
            type="text"
            {...register("name")}
            className="w-full rounded-md border border-slate-300 px-3 py-2 outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-100"
            placeholder="Enter your full name"
          />
          {errors.name ? <p className="mt-1 text-xs text-red-600">{errors.name.message}</p> : null}
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Phone</label>
          <input
            type="tel"
            {...register("phone")}
            className="w-full rounded-md border border-slate-300 px-3 py-2 outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-100"
            placeholder="Enter phone number"
          />
          {errors.phone ? <p className="mt-1 text-xs text-red-600">{errors.phone.message}</p> : null}
          {duplicateWarning ? (
            <p className="mt-1 text-xs text-amber-700">{duplicateWarning}</p>
          ) : null}
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Email (optional)</label>
          <input
            type="email"
            {...register("email")}
            className="w-full rounded-md border border-slate-300 px-3 py-2 outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-100"
            placeholder="you@example.com"
          />
          {errors.email ? <p className="mt-1 text-xs text-red-600">{errors.email.message}</p> : null}
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Monthly Bill (optional)</label>
          <input
            type="number"
            min={0}
            step="0.01"
            {...register("monthly_bill")}
            className="w-full rounded-md border border-slate-300 px-3 py-2 outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-100"
            placeholder="e.g. 2500"
          />
          {errors.monthly_bill ? (
            <p className="mt-1 text-xs text-red-600">{errors.monthly_bill.message}</p>
          ) : null}
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Search District</label>
          <input
            value={districtSearch}
            onChange={(event) => setDistrictSearch(event.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-100"
            placeholder="Type district or state"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">District</label>
          <select
            {...register("district_id")}
            className="w-full rounded-md border border-slate-300 px-3 py-2 outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-100"
          >
            <option value="">Select district</option>
            {filteredDistricts.map((district) => (
              <option key={district.id} value={district.id}>
                {district.name} ({district.state})
              </option>
            ))}
          </select>
          {errors.district_id ? (
            <p className="mt-1 text-xs text-red-600">{errors.district_id.message}</p>
          ) : null}
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">State</label>
          <input
            type="text"
            readOnly
            {...register("state")}
            className="w-full cursor-not-allowed rounded-md border border-slate-200 bg-slate-100 px-3 py-2 text-slate-700"
            placeholder="State is auto-filled from district"
          />
          {errors.state ? <p className="mt-1 text-xs text-red-600">{errors.state.message}</p> : null}
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Installation Type</label>
          <select
            {...register("installation_type")}
            className="w-full rounded-md border border-slate-300 px-3 py-2 outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-100"
          >
            {INSTALLATION_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
          {errors.installation_type ? (
            <p className="mt-1 text-xs text-red-600">{errors.installation_type.message}</p>
          ) : null}
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Message (optional)</label>
          <textarea
            rows={4}
            {...register("message")}
            className="w-full rounded-md border border-slate-300 px-3 py-2 outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-100"
            placeholder="Share roof details, preferred callback time, or requirements"
          />
          {errors.message ? <p className="mt-1 text-xs text-red-600">{errors.message.message}</p> : null}
        </div>

        <label className="flex items-start gap-2 rounded-md bg-slate-50 p-3">
          <input type="checkbox" className="mt-1 h-4 w-4" {...register("consent_given")} />
          <span className="text-sm text-slate-700">
            I consent to be contacted regarding solar installation consultation and agree to
            processing of the details submitted here.
          </span>
        </label>
        {errors.consent_given ? (
          <p className="mt-1 text-xs text-red-600">{errors.consent_given.message}</p>
        ) : null}

        {submitError ? <p className="text-sm text-red-700">{submitError}</p> : null}
        {recaptchaConfigInvalid ? (
          <p className="text-xs text-amber-700">
            reCAPTCHA site key is invalid. Set a valid `NEXT_PUBLIC_RECAPTCHA_SITE_KEY`.
          </p>
        ) : null}

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-md bg-brand-600 px-4 py-3 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {isSubmitting ? "Submitting..." : "Submit Lead"}
        </button>
      </form>
    </>
  );
}
