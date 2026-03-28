import fs from "node:fs/promises";
import path from "node:path";
import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import { Suspense } from "react";
import { headers } from "next/headers";
import { PublicLeadForm } from "@/components/PublicLeadForm";
import companyLogo from "@/components/img/company_logo-.png";
import {
  districtMappingSchema,
  emptyDistrictMapping,
  type DistrictMappingPayload
} from "@/lib/landing";

export const metadata: Metadata = {
  title: "SAURTECH ENERGY | Premium Solar Consultation",
  description:
    "Reduce power costs with expert solar guidance from your local district team. Book a free consultation with SAURTECH ENERGY.",
  keywords: [
    "solar panel",
    "solar installation",
    "saurtech energy",
    "residential solar",
    "industrial solar",
    "agricultural solar",
    "solar consultation"
  ],
  robots: {
    index: true,
    follow: true
  },
  alternates: {
    canonical: "/"
  },
  openGraph: {
    title: "SAURTECH ENERGY | Premium Solar Consultation",
    description:
      "Submit your requirement and receive district-level guidance for residential, industrial, and agricultural solar installation.",
    type: "website"
  },
  twitter: {
    card: "summary_large_image",
    title: "SAURTECH ENERGY | Premium Solar Consultation",
    description:
      "Submit your solar requirement and get connected with our district team for consultation."
  }
};

export const revalidate = 3600;

async function loadDistrictMapping(): Promise<DistrictMappingPayload> {
  const mappingPath = path.join(process.cwd(), "public", "districts.mapping.json");
  try {
    const contents = await fs.readFile(mappingPath, "utf8");
    const parsed = JSON.parse(contents);
    const validated = districtMappingSchema.safeParse(parsed);
    if (!validated.success) {
      return emptyDistrictMapping;
    }
    return validated.data;
  } catch {
    return emptyDistrictMapping;
  }
}

function resolveApiBaseUrl() {
  const configured = (
    process.env.NEXT_PUBLIC_API_BASE_URL ?? process.env.NEXT_PUBLIC_API_URL ?? ""
  )
    .trim()
    .replace(/\/+$/, "");
  if (configured) {
    return configured;
  }

  return process.env.NODE_ENV === "production"
    ? "https://solarlead-production.up.railway.app"
    : "http://localhost:4000";
}

type DashboardSummaryApiResponse = {
  data?: {
    leadsByStatus?: Array<{
      statusName?: string | null;
      count?: number | null;
    }>;
  };
};

type PublicInstallationsApiResponse = {
  data?: {
    count?: number | null;
  };
};

async function loadInstallationsCount(): Promise<number | null> {
  const baseUrl = resolveApiBaseUrl();

  try {
    const publicMetricResponse = await fetch(`${baseUrl}/api/public/metrics/installations`, {
      method: "GET",
      cache: "no-store"
    });

    if (publicMetricResponse.ok) {
      const payload = (await publicMetricResponse.json()) as PublicInstallationsApiResponse;
      const count = payload.data?.count;
      if (typeof count === "number" && Number.isFinite(count) && count >= 0) {
        return count;
      }
    }
  } catch {
    // Fallback to authenticated dashboard summary below.
  }

  const cookieHeader = headers().get("cookie") ?? "";

  try {
    const response = await fetch(`${baseUrl}/api/dashboard/summary`, {
      method: "GET",
      headers: {
        Cookie: cookieHeader,
        "X-Requested-With": "XMLHttpRequest"
      },
      cache: "no-store"
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as DashboardSummaryApiResponse;
    const statuses = payload.data?.leadsByStatus ?? [];

    const totalInstallations = statuses
      .filter((status) => {
        const name = (status.statusName ?? "").trim().toLowerCase();
        return name === "installation complete";
      })
      .reduce((sum, status) => sum + Math.max(0, Number(status.count ?? 0)), 0);

    return totalInstallations;
  } catch {
    return null;
  }
}

async function InstallationsMetricValue() {
  const installationsCount = await loadInstallationsCount();
  const baseInstallations = 1000;

  if (installationsCount === null) {
    return <span className="text-3xl font-semibold tracking-tight text-slate-900">1000+</span>;
  }

  const computedTotal = baseInstallations + Math.max(0, installationsCount);

  return (
    <span className="text-3xl font-semibold tracking-tight text-slate-900">
      {computedTotal.toLocaleString("en-IN")}+
    </span>
  );
}

export default async function LandingPage() {
  const districtMapping = await loadDistrictMapping();
  const testimonials = [
    {
      quote:
        "Team explained costs clearly and completed installation planning quickly. The callback came the same day.",
      name: "Rahul Verma",
      persona: "Residential customer",
      rating: 4.9,
      avatar: "/testimonials/customer-1.svg"
    },
    {
      quote:
        "Industrial proposal was practical and documentation support reduced our delays.",
      name: "Neha Kapoor",
      persona: "Industrial customer",
      rating: 4.8,
      avatar: "/testimonials/customer-2.svg"
    },
    {
      quote:
        "Agricultural setup guidance was very useful and follow-ups were consistent.",
      name: "Amit Singh",
      persona: "Agricultural customer",
      rating: 4.9,
      avatar: "/testimonials/customer-3.svg"
    }
  ] as const;

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#f8fafc] text-[#111827]">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-x-0 top-0 h-[560px] bg-[radial-gradient(circle_at_18%_22%,rgba(255,122,0,0.24),transparent_42%),radial-gradient(circle_at_80%_16%,rgba(15,143,79,0.24),transparent_44%),linear-gradient(180deg,#ecf8ff_0%,#f8fafc_62%)]" />
        <div className="absolute inset-x-0 bottom-0 h-[440px] bg-[radial-gradient(circle_at_50%_20%,rgba(255,122,0,0.12),transparent_54%)]" />
      </div>

      <header className="relative z-10 border-b border-white/70 bg-white/55 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-4 sm:px-6 sm:py-5 lg:px-10">
          <a
            href="https://arsaurtechenergy.com/"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Open SAURTECH ENERGY website"
            className="inline-flex items-center"
          >
            <span className="relative inline-flex items-center justify-center">
              <span className="pointer-events-none absolute -inset-2 rounded-full border border-dashed border-[#ff7a00]/50 [animation:spin_12s_linear_infinite]" />
              <span className="pointer-events-none absolute -inset-4 rounded-full border border-[#0f8f4f]/35 [animation:spin_18s_linear_infinite_reverse]" />
              <Image
                src={companyLogo}
                alt="SAURTECH ENERGY logo"
                width={218}
                height={96}
                priority
                className="relative z-10 h-16 w-auto md:h-20"
              />
            </span>
          </a>
          <Link
            href="/login"
            className="inline-flex items-center rounded-2xl border border-[#dbe8f5] bg-white/95 px-5 py-2.5 text-sm font-semibold text-[#1f3555] shadow-[0_10px_26px_-18px_rgba(17,24,39,0.8)] transition duration-200 hover:-translate-y-0.5 hover:bg-white"
          >
            Admin Portal Login
          </Link>
        </div>
      </header>

      <section className="relative z-10 mx-auto max-w-7xl px-4 pb-10 pt-8 sm:px-6 sm:pt-10 lg:px-10 lg:pb-14 lg:pt-14">
        <div className="grid items-start gap-10 lg:grid-cols-[1.08fr_0.92fr] lg:gap-16">
          <div className="space-y-8">
            <p className="inline-flex rounded-full border border-[#ffbb80] bg-white/85 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-[#ff7a00] shadow-[0_10px_20px_-16px_rgba(255,122,0,0.9)]">
              District-Enabled Solar Advisory
            </p>
            <h1 className="max-w-3xl text-3xl font-semibold leading-[1.1] tracking-tight text-[#111827] sm:text-4xl md:text-5xl lg:text-[3.5rem]">
              Reduce Power Costs with{" "}
              <span className="text-[#ff7a00]">Expert Solar Guidance</span> from Your Local District Team
            </h1>
            <p className="max-w-2xl text-base leading-relaxed text-slate-700 md:text-xl">
              We provide tailored solar solutions with feasibility studies, cost estimates, and
              seamless installations with dedicated district support.
            </p>

            <div className="grid gap-4 sm:grid-cols-3">
              <article className="rounded-3xl border border-white/80 bg-white/90 p-5 shadow-[0_20px_38px_-28px_rgba(17,24,39,0.7)] backdrop-blur transition duration-300 hover:-translate-y-1 hover:shadow-[0_26px_46px_-28px_rgba(17,24,39,0.75)]">
                <p className="text-sm font-semibold text-[#0f8f4f]">Installation Types</p>
                <p className="mt-3 text-2xl font-semibold leading-tight text-[#111827]">
                  Residential, Industrial, Agricultural
                </p>
              </article>

              <article className="rounded-3xl border border-white/80 bg-white/90 p-5 shadow-[0_20px_38px_-28px_rgba(17,24,39,0.7)] backdrop-blur transition duration-300 hover:-translate-y-1 hover:shadow-[0_26px_46px_-28px_rgba(17,24,39,0.75)]">
                <p className="text-sm font-semibold text-slate-600">Avg Response Time</p>
                <p className="mt-3 text-2xl font-semibold leading-tight text-[#111827]">Within 24 Hours</p>
              </article>

              <article className="rounded-3xl border border-white/80 bg-white/90 p-5 shadow-[0_20px_38px_-28px_rgba(17,24,39,0.7)] backdrop-blur transition duration-300 hover:-translate-y-1 hover:shadow-[0_26px_46px_-28px_rgba(17,24,39,0.75)]">
                <p className="text-sm font-semibold text-[#0f8f4f]">Customer Rating</p>
                <p className="mt-3 text-2xl font-semibold leading-tight text-[#111827]">4.8 / 5</p>
                <div className="mt-3 h-2.5 rounded-full bg-slate-100">
                  <div className="h-2.5 w-[88%] rounded-full bg-gradient-to-r from-[#ff7a00] to-[#ffac5f]" />
                </div>
              </article>
            </div>

            <article className="rounded-3xl border border-white/85 bg-white/90 p-6 shadow-[0_22px_44px_-30px_rgba(17,24,39,0.75)] backdrop-blur transition duration-300 hover:-translate-y-1 hover:shadow-[0_28px_52px_-30px_rgba(17,24,39,0.8)]">
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-sm font-semibold text-[#0f8f4f]">Installations</p>
                <span className="h-1.5 w-1.5 rounded-full bg-[#ff7a00]" />
                <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
                  Live project data
                </p>
              </div>
              <div className="mt-3 min-h-[2.6rem]">
                <Suspense
                  fallback={<span className="text-3xl font-semibold tracking-tight text-slate-900">1000+</span>}
                >
                  <InstallationsMetricValue />
                </Suspense>
              </div>
              <p className="mt-2 text-sm text-slate-600">
                Lower electricity costs with premium design, better financing guidance, and faster
                district-level execution.
              </p>
            </article>
          </div>

          <div className="relative">
            <div className="pointer-events-none absolute -left-6 -top-6 h-28 w-28 rounded-full bg-[#ff7a00]/18 blur-2xl" />
            <div className="pointer-events-none absolute -bottom-8 -right-6 h-28 w-28 rounded-full bg-[#0f8f4f]/18 blur-2xl" />
            <div className="relative rounded-[2rem] border border-white/85 bg-white/72 p-2 shadow-[0_34px_70px_-40px_rgba(17,24,39,0.75)] backdrop-blur-md md:p-3">
              <Suspense
                fallback={
                  <div className="rounded-[1.75rem] border border-slate-200 bg-white p-8 shadow-[0_30px_60px_-40px_rgba(15,23,42,0.6)]">
                    Loading form...
                  </div>
                }
              >
                <PublicLeadForm districtMapping={districtMapping} />
              </Suspense>
            </div>
          </div>
        </div>
      </section>

      <section className="relative z-10 mx-auto max-w-7xl px-4 pb-16 pt-2 sm:px-6 lg:px-10 lg:pb-20">
        <div className="rounded-[2rem] border border-white/80 bg-white/85 p-6 shadow-[0_30px_70px_-52px_rgba(17,24,39,0.85)] backdrop-blur md:p-8">
          <div className="mx-auto mb-6 max-w-2xl text-center">
            <h2 className="text-3xl font-semibold tracking-tight text-[#111827] md:text-4xl">
              What Customers Say
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              Real feedback from residential, industrial, and agricultural customers.
            </p>
          </div>

          <div className="relative overflow-hidden">
            <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-16 bg-gradient-to-r from-white to-transparent" />
            <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-16 bg-gradient-to-l from-white to-transparent" />

            <div className="testimonial-track flex w-max gap-5 pr-5">
              {[...testimonials, ...testimonials].map((item, index) => (
                <article
                  key={`${item.name}-${index}`}
                  className="group relative w-[82vw] max-w-[305px] overflow-hidden rounded-3xl border border-slate-200/80 bg-[linear-gradient(145deg,#ffffff_0%,#f8fbff_55%,#fff9f2_100%)] p-4 text-sm leading-relaxed text-slate-700 shadow-[0_20px_42px_-34px_rgba(17,24,39,0.65)] transition duration-300 hover:-translate-y-1 hover:shadow-[0_34px_60px_-34px_rgba(17,24,39,0.8)] sm:w-[255px] md:w-[305px]"
                >
                  <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#ff7a00] via-[#ffac5f] to-[#0f8f4f]" />
                  <div className="mb-4 flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <Image
                        src={item.avatar}
                        alt={`${item.name} customer`}
                        width={40}
                        height={40}
                        className="h-10 w-10 rounded-full border border-slate-200 object-cover shadow-sm"
                      />
                      <div>
                        <p className="text-[13px] font-semibold leading-tight text-[#111827]">{item.name}</p>
                        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#0f8f4f]">
                          {item.persona}
                        </p>
                      </div>
                    </div>
                    <div className="inline-flex items-center gap-0.5 rounded-full bg-[#fff4e8] px-2 py-1 text-[11px] font-semibold text-[#ff7a00]">
                      <span>★</span>
                      <span>{item.rating.toFixed(1)}</span>
                    </div>
                  </div>
                  <p className="min-h-[88px] text-[14px] leading-6 text-slate-700">{item.quote}</p>
                  <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-4">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                      Verified customer
                    </p>
                    <span className="rounded-full bg-[#0f8f4f]/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#0f8f4f]">
                      Trusted
                    </span>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
