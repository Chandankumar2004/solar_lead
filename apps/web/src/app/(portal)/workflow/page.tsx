"use client";

import useSWR from "swr";
import { api } from "@/lib/api";

type LeadStatus = {
  id: string;
  name: string;
  orderIndex: number;
  isTerminal: boolean;
  slaDurationHours?: number | null;
  colorCode?: string | null;
};

type Transition = {
  id: string;
  fromStatus?: { id: string; name: string } | null;
  toStatus?: { id: string; name: string } | null;
};

const fetcher = (url: string) => api.get(url).then((r) => r.data?.data);

function toArray<T>(value: unknown, keys: string[] = []): T[] {
  if (Array.isArray(value)) {
    return value as T[];
  }

  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    for (const key of keys) {
      const candidate = source[key];
      if (Array.isArray(candidate)) {
        return candidate as T[];
      }
    }
  }

  return [];
}

export default function WorkflowPage() {
  const { data: statuses = [] } = useSWR("/api/lead-statuses", fetcher);
  const { data: transitions = [] } = useSWR("/api/lead-statuses/transitions", fetcher);
  const statusItems = toArray<LeadStatus>(statuses, ["statuses", "items", "data"]);
  const transitionItems = toArray<Transition>(transitions, [
    "transitions",
    "items",
    "data"
  ]);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
      <section className="rounded-xl bg-white p-4 shadow-sm">
        <h2 className="text-base font-semibold">Lead Statuses</h2>
        <div className="mt-3 space-y-2">
          {statusItems.map((status) => (
            <div key={status.id} className="rounded-md border border-slate-200 p-3 text-sm">
              <div className="flex items-center justify-between">
                <p className="font-medium">{status.name}</p>
                <span className="text-xs text-slate-500">#{status.orderIndex}</span>
              </div>
              <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                <span>{status.isTerminal ? "Terminal" : "Non-terminal"}</span>
                <span>
                  SLA: {status.slaDurationHours ? `${status.slaDurationHours}h` : "Not set"}
                </span>
                {status.colorCode ? (
                  <span className="inline-flex items-center gap-1">
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: status.colorCode }}
                    />
                    {status.colorCode}
                  </span>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl bg-white p-4 shadow-sm">
        <h2 className="text-base font-semibold">Allowed Transitions</h2>
        <div className="mt-3 space-y-2">
          {transitionItems.map((transition) => (
            <div key={transition.id} className="rounded-md border border-slate-200 p-3 text-sm">
              <p>
                <span className="font-medium">{transition.fromStatus?.name ?? "-"}</span>
                <span className="mx-2 text-slate-500">to</span>
                <span className="font-medium">{transition.toStatus?.name ?? "-"}</span>
              </p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
