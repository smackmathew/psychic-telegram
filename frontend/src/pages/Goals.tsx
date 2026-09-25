import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { GoalsApi } from "../api/endpoints";
import type { GoalType } from "../types";
import { formatCurrency, formatPercent } from "../utils/format";

const GOAL_TYPES: { value: GoalType; label: string }[] = [
  { value: "savings", label: "Savings" },
  { value: "debt_payoff", label: "Debt payoff" },
  { value: "investment", label: "Investment" },
];

function NewGoalForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [type, setType] = useState<GoalType>("savings");
  const [targetAmount, setTargetAmount] = useState("");
  const [currentAmount, setCurrentAmount] = useState("");
  const [targetDate, setTargetDate] = useState("");

  const mutation = useMutation({
    mutationFn: () =>
      GoalsApi.create({
        name,
        type,
        target_amount: parseFloat(targetAmount),
        current_amount: parseFloat(currentAmount || "0"),
        target_date: targetDate || null,
      }),
    onSuccess: () => {
      setName("");
      setTargetAmount("");
      setCurrentAmount("");
      setTargetDate("");
      onCreated();
    },
  });

  return (
    <form
      className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
      onSubmit={(e) => {
        e.preventDefault();
        mutation.mutate();
      }}
    >
      <div>
        <label className="block text-xs font-medium text-slate-500">Goal name</label>
        <input className="mt-1 w-40 rounded-md border border-slate-300 px-2 py-1.5 text-sm" value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-500">Type</label>
        <select className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm" value={type} onChange={(e) => setType(e.target.value as GoalType)}>
          {GOAL_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-500">Target amount</label>
        <input
          type="number"
          step="0.01"
          className="mt-1 w-32 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          value={targetAmount}
          onChange={(e) => setTargetAmount(e.target.value)}
          required
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-500">Current amount</label>
        <input
          type="number"
          step="0.01"
          className="mt-1 w-32 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          value={currentAmount}
          onChange={(e) => setCurrentAmount(e.target.value)}
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-500">Target date</label>
        <input type="date" className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
      </div>
      <button type="submit" className="rounded-md bg-slate-800 px-3 py-2 text-sm font-medium text-white hover:bg-slate-900">
        Add goal
      </button>
    </form>
  );
}

export default function Goals() {
  const queryClient = useQueryClient();
  const { data: goals, isLoading } = useQuery({ queryKey: ["goals"], queryFn: GoalsApi.list });
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["goals"] });
    queryClient.invalidateQueries({ queryKey: ["notifications"] });
  };
  const update = useMutation({
    mutationFn: ({ id, current_amount }: { id: string; current_amount: number }) => GoalsApi.update(id, { current_amount }),
    onSuccess: invalidate,
  });
  const remove = useMutation({ mutationFn: (id: string) => GoalsApi.remove(id), onSuccess: invalidate });

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-slate-900">Goals</h1>
      <NewGoalForm onCreated={invalidate} />

      {isLoading && <p className="text-slate-500">Loading goals...</p>}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {(goals ?? []).map((g) => {
          const pct = g.target_amount > 0 ? Math.min((g.current_amount / g.target_amount) * 100, 100) : 0;
          return (
            <div key={g.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-slate-800">{g.name}</p>
                  <p className="text-xs uppercase tracking-wide text-slate-400">{g.type.replace("_", " ")}</p>
                </div>
                <button className="text-xs text-red-500 hover:underline" onClick={() => remove.mutate(g.id)}>
                  Remove
                </button>
              </div>
              <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
              </div>
              <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                <span>
                  {formatCurrency(g.current_amount)} of {formatCurrency(g.target_amount)}
                </span>
                <span>{formatPercent(pct)}</span>
              </div>
              {g.target_date && <p className="mt-1 text-xs text-slate-400">Target: {new Date(g.target_date).toLocaleDateString()}</p>}
              <div className="mt-3 flex items-center gap-2">
                <input
                  type="number"
                  step="0.01"
                  placeholder="Update current amount"
                  className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const value = parseFloat((e.target as HTMLInputElement).value);
                      if (!Number.isNaN(value)) update.mutate({ id: g.id, current_amount: value });
                    }
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {goals && goals.length === 0 && <p className="text-slate-500">No goals yet - add one above.</p>}
    </div>
  );
}
