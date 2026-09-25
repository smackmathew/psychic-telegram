import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CreditApi, HouseholdApi } from "../api/endpoints";
import type { BorrowingCapacityOut, CreditBureau, User } from "../types";
import { formatCurrency, formatDate, formatPercent } from "../utils/format";

const BUREAUS: CreditBureau[] = ["experian", "equifax", "transunion", "other"];

const PRIORITY_STYLES: Record<string, string> = {
  high: "border-l-red-500",
  medium: "border-l-amber-500",
  low: "border-l-slate-300",
};

function HouseholdIncomeForm() {
  const queryClient = useQueryClient();
  const { data: household } = useQuery({ queryKey: ["household"], queryFn: HouseholdApi.get });
  const [income, setIncome] = useState("");

  const mutation = useMutation({
    mutationFn: () => HouseholdApi.update({ annual_gross_income: parseFloat(income) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["household"] });
      setIncome("");
    },
  });

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-700">Household income</h2>
      <p className="mt-1 text-xs text-slate-400">Used as the default for borrowing-capacity estimates below.</p>
      <div className="mt-3 flex items-center gap-3">
        <span className="text-lg font-semibold text-slate-800">{formatCurrency(Number(household?.annual_gross_income ?? 0))}/yr</span>
        <input
          type="number"
          placeholder="New annual gross income"
          className="w-48 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          value={income}
          onChange={(e) => setIncome(e.target.value)}
        />
        <button
          className="rounded-md bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-900"
          onClick={() => income && mutation.mutate()}
        >
          Save
        </button>
      </div>
    </div>
  );
}

function CreditProfileCard({ user }: { user: User }) {
  const queryClient = useQueryClient();
  const { data: profiles } = useQuery({ queryKey: ["credit-profiles"], queryFn: CreditApi.listProfiles });
  const profile = profiles?.find((p) => p.user_id === user.id);

  const { data: history } = useQuery({ queryKey: ["credit-history", user.id], queryFn: () => CreditApi.history(user.id) });
  const { data: recommendations } = useQuery({
    queryKey: ["credit-recommendations", user.id],
    queryFn: () => CreditApi.recommendations(user.id),
    enabled: !!profile,
  });

  const [bureau, setBureau] = useState<CreditBureau>(profile?.bureau ?? "other");
  const [score, setScore] = useState(profile?.score?.toString() ?? "");
  const [utilization, setUtilization] = useState(profile?.utilization_pct?.toString() ?? "");
  const [onTime, setOnTime] = useState(profile?.on_time_payment_pct?.toString() ?? "");
  const [creditAge, setCreditAge] = useState(profile?.credit_age_years?.toString() ?? "");
  const [inquiries, setInquiries] = useState(profile?.num_hard_inquiries_12mo?.toString() ?? "");
  const [openAccounts, setOpenAccounts] = useState(profile?.num_open_accounts?.toString() ?? "");
  const [derogatory, setDerogatory] = useState(profile?.num_derogatory_marks?.toString() ?? "");

  const mutation = useMutation({
    mutationFn: () =>
      CreditApi.upsertProfile(user.id, {
        bureau,
        score: parseInt(score, 10),
        utilization_pct: utilization ? parseFloat(utilization) : undefined,
        on_time_payment_pct: onTime ? parseFloat(onTime) : undefined,
        credit_age_years: creditAge ? parseFloat(creditAge) : undefined,
        num_hard_inquiries_12mo: inquiries ? parseInt(inquiries, 10) : undefined,
        num_open_accounts: openAccounts ? parseInt(openAccounts, 10) : undefined,
        num_derogatory_marks: derogatory ? parseInt(derogatory, 10) : undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["credit-profiles"] });
      queryClient.invalidateQueries({ queryKey: ["credit-history", user.id] });
      queryClient.invalidateQueries({ queryKey: ["credit-recommendations", user.id] });
    },
  });

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700">{user.full_name}</h2>
        {profile && <span className="text-2xl font-bold text-slate-800">{profile.score}</span>}
      </div>

      {history && history.length > 1 && (
        <div className="mt-3 h-40">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={history}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="recorded_date" tickFormatter={(d) => formatDate(d)} tick={{ fontSize: 10 }} stroke="#94a3b8" />
              <YAxis domain={[300, 850]} tick={{ fontSize: 10 }} stroke="#94a3b8" width={35} />
              <Tooltip labelFormatter={(d) => formatDate(String(d))} />
              <Line type="monotone" dataKey="score" stroke="#1d70ef" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      <form
        className="mt-3 grid grid-cols-2 gap-2 text-xs"
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
      >
        <label className="col-span-2">
          Bureau
          <select className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1" value={bureau} onChange={(e) => setBureau(e.target.value as CreditBureau)}>
            {BUREAUS.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </label>
        <label>
          Score
          <input type="number" min={300} max={850} className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1" value={score} onChange={(e) => setScore(e.target.value)} required />
        </label>
        <label>
          Utilization %
          <input type="number" className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1" value={utilization} onChange={(e) => setUtilization(e.target.value)} />
        </label>
        <label>
          On-time payments %
          <input type="number" className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1" value={onTime} onChange={(e) => setOnTime(e.target.value)} />
        </label>
        <label>
          Credit age (yrs)
          <input type="number" className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1" value={creditAge} onChange={(e) => setCreditAge(e.target.value)} />
        </label>
        <label>
          Hard inquiries (12mo)
          <input type="number" className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1" value={inquiries} onChange={(e) => setInquiries(e.target.value)} />
        </label>
        <label>
          Open accounts
          <input type="number" className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1" value={openAccounts} onChange={(e) => setOpenAccounts(e.target.value)} />
        </label>
        <label>
          Derogatory marks
          <input type="number" className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1" value={derogatory} onChange={(e) => setDerogatory(e.target.value)} />
        </label>
        <button type="submit" className="col-span-2 mt-1 rounded-md bg-slate-800 px-3 py-1.5 font-medium text-white hover:bg-slate-900">
          Save this month's score
        </button>
      </form>

      {recommendations && (
        <div className="mt-4 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{recommendations.score_band} - recommendations</p>
          {recommendations.recommendations.map((r) => (
            <div key={r.title} className={`rounded-md border-l-4 bg-slate-50 p-2 ${PRIORITY_STYLES[r.priority]}`}>
              <p className="text-xs font-semibold text-slate-800">{r.title}</p>
              <p className="text-xs text-slate-600">{r.detail}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ResultRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-100 py-1.5 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="font-semibold text-slate-800">{value}</span>
    </div>
  );
}

function BorrowingCapacityCalculator() {
  const [extraDebt, setExtraDebt] = useState("0");
  const [rate, setRate] = useState("6.5");
  const [term, setTerm] = useState("30");
  const [downPct, setDownPct] = useState("20");
  const [result, setResult] = useState<BorrowingCapacityOut | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      CreditApi.borrowingCapacity({
        extra_monthly_debt: parseFloat(extraDebt || "0"),
        interest_rate_pct: parseFloat(rate || "6.5"),
        term_years: parseInt(term || "30", 10),
        down_payment_pct: parseFloat(downPct || "20"),
      }),
    onSuccess: setResult,
  });

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-700">What could we qualify for?</h2>
      <p className="mt-1 text-xs text-slate-400">
        Rough estimates for a mortgage, an SBA-style business acquisition loan, and an investment property, based on your
        household income, debts, credit scores, and liquid savings.
      </p>

      <form
        className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4"
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
      >
        <label>
          Other monthly debt
          <input type="number" className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1" value={extraDebt} onChange={(e) => setExtraDebt(e.target.value)} />
        </label>
        <label>
          Interest rate %
          <input type="number" step="0.1" className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1" value={rate} onChange={(e) => setRate(e.target.value)} />
        </label>
        <label>
          Term (years)
          <input type="number" className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1" value={term} onChange={(e) => setTerm(e.target.value)} />
        </label>
        <label>
          Down payment %
          <input type="number" className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1" value={downPct} onChange={(e) => setDownPct(e.target.value)} />
        </label>
        <button type="submit" className="col-span-2 mt-1 rounded-md bg-brand-600 px-3 py-1.5 font-medium text-white hover:bg-brand-700 sm:col-span-4">
          {mutation.isPending ? "Calculating..." : "Calculate"}
        </button>
      </form>

      {result && (
        <div className="mt-4 space-y-4">
          <div>
            <ResultRow label="Monthly gross income" value={formatCurrency(result.monthly_gross_income)} />
            <ResultRow label="Monthly debt payments" value={formatCurrency(result.monthly_debt_payments)} />
            <ResultRow label="Current debt-to-income" value={formatPercent(result.current_dti_pct)} />
            <ResultRow label="Max monthly housing payment" value={formatCurrency(result.max_monthly_housing_payment)} />
            <ResultRow label="Estimated max home price" value={formatCurrency(result.estimated_max_home_price)} />
            <ResultRow label="Required down payment" value={formatCurrency(result.required_down_payment)} />
            <ResultRow label="Liquid cash reserves" value={formatCurrency(result.cash_reserves)} />
            <ResultRow label="Down payment shortfall" value={formatCurrency(result.down_payment_shortfall)} />
          </div>
          <div className="space-y-2 text-sm">
            <p>
              <span className="font-semibold text-slate-700">Mortgage: </span>
              {result.mortgage_readiness}
            </p>
            <p>
              <span className="font-semibold text-slate-700">Business acquisition loan: </span>
              {result.business_loan_readiness}
            </p>
            <p>
              <span className="font-semibold text-slate-700">Investment property: </span>
              {result.real_estate_investment_readiness}
            </p>
          </div>
          <div className="space-y-1 rounded-md bg-slate-50 p-3 text-xs text-slate-500">
            {result.notes.map((note, i) => (
              <p key={i}>{note}</p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Credit() {
  const { data: members, isLoading } = useQuery({ queryKey: ["household-members"], queryFn: HouseholdApi.members });

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-slate-900">Credit & Loans</h1>
      <HouseholdIncomeForm />

      {isLoading && <p className="text-slate-500">Loading...</p>}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {(members ?? []).map((m) => (
          <CreditProfileCard key={m.id} user={m} />
        ))}
      </div>

      <BorrowingCapacityCalculator />
    </div>
  );
}
