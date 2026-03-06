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
  title: "Solar Panel Installation | Free Consultation",
  description:
    "Submit your solar installation requirement and get contacted by your local district team.",
  keywords: ["solar panel", "solar installation", "rooftop solar", "solar consultation"]
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
      <section className="mx-auto grid max-w-6xl gap-10 px-6 py-14 md:grid-cols-[1.05fr_0.95fr]">
        <div className="space-y-6">
          <p className="inline-flex rounded-full bg-brand-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-brand-700">
            Trusted Solar Installation Partner
          </p>
          <h1 className="text-4xl font-bold leading-tight text-slate-900 md:text-5xl">
            Switch to solar with district-level support and transparent guidance.
          </h1>
          <p className="max-w-xl text-base text-slate-700 md:text-lg">
            Get site-specific recommendation, expected savings, and complete onboarding support
            from registration to installation.
          </p>
          <ul className="space-y-2 text-sm text-slate-700">
            <li>District-level field team allocation</li>
            <li>Fast lead response and guided documentation</li>
            <li>Clear workflow tracking from inquiry to installation</li>
          </ul>
          <div className="pt-2">
            <Link
              href="/login"
              className="inline-flex rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
            >
              Admin Portal Login
            </Link>
          </div>
        </div>
        <div>
          <Suspense fallback={<div className="rounded-2xl bg-white p-6 shadow-lg">Loading form...</div>}>
            <PublicLeadForm districtMapping={districtMapping} />
          </Suspense>
        </div>
      </section>
    </main>
  );
}
