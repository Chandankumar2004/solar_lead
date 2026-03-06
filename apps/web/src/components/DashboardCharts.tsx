"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  FunnelChart,
  Funnel,
  LabelList,
  Legend,
  PieChart,
  Pie,
  Cell
} from "recharts";

type StatusPoint = {
  statusId: string;
  statusName: string;
  orderIndex: number;
  isTerminal: boolean;
  colorCode?: string | null;
  count: number;
};

type DistrictPoint = {
  districtId: string;
  districtName: string;
  state: string;
  count: number;
};

type InstallationTypePoint = {
  installationType: string;
  count: number;
};

type DashboardChartPayload = {
  leadsByStatus: StatusPoint[];
  leadsByDistrict: DistrictPoint[];
  leadsByInstallationType: InstallationTypePoint[];
};

const pieColors = ["#1f7a59", "#14553d", "#3ca67a", "#7ac9a9", "#b8e1d0", "#94cbb4"];

export function DashboardCharts({ summary }: { summary: DashboardChartPayload }) {
  const statusBars = summary.leadsByStatus
    .filter((item) => item.count > 0)
    .map((item) => ({
      name: item.statusName,
      count: item.count,
      fill: item.colorCode ?? "#1f7a59"
    }));

  const statusFunnel = [...statusBars].sort((a, b) => b.count - a.count);
  const districtBars = summary.leadsByDistrict.filter((item) => item.count > 0);
  const installationPie = summary.leadsByInstallationType.filter((item) => item.count > 0);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="h-80 rounded-xl bg-white p-4 shadow">
        <h3 className="mb-4 text-lg font-semibold">Leads by Status (Bar)</h3>
        <ResponsiveContainer width="100%" height="88%">
          <BarChart data={statusBars}>
            <XAxis dataKey="name" interval={0} angle={-18} textAnchor="end" height={56} />
            <YAxis />
            <Tooltip />
            <Bar dataKey="count" fill="#1f7a59" />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="h-80 rounded-xl bg-white p-4 shadow">
        <h3 className="mb-4 text-lg font-semibold">Leads by Status (Funnel)</h3>
        <ResponsiveContainer width="100%" height="88%">
          <FunnelChart>
            <Tooltip />
            <Funnel dataKey="count" data={statusFunnel} isAnimationActive={false}>
              <LabelList position="right" dataKey="name" stroke="#334155" />
            </Funnel>
          </FunnelChart>
        </ResponsiveContainer>
      </div>
      <div className="h-80 rounded-xl bg-white p-4 shadow">
        <h3 className="mb-4 text-lg font-semibold">Leads by District</h3>
        <ResponsiveContainer width="100%" height="88%">
          <BarChart data={districtBars}>
            <XAxis dataKey="districtName" interval={0} angle={-18} textAnchor="end" height={56} />
            <YAxis />
            <Tooltip />
            <Bar dataKey="count" fill="#14553d" />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="h-80 rounded-xl bg-white p-4 shadow">
        <h3 className="mb-4 text-lg font-semibold">Leads by Installation Type</h3>
        <ResponsiveContainer width="100%" height="88%">
          <PieChart>
            <Pie
              data={installationPie}
              dataKey="count"
              nameKey="installationType"
              outerRadius={90}
              label
            >
              {installationPie.map((_: unknown, i: number) => (
                <Cell key={i} fill={pieColors[i % pieColors.length]} />
              ))}
            </Pie>
            <Tooltip />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
