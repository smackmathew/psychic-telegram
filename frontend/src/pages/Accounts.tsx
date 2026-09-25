import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { usePlaidLink } from "react-plaid-link";
import { AccountsApi, PlaidApi } from "../api/endpoints";
import type { Account, AccountType } from "../types";
import { formatCurrency } from "../utils/format";

const ACCOUNT_TYPES: AccountType[] = ["checking", "savings", "credit_card", "investment", "loan", "other"];

function PlaidLinkButton({ onLinked }: { onLinked: () => void }) {
  const queryClient = useQueryClient();
  const { data: status } = useQuery({ queryKey: ["plaid-status"], queryFn: PlaidApi.status });
  const { data: linkToken } = useQuery({
    queryKey: ["plaid-link-token"],
    queryFn: PlaidApi.createLinkToken,
    enabled: !!status?.enabled,
    select: (d) => d.link_token,
    retry: false,
  });

  const { open, ready } = usePlaidLink({
    token: linkToken ?? "",
    onSuccess: async (public_token, metadata) => {
      await PlaidApi.exchangePublicToken(public_token, metadata.institution?.name ?? undefined);
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      onLinked();
    },
  });

  if (!status?.enabled) {
    return (
      <p className="text-xs text-slate-400">
        Bank sync isn't configured yet - add PLAID_CLIENT_ID / PLAID_SECRET to the backend environment to enable it.
      </p>
    );
  }

  return (
    <button
      onClick={() => open()}
      disabled={!ready || !linkToken}
      className="rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
    >
      Link a bank account
    </button>
  );
}

function NewAccountForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [type, setType] = useState<AccountType>("checking");
  const [balance, setBalance] = useState("");
  const mutation = useMutation({
    mutationFn: () =>
      AccountsApi.create({ name, type, current_balance: parseFloat(balance || "0") }),
    onSuccess: () => {
      setName("");
      setBalance("");
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
        <label className="block text-xs font-medium text-slate-500">Name</label>
        <input
          className="mt-1 w-40 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-500">Type</label>
        <select className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm" value={type} onChange={(e) => setType(e.target.value as AccountType)}>
          {ACCOUNT_TYPES.map((t) => (
            <option key={t} value={t}>
              {t.replace("_", " ")}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-500">Balance</label>
        <input
          type="number"
          step="0.01"
          className="mt-1 w-32 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          value={balance}
          onChange={(e) => setBalance(e.target.value)}
        />
      </div>
      <button type="submit" className="rounded-md bg-slate-800 px-3 py-2 text-sm font-medium text-white hover:bg-slate-900">
        Add manual account
      </button>
    </form>
  );
}

export default function Accounts() {
  const queryClient = useQueryClient();
  const { data: accounts, isLoading } = useQuery({ queryKey: ["accounts"], queryFn: AccountsApi.list });
  const removeMutation = useMutation({
    mutationFn: (id: string) => AccountsApi.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["accounts"] }),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["accounts"] });

  const grouped = (accounts ?? []).reduce<Record<string, Account[]>>((acc, account) => {
    acc[account.type] = acc[account.type] ?? [];
    acc[account.type].push(account);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-slate-900">Accounts</h1>
        <PlaidLinkButton onLinked={invalidate} />
      </div>

      <NewAccountForm onCreated={invalidate} />

      {isLoading && <p className="text-slate-500">Loading accounts...</p>}

      {Object.entries(grouped).map(([type, list]) => (
        <div key={type} className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-2 text-sm font-semibold capitalize text-slate-600">
            {type.replace("_", " ")}
          </div>
          <div className="divide-y divide-slate-100">
            {list.map((account) => (
              <div key={account.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-slate-800">{account.name}</p>
                  <p className="text-xs text-slate-400">
                    {account.is_manual ? "Manual" : account.institution_name ?? "Linked"}
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-sm font-semibold text-slate-800">{formatCurrency(account.current_balance)}</span>
                  {account.is_manual && (
                    <button
                      className="text-xs font-medium text-red-500 hover:underline"
                      onClick={() => removeMutation.mutate(account.id)}
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {accounts && accounts.length === 0 && <p className="text-slate-500">No accounts yet - add one above or link a bank.</p>}
    </div>
  );
}
