import { useQuery } from "@tanstack/react-query";
import { Area, AreaChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { DashboardApi, NotificationsApi } from "../api/endpoints";
import StatCard from "../components/StatCard";
import { formatCurrency, formatDate } from "../utils/format";

const PIE_COLORS = ["#1d70ef", "#59adff", "#8ecbff", "#f59e0b", "#ef4444", "#10b981", "#8b5cf6", "#ec4899", "#64748b"];

export default function Dashboard() {
  const { data: summary, isLoading } = useQuery({ queryKey: ["dashboard-summary"], queryFn: DashboardApi.summary });
  const { data: recentNotifications } = useQuery({
    queryKey: ["notifications", "recent"],
    queryFn: () => NotificationsApi.list(false),
  });

  if (isLoading || !summary) {
    return <div className="text-slate-500">Loading dashboard...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Net worth" value={formatCurrency(summary.net_worth)} tone={summary.net_worth >= 0 ? "positive" : "negative"} />
        <StatCard label="Total assets" value={formatCurrency(summary.total_assets)} />
        <StatCard label="Total liabilities" value={formatCurrency(summary.total_liabilities)} tone="negative" />
        <StatCard label="Income this month" value={formatCurrency(summary.month_income)} tone="positive" />
        <StatCard label="Spent this month" value={formatCurrency(summary.month_expenses)} tone="negative" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm lg:col-span-2">
          <h2 className="text-sm font-semibold text-slate-700">Net worth trend (6 months)</h2>
          <div className="mt-4 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={summary.net_worth_trend}>
                <defs>
                  <linearGradient id="netWorthFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#1d70ef" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#1d70ef" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} stroke="#94a3b8" />
                <YAxis tickFormatter={(v) => formatCurrency(v)} tick={{ fontSize: 12 }} stroke="#94a3b8" width={80} />
                <Tooltip formatter={(v: number) => formatCurrency(v)} />
                <Area type="monotone" dataKey="net_worth" name="Net worth" stroke="#1d70ef" fill="url(#netWorthFill)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-700">Spending by category (this month)</h2>
          <div className="mt-2 h-72">
            {summary.spending_by_category.length === 0 ? (
              <p className="mt-8 text-center text-sm text-slate-400">No categorized spending yet this month.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={summary.spending_by_category}
                    dataKey="amount"
                    nameKey="category_name"
                    innerRadius={55}
                    outerRadius={90}
                    paddingAngle={2}
                  >
                    {summary.spending_by_category.map((entry, index) => (
                      <Cell key={entry.category_name} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => formatCurrency(v)} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-700">Recent notifications</h2>
        <div className="mt-3 divide-y divide-slate-100">
          {(recentNotifications ?? []).slice(0, 6).map((n) => (
            <div key={n.id} className="flex items-start justify-between gap-4 py-3">
              <div>
                <p className="text-sm font-medium text-slate-800">{n.title}</p>
                <p className="text-sm text-slate-500">{n.message}</p>
              </div>
              <span className="whitespace-nowrap text-xs text-slate-400">{formatDate(n.created_at)}</span>
            </div>
          ))}
          {(recentNotifications ?? []).length === 0 && <p className="py-4 text-sm text-slate-400">No notifications yet.</p>}
        </div>
      </div>
    </div>
  );
}
