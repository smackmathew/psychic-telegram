import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { BudgetsApi, CategoriesApi } from "../api/endpoints";
import { formatCurrency, formatPercent } from "../utils/format";

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`;
}

function NewBudgetForm({ month, onCreated }: { month: string; onCreated: () => void }) {
  const { data: categories } = useQuery({ queryKey: ["categories"], queryFn: CategoriesApi.list });
  const expenseCategories = (categories ?? []).filter((c) => c.type === "expense");
  const [categoryId, setCategoryId] = useState("");
  const [amount, setAmount] = useState("");

  const mutation = useMutation({
    mutationFn: () => BudgetsApi.create({ category_id: categoryId, month, amount_limit: parseFloat(amount) }),
    onSuccess: () => {
      setAmount("");
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
        <label className="block text-xs font-medium text-slate-500">Category</label>
        <select className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} required>
          <option value="" disabled>
            Choose...
          </option>
          {expenseCategories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-500">Monthly limit</label>
        <input
          type="number"
          step="0.01"
          className="mt-1 w-32 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
        />
      </div>
      <button type="submit" className="rounded-md bg-slate-800 px-3 py-2 text-sm font-medium text-white hover:bg-slate-900">
        Set budget
      </button>
    </form>
  );
}

export default function Budgets() {
  const queryClient = useQueryClient();
  const [monthOffset, setMonthOffset] = useState(0);
  const month = monthKey(new Date(new Date().getFullYear(), new Date().getMonth() + monthOffset, 1));

  const { data: budgets, isLoading } = useQuery({ queryKey: ["budgets", month], queryFn: () => BudgetsApi.list(month) });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["budgets"] });
  const remove = useMutation({ mutationFn: (id: string) => BudgetsApi.remove(id), onSuccess: invalidate });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-900">Budgets</h1>
        <div className="flex items-center gap-2 text-sm">
          <button className="rounded-md border border-slate-300 px-2 py-1" onClick={() => setMonthOffset((m) => m - 1)}>
            ←
          </button>
          <span className="font-medium text-slate-700">
            {new Date(month).toLocaleDateString("en-US", { month: "long", year: "numeric" })}
          </span>
          <button className="rounded-md border border-slate-300 px-2 py-1" onClick={() => setMonthOffset((m) => m + 1)}>
            →
          </button>
        </div>
      </div>

      <NewBudgetForm month={month} onCreated={invalidate} />

      {isLoading && <p className="text-slate-500">Loading budgets...</p>}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {(budgets ?? []).map((b) => {
          const overBudget = b.pct_used >= 100;
          const nearLimit = b.pct_used >= 90;
          return (
            <div key={b.budget.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-800">{b.budget.category.name}</span>
                <button className="text-xs text-red-500 hover:underline" onClick={() => remove.mutate(b.budget.id)}>
                  Remove
                </button>
              </div>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className={`h-full rounded-full ${overBudget ? "bg-red-500" : nearLimit ? "bg-amber-500" : "bg-brand-500"}`}
                  style={{ width: `${Math.min(b.pct_used, 100)}%` }}
                />
              </div>
              <div className="mt-2 flex justify-between text-xs text-slate-500">
                <span>
                  {formatCurrency(b.spent)} of {formatCurrency(b.budget.amount_limit)}
                </span>
                <span>{formatPercent(b.pct_used)}</span>
              </div>
            </div>
          );
        })}
      </div>

      {budgets && budgets.length === 0 && <p className="text-slate-500">No budgets set for this month yet.</p>}
    </div>
  );
}
