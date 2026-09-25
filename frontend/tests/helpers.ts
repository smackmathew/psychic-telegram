import { AuthApi } from "../src/firebase/household";
import { AccountsApi, CategoriesApi, TransactionsApi } from "../src/firebase/ledger";
import type { Account, Transaction } from "../src/types";

export const TODAY = new Date().toISOString().slice(0, 10);

export function daysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

let counter = 0;

/** Signs up a fresh user in a brand-new household, so each test starts from empty data. */
export async function signUpNewHousehold(fullName = "Alex") {
  counter += 1;
  const email = `user${Date.now()}-${counter}@example.com`;
  const user = await AuthApi.signup({ full_name: fullName, email, password: "password123", household_name: "Test Household" });
  return { user, email };
}

export async function createAccount(fields: Partial<Account> = {}): Promise<Account> {
  return AccountsApi.create({ name: "Checking", type: "checking", current_balance: 0, ...fields });
}

export async function createTransaction(accountId: string, fields: Partial<Transaction> = {}): Promise<Transaction> {
  return TransactionsApi.create({ account_id: accountId, name: "Txn", direction: "debit", amount: 10, date: TODAY, ...fields });
}

export async function balance(accountId: string): Promise<number> {
  const accounts = await AccountsApi.list();
  return accounts.find((a) => a.id === accountId)!.current_balance;
}

export async function categoryId(name: string): Promise<string> {
  const categories = await CategoriesApi.list();
  return categories.find((c) => c.name === name)!.id;
}
