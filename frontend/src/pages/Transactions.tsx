import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AccountsApi, CategoriesApi, TransactionsApi } from "../api/endpoints";
import type { TransactionDirection } from "../types";
import { formatCurrency, formatDate } from "../utils/format";

function NewTransactionForm({ onCreated }: { onCreated: () => void }) {
  const { data: accounts } = useQuery({ queryKey: ["accounts"], queryFn: AccountsApi.list });
  const { data: categories } = useQuery({ queryKey: ["categories"], queryFn: CategoriesApi.list });

  const [accountId, setAccountId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [direction, setDirection] = useState<TransactionDirection>("debit");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));

  const mutation = useMutation({
    mutationFn: () =>
      TransactionsApi.create({
        account_id: accountId,
        category_id: categoryId || null,
        name,
        amount: parseFloat(amount),
        direction,
        date,
      }),
    onSuccess: () => {
      setName("");
      setAmount("");
      onCreated();
    },
  });

  if (!accounts || accounts.length === 0) {
    return <p className="text-sm text-slate-400">Add an account first to start logging transactions.</p>;
  }

  return (
    <form
      className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
      onSubmit={(e) => {
        e.preventDefault();
        mutation.mutate();
      }}
    >
      <div>
        <label className="block text-xs font-medium text-slate-500">Account</label>
        <select className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm" value={accountId} onChange={(e) => setAccountId(e.target.value)} required>
          <option value="" disabled>
            Choose...
          </option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-500">Description</label>
        <input className="mt-1 w-40 rounded-md border border-slate-300 px-2 py-1.5 text-sm" value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-500">Amount</label>
        <input
          type="number"
          step="0.01"
          className="mt-1 w-28 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-500">Direction</label>
        <select
          className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          value={direction}
          onChange={(e) => setDirection(e.target.value as TransactionDirection)}
        >
          <option value="debit">Money out</option>
          <option value="credit">Money in</option>
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-500">Category</label>
        <select className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">Uncategorized</option>
          {(categories ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-500">Date</label>
        <input type="date" className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      <button type="submit" className="rounded-md bg-slate-800 px-3 py-2 text-sm font-medium text-white hover:bg-slate-900">
        Add
      </button>
    </form>
  );
}

export default function Transactions() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [accountFilter, setAccountFilter] = useState("");
  const { data: accounts } = useQuery({ queryKey: ["accounts"], queryFn: AccountsApi.list });
  const { data: categories } = useQuery({ queryKey: ["categories"], queryFn: CategoriesApi.list });
  const { data: transactions, isLoading } = useQuery({
    queryKey: ["transactions", accountFilter, search],
    queryFn: () => TransactionsApi.list({ account_id: accountFilter || undefined, search: search || undefined }),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["transactions"] });
    queryClient.invalidateQueries({ queryKey: ["accounts"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard-summary"] });
  };

  const categorize = useMutation({
    mutationFn: ({ id, category_id }: { id: string; category_id: string }) => TransactionsApi.update(id, { category_id: category_id || null }),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) => TransactionsApi.remove(id),
    onSuccess: invalidate,
  });

  const accountName = (id: string) => accounts?.find((a) => a.id === id)?.name ?? "";

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-slate-900">Transactions</h1>
      <NewTransactionForm onCreated={invalidate} />

      <div className="flex flex-wrap gap-3">
        <input
          placeholder="Search..."
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="rounded-md border border-slate-300 px-3 py-1.5 text-sm" value={accountFilter} onChange={(e) => setAccountFilter(e.target.value)}>
          <option value="">All accounts</option>
          {(accounts ?? []).map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-slate-100 text-sm">
          <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2">Date</th>
              <th className="px-4 py-2">Description</th>
              <th className="px-4 py-2">Account</th>
              <th className="px-4 py-2">Category</th>
              <th className="px-4 py-2 text-right">Amount</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(transactions ?? []).map((t) => (
              <tr key={t.id}>
                <td className="whitespace-nowrap px-4 py-2 text-slate-500">{formatDate(t.date)}</td>
                <td className="px-4 py-2 font-medium text-slate-800">
                  {t.name}
                  {t.pending && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">pending</span>}
                </td>
                <td className="px-4 py-2 text-slate-500">{accountName(t.account_id)}</td>
                <td className="px-4 py-2">
                  <select
                    className="rounded-md border border-slate-200 px-2 py-1 text-xs"
                    value={t.category_id ?? ""}
                    onChange={(e) => categorize.mutate({ id: t.id, category_id: e.target.value })}
                  >
                    <option value="">Uncategorized</option>
                    {(categories ?? []).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className={`px-4 py-2 text-right font-semibold ${t.direction === "credit" ? "text-emerald-600" : "text-slate-800"}`}>
                  {t.direction === "credit" ? "+" : "-"}
                  {formatCurrency(t.amount)}
                </td>
                <td className="px-4 py-2 text-right">
                  <button className="text-xs text-red-500 hover:underline" onClick={() => remove.mutate(t.id)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {isLoading && <p className="p-4 text-sm text-slate-400">Loading...</p>}
        {transactions && transactions.length === 0 && <p className="p-4 text-sm text-slate-400">No transactions found.</p>}
      </div>
    </div>
  );
}
