import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AccountsApi, CategoriesApi, TransactionsApi } from "../api/endpoints";
import { toDateString } from "../firebase/dates";
import type { Category, Transaction, TransactionDirection } from "../types";
import { formatCurrencyExact, formatDate } from "../utils/format";

function NewTransactionForm({ onCreated }: { onCreated: () => void }) {
  const { data: accounts } = useQuery({ queryKey: ["accounts"], queryFn: AccountsApi.list });
  const { data: categories } = useQuery({ queryKey: ["categories"], queryFn: CategoriesApi.list });

  const [accountId, setAccountId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [direction, setDirection] = useState<TransactionDirection>("debit");
  const [date, setDate] = useState(() => toDateString(new Date()));

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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong";
}

const editInputClass = "mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm";

function EditTransactionRow({
  transaction: t,
  accountName,
  categories,
  onDone,
}: {
  transaction: Transaction;
  accountName: string;
  categories: Category[];
  onDone: (saved: boolean) => void;
}) {
  const [name, setName] = useState(t.name);
  const [amount, setAmount] = useState(String(t.amount));
  const [date, setDate] = useState(t.date);
  const [categoryId, setCategoryId] = useState(t.category_id ?? "");
  const [notes, setNotes] = useState(t.notes ?? "");

  const save = useMutation({
    mutationFn: () =>
      TransactionsApi.update(t.id, {
        category_id: categoryId || null,
        notes: notes.trim() || null,
        // The bank owns these on imported transactions; only manual ones can change them.
        ...(t.is_manual ? { name: name.trim(), amount: parseFloat(amount), date } : {}),
      }),
    onSuccess: () => onDone(true),
  });

  return (
    <tr className="bg-slate-50">
      <td colSpan={6} className="px-4 py-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <div className="flex flex-wrap items-end gap-3">
            {t.is_manual ? (
              <>
                <div>
                  <label className="block text-xs font-medium text-slate-500">Date</label>
                  <input type="date" className={editInputClass} value={date} onChange={(e) => setDate(e.target.value)} required />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500">Description</label>
                  <input className={`${editInputClass} w-44`} value={name} onChange={(e) => setName(e.target.value)} required />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500">
                    Amount ({t.direction === "credit" ? "money in" : "money out"})
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    className={`${editInputClass} w-28`}
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    required
                  />
                </div>
              </>
            ) : (
              <div className="text-sm">
                <p className="font-medium text-slate-800">{t.name}</p>
                <p className="text-xs text-slate-500">
                  {formatDate(t.date)} · {formatCurrencyExact(t.amount)} · {accountName}
                </p>
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-slate-500">Category</label>
              <select className={editInputClass} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">Uncategorized</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="min-w-48 flex-1">
              <label className="block text-xs font-medium text-slate-500">Notes</label>
              <input className={`${editInputClass} w-full`} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <button
              type="submit"
              disabled={save.isPending}
              className="rounded-md bg-slate-800 px-3 py-2 text-sm font-medium text-white hover:bg-slate-900 disabled:opacity-50"
            >
              Save
            </button>
            <button type="button" className="px-2 py-2 text-sm text-slate-500 hover:text-slate-800" onClick={() => onDone(false)}>
              Cancel
            </button>
          </div>
          {!t.is_manual && (
            <p className="mt-2 text-xs text-slate-400">
              Imported from your bank: its date, description and amount update with each sync, so only the category and notes can be changed here.
            </p>
          )}
          {save.error && <p className="mt-2 text-sm text-red-600">{errorMessage(save.error)}</p>}
        </form>
      </td>
    </tr>
  );
}

export default function Transactions() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [accountFilter, setAccountFilter] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
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
            {(transactions ?? []).map((t) =>
              t.id === editingId ? (
                <EditTransactionRow
                  key={t.id}
                  transaction={t}
                  accountName={accountName(t.account_id)}
                  categories={categories ?? []}
                  onDone={(saved) => {
                    setEditingId(null);
                    if (saved) invalidate();
                  }}
                />
              ) : (
                <tr key={t.id}>
                  <td className="whitespace-nowrap px-4 py-2 text-slate-500">{formatDate(t.date)}</td>
                  <td className="px-4 py-2 font-medium text-slate-800">
                    {t.name}
                    {t.pending && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">pending</span>}
                    {t.notes && <p className="text-xs font-normal text-slate-500">{t.notes}</p>}
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
                    {formatCurrencyExact(t.amount)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-right text-xs">
                    <button className="text-slate-600 hover:underline" onClick={() => setEditingId(t.id)}>
                      Edit
                    </button>
                    <button className="ml-3 text-red-500 hover:underline" onClick={() => remove.mutate(t.id)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
        {isLoading && <p className="p-4 text-sm text-slate-400">Loading...</p>}
        {transactions && transactions.length === 0 && <p className="p-4 text-sm text-slate-400">No transactions found.</p>}
      </div>
    </div>
  );
}
