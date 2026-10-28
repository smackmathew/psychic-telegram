import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AccountsApi, CategoriesApi, RecurringBillsApi } from "../api/endpoints";
import { daysBetween, nextDueDate, toDateString } from "../firebase/dates";
import type { Account, Category, RecurringBill } from "../types";
import { formatCurrencyExact, formatDate, ordinal } from "../utils/format";

type BillDraft = { name: string; amount: string; dueDay: string; categoryId: string; accountId: string };

const EMPTY_DRAFT: BillDraft = { name: "", amount: "", dueDay: "", categoryId: "", accountId: "" };

function toDraft(bill: RecurringBill): BillDraft {
  return {
    name: bill.name,
    amount: String(bill.amount),
    dueDay: String(bill.due_day),
    categoryId: bill.category_id ?? "",
    accountId: bill.account_id ?? "",
  };
}

function fromDraft(draft: BillDraft): Partial<RecurringBill> {
  return {
    name: draft.name.trim(),
    amount: parseFloat(draft.amount),
    due_day: parseInt(draft.dueDay, 10),
    category_id: draft.categoryId || null,
    account_id: draft.accountId || null,
  };
}

function errorMessage(error: unknown): string | null {
  if (!error) return null;
  return error instanceof Error ? error.message : "Something went wrong";
}

const inputClass = "mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm";

function BillFields({
  draft,
  onChange,
  categories,
  accounts,
}: {
  draft: BillDraft;
  onChange: (draft: BillDraft) => void;
  categories: Category[];
  accounts: Account[];
}) {
  const set = (field: keyof BillDraft) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    onChange({ ...draft, [field]: e.target.value });

  return (
    <>
      <div>
        <label className="block text-xs font-medium text-slate-500">Bill name</label>
        <input className={`${inputClass} w-40`} value={draft.name} onChange={set("name")} required />
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-500">Amount</label>
        <input type="number" step="0.01" min="0.01" className={`${inputClass} w-28`} value={draft.amount} onChange={set("amount")} required />
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-500">Due day (1-28)</label>
        <input type="number" step="1" min="1" max="28" className={`${inputClass} w-20`} value={draft.dueDay} onChange={set("dueDay")} required />
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-500">Category</label>
        <select className={inputClass} value={draft.categoryId} onChange={set("categoryId")}>
          <option value="">Any</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-500">Paid from</label>
        <select className={inputClass} value={draft.accountId} onChange={set("accountId")}>
          <option value="">Not set</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>
    </>
  );
}

function NewBillForm({ categories, accounts, onSaved }: { categories: Category[]; accounts: Account[]; onSaved: () => void }) {
  const [draft, setDraft] = useState<BillDraft>(EMPTY_DRAFT);
  const mutation = useMutation({
    mutationFn: () => RecurringBillsApi.create(fromDraft(draft)),
    onSuccess: () => {
      setDraft(EMPTY_DRAFT);
      onSaved();
    },
  });

  return (
    <form
      className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
      onSubmit={(e) => {
        e.preventDefault();
        mutation.mutate();
      }}
    >
      <div className="flex flex-wrap items-end gap-3">
        <BillFields draft={draft} onChange={setDraft} categories={categories} accounts={accounts} />
        <button
          type="submit"
          disabled={mutation.isPending}
          className="rounded-md bg-slate-800 px-3 py-2 text-sm font-medium text-white hover:bg-slate-900 disabled:opacity-50"
        >
          Add bill
        </button>
      </div>
      {mutation.error && <p className="mt-2 text-sm text-red-600">{errorMessage(mutation.error)}</p>}
      <p className="mt-2 text-xs text-slate-400">
        You'll get a notification a few days before each bill is due, unless a payment within 15% of the amount (in the
        chosen category, if you pick one) has already posted.
      </p>
    </form>
  );
}

function DueLabel({ bill, today }: { bill: RecurringBill; today: string }) {
  if (!bill.is_active) return <span className="text-slate-400">Paused</span>;
  const due = nextDueDate(bill.due_day, today);
  const days = daysBetween(today, due);
  const when = days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;
  return (
    <span className={days <= 3 ? "font-medium text-amber-700" : "text-slate-600"}>
      {formatDate(due)} <span className="text-slate-400">({when})</span>
    </span>
  );
}

function BillRow({
  bill,
  today,
  categories,
  accounts,
  onSaved,
}: {
  bill: RecurringBill;
  today: string;
  categories: Category[];
  accounts: Account[];
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<BillDraft | null>(null);
  const save = useMutation({
    mutationFn: (changes: Partial<RecurringBill>) => RecurringBillsApi.update(bill.id, changes),
    onSuccess: () => {
      setDraft(null);
      onSaved();
    },
  });
  const remove = useMutation({ mutationFn: () => RecurringBillsApi.remove(bill.id), onSuccess: onSaved });

  if (draft) {
    return (
      <tr className="border-t border-slate-100 bg-slate-50">
        <td colSpan={6} className="px-4 py-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate(fromDraft(draft));
            }}
          >
            <div className="flex flex-wrap items-end gap-3">
              <BillFields draft={draft} onChange={setDraft} categories={categories} accounts={accounts} />
              <button type="submit" disabled={save.isPending} className="rounded-md bg-slate-800 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
                Save
              </button>
              <button type="button" className="px-2 py-2 text-sm text-slate-500 hover:text-slate-800" onClick={() => setDraft(null)}>
                Cancel
              </button>
            </div>
            {save.error && <p className="mt-2 text-sm text-red-600">{errorMessage(save.error)}</p>}
          </form>
        </td>
      </tr>
    );
  }

  const category = categories.find((c) => c.id === bill.category_id);
  const account = accounts.find((a) => a.id === bill.account_id);

  return (
    <tr className={`border-t border-slate-100 ${bill.is_active ? "" : "text-slate-400"}`}>
      <td className="px-4 py-2 font-medium">{bill.name}</td>
      <td className="px-4 py-2 text-right">{formatCurrencyExact(bill.amount)}</td>
      <td className="whitespace-nowrap px-4 py-2">
        {ordinal(bill.due_day)}
        <div className="text-xs">
          <DueLabel bill={bill} today={today} />
        </div>
      </td>
      <td className="px-4 py-2 text-slate-500">{category?.name ?? "Any"}</td>
      <td className="px-4 py-2 text-slate-500">{account?.name ?? "-"}</td>
      <td className="whitespace-nowrap px-4 py-2 text-right text-xs">
        <button className="text-slate-600 hover:underline" onClick={() => setDraft(toDraft(bill))}>
          Edit
        </button>
        <button className="ml-3 text-slate-600 hover:underline" onClick={() => save.mutate({ is_active: !bill.is_active })}>
          {bill.is_active ? "Pause" : "Resume"}
        </button>
        <button className="ml-3 text-red-500 hover:underline" onClick={() => remove.mutate()}>
          Remove
        </button>
      </td>
    </tr>
  );
}

export default function Bills() {
  const queryClient = useQueryClient();
  const { data: bills, isLoading } = useQuery({ queryKey: ["recurring-bills"], queryFn: RecurringBillsApi.list });
  const { data: categories } = useQuery({ queryKey: ["categories"], queryFn: CategoriesApi.list });
  const { data: accounts } = useQuery({ queryKey: ["accounts"], queryFn: AccountsApi.list });
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["recurring-bills"] });
    queryClient.invalidateQueries({ queryKey: ["notifications"] });
  };

  const today = toDateString(new Date());
  const expenseCategories = (categories ?? []).filter((c) => c.type === "expense");
  const active = (bills ?? []).filter((b) => b.is_active);
  const monthlyTotal = active.reduce((sum, b) => sum + Math.round(b.amount * 100), 0) / 100;

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-lg font-semibold text-slate-900">Bills</h1>
        {active.length > 0 && (
          <p className="text-sm text-slate-500">
            {active.length} active · <span className="font-semibold text-slate-800">{formatCurrencyExact(monthlyTotal)}</span> a month
          </p>
        )}
      </div>

      <NewBillForm categories={expenseCategories} accounts={accounts ?? []} onSaved={invalidate} />

      {isLoading && <p className="text-slate-500">Loading bills...</p>}

      {bills && bills.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2">Bill</th>
                <th className="px-4 py-2 text-right">Amount</th>
                <th className="px-4 py-2">Due</th>
                <th className="px-4 py-2">Category</th>
                <th className="px-4 py-2">Paid from</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {bills.map((bill) => (
                <BillRow
                  key={bill.id}
                  bill={bill}
                  today={today}
                  categories={expenseCategories}
                  accounts={accounts ?? []}
                  onSaved={invalidate}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {bills && bills.length === 0 && <p className="text-slate-500">No bills yet - add your rent, utilities and subscriptions above.</p>}
    </div>
  );
}
