import fs from "node:fs/promises";
import path from "node:path";
import Link from "next/link";
import type { Metadata } from "next";
import { Suspense } from "react";
import { PublicLeadForm } from "@/components/PublicLeadForm";
import {
  districtMappingSchema,
  emptyDistrictMapping,
  type DistrictMappingPayload
} from "@/lib/landing";

export const metadata: Metadata = {
  title: "Solar Installation Consultation | Residential, Industrial, Agricultural",
  description:
    "Capture your solar requirement in under 2 minutes. Get a district-level callback for residential, industrial, and agricultural installations.",
  keywords: [
    "solar panel",
    "solar installation",
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
    title: "Solar Installation Consultation",
    description:
      "Submit your requirement and receive district-level guidance for residential, industrial, and agricultural solar installation.",
    type: "website"
  },
  twitter: {
    card: "summary_large_image",
    title: "Solar Installation Consultation",
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

export default async function LandingPage() {
  const districtMapping = await loadDistrictMapping();

  return (
    <main className="min-h-screen bg-gradient-to-br from-brand-50 via-white to-slate-100">
      <section className="border-b border-brand-100 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white">
              SL
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-900">Solar Lead</p>
              <p className="text-xs text-slate-600">District-Enabled Solar Consultation</p>
            </div>
          </div>
          <Link
            href="/login"
            className="inline-flex rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
          >
            Admin Portal Login
          </Link>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-10 px-6 py-10 md:grid-cols-[1.05fr_0.95fr] md:py-14">
        <div className="space-y-6">
          <p className="inline-flex rounded-full bg-brand-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-brand-700">
            Trusted Solar Installation Partner
          </p>
          <h1 className="text-4xl font-bold leading-tight text-slate-900 md:text-5xl">
            Reduce power costs with end-to-end solar guidance from your local district team.
          </h1>
          <p className="max-w-2xl text-base text-slate-700 md:text-lg">
            We help you evaluate feasibility, estimate savings, and complete installation workflows
            with faster callbacks and transparent execution.
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Installation Types
              </p>
              <p className="mt-2 text-sm font-medium text-slate-800">
                Residential, Industrial, Agricultural
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Coverage</p>
              <p className="mt-2 text-sm font-medium text-slate-800">
                District-level team assignment and follow-up
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-brand-100 bg-brand-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">Installations</p>
              <p className="mt-1 text-xl font-bold text-slate-900">5,000+</p>
            </div>
            <div className="rounded-xl border border-brand-100 bg-brand-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">Avg Response</p>
              <p className="mt-1 text-xl font-bold text-slate-900">Within 24h</p>
            </div>
            <div className="rounded-xl border border-brand-100 bg-brand-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">Customer Rating</p>
              <p className="mt-1 text-xl font-bold text-slate-900">4.8/5</p>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Trust Indicators</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-700">
                MNRE-aligned process support
              </span>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-700">
                DISCOM documentation guidance
              </span>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-700">
                Subsidy paperwork assistance
              </span>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Contact</p>
            <p className="mt-2 text-sm text-slate-700">Phone: +91 98765 43210</p>
            <p className="text-sm text-slate-700">Email: support@solarlead.in</p>
            <p className="text-sm text-slate-700">Mon-Sat: 9:00 AM to 7:00 PM</p>
          </div>
        </div>
        <div>
          <Suspense fallback={<div className="rounded-2xl bg-white p-6 shadow-lg">Loading form...</div>}>
            <PublicLeadForm districtMapping={districtMapping} />
          </Suspense>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-12">
        <h2 className="text-xl font-semibold text-slate-900">What customers say</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <article className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700 shadow-sm">
            &ldquo;Team explained costs clearly and completed installation planning quickly. The
            callback came the same day.&rdquo;
            <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Residential customer
            </p>
          </article>
          <article className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700 shadow-sm">
            &ldquo;Industrial proposal was practical and documentation support reduced our
            delays.&rdquo;
            <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Industrial customer
            </p>
          </article>
          <article className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700 shadow-sm">
            &ldquo;Agricultural setup guidance was very useful and follow-ups were
            consistent.&rdquo;
            <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Agricultural customer
            </p>
          </article>
        </div>
      </section>
    </main>
  );
}
