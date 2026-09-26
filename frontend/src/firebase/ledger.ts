import {
  doc,
  getDoc,
  getDocs,
  increment,
  query,
  serverTimestamp,
  where,
  writeBatch,
  type DocumentSnapshot,
} from "firebase/firestore";
import type { Account, Category, CategoryType, Transaction, TransactionDirection } from "../types";
import { db } from "./app";
import { transactionDelta } from "./finance";
import { fromCents, fromCentsOrNull, toCents, toCentsOrNull } from "./money";
import { commit, householdCollection, isoString, snapshotData } from "./session";

// Firestore allows at most 500 writes per batch.
const MAX_BATCH_WRITES = 500;

// ---------- Accounts ----------

function toAccount(snap: DocumentSnapshot): Account {
  const d = snapshotData(snap);
  return {
    id: snap.id,
    name: d.name,
    institution_name: d.institution_name ?? null,
    type: d.type,
    current_balance: fromCents(d.current_balance_cents),
    available_balance: fromCentsOrNull(d.available_balance_cents),
    monthly_payment: fromCentsOrNull(d.monthly_payment_cents),
    currency: d.currency ?? "USD",
    is_manual: d.is_manual ?? true,
    plaid_item_id: d.plaid_item_id ?? null,
    updated_at: isoString(d.updated_at),
  };
}

function accountFields(payload: Partial<Account>): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  if (payload.name !== undefined) fields.name = payload.name;
  if (payload.institution_name !== undefined) fields.institution_name = payload.institution_name;
  if (payload.type !== undefined) fields.type = payload.type;
  if (payload.currency !== undefined) fields.currency = payload.currency;
  if (payload.current_balance !== undefined) fields.current_balance_cents = toCents(payload.current_balance);
  if (payload.available_balance !== undefined) fields.available_balance_cents = toCentsOrNull(payload.available_balance);
  if (payload.monthly_payment !== undefined) fields.monthly_payment_cents = toCentsOrNull(payload.monthly_payment);
  return fields;
}

async function getAccountSnap(id: string): Promise<DocumentSnapshot> {
  const snap = await getDoc(doc(householdCollection("accounts"), id));
  if (!snap.exists()) throw new Error("Account not found");
  return snap;
}

export const AccountsApi = {
  list: async (): Promise<Account[]> => {
    const snap = await getDocs(householdCollection("accounts"));
    return snap.docs
      .map((d) => ({ account: toAccount(d), createdAt: snapshotData(d).created_at?.toMillis?.() ?? Date.now() }))
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((a) => a.account);
  },

  create: async (payload: Partial<Account>): Promise<Account> => {
    const ref = doc(householdCollection("accounts"));
    const batch = writeBatch(db);
    batch.set(ref, {
      name: payload.name,
      institution_name: payload.institution_name ?? null,
      type: payload.type ?? "other",
      current_balance_cents: toCents(payload.current_balance ?? 0),
      available_balance_cents: toCentsOrNull(payload.available_balance),
      monthly_payment_cents: toCentsOrNull(payload.monthly_payment),
      currency: payload.currency ?? "USD",
      is_manual: true,
      plaid_item_id: null,
      created_at: serverTimestamp(),
      updated_at: serverTimestamp(),
    });
    await commit(batch);
    return toAccount(await getDoc(ref));
  },

  update: async (id: string, payload: Partial<Account>): Promise<Account> => {
    const snap = await getAccountSnap(id);
    const batch = writeBatch(db);
    batch.update(snap.ref, { ...accountFields(payload), updated_at: serverTimestamp() });
    await commit(batch);
    return toAccount(await getDoc(snap.ref));
  },

  /** Deletes the account and all of its transactions. */
  remove: async (id: string): Promise<void> => {
    const snap = await getAccountSnap(id);
    const transactions = await getDocs(query(householdCollection("transactions"), where("account_id", "==", id)));
    const refs = [...transactions.docs.map((d) => d.ref), snap.ref]; // the account goes last
    for (let i = 0; i < refs.length; i += MAX_BATCH_WRITES) {
      const batch = writeBatch(db);
      refs.slice(i, i + MAX_BATCH_WRITES).forEach((ref) => batch.delete(ref));
      await commit(batch);
    }
  },
};

// ---------- Categories ----------

export const CategoriesApi = {
  list: async (): Promise<Category[]> => {
    const snap = await getDocs(householdCollection("categories"));
    return snap.docs
      .map((d) => ({ id: d.id, name: d.data().name, type: d.data().type, icon: d.data().icon ?? null, is_default: !!d.data().is_default }))
      .sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
  },

  create: async (payload: { name: string; type: string; icon?: string }): Promise<Category> => {
    const ref = doc(householdCollection("categories"));
    const category = { name: payload.name, type: payload.type as CategoryType, icon: payload.icon ?? null, is_default: false };
    const batch = writeBatch(db);
    batch.set(ref, category);
    await commit(batch);
    return { id: ref.id, ...category };
  },
};

// ---------- Transactions ----------

function toTransaction(snap: DocumentSnapshot): Transaction {
  const d = snapshotData(snap);
  return {
    id: snap.id,
    account_id: d.account_id,
    category_id: d.category_id ?? null,
    date: d.date,
    amount: fromCents(d.amount_cents),
    direction: d.direction,
    name: d.name,
    merchant_name: d.merchant_name ?? null,
    notes: d.notes ?? null,
    pending: d.pending ?? false,
    is_manual: d.is_manual ?? true,
    created_at: isoString(d.created_at),
  };
}

function requirePositive(amount: number | null | undefined): number {
  if (amount == null || !(amount > 0)) throw new Error("Amount must be greater than 0");
  return amount;
}

export interface TransactionFilters {
  account_id?: string;
  category_id?: string;
  start_date?: string;
  end_date?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

/** Every transaction in the household, in no particular order. */
export async function allTransactions(): Promise<Transaction[]> {
  const snap = await getDocs(householdCollection("transactions"));
  return snap.docs.map(toTransaction);
}

export const TransactionsApi = {
  /** Newest first. Filtering happens here rather than in the query, so no composite indexes are needed. */
  list: async (params: TransactionFilters = {}): Promise<Transaction[]> => {
    const search = params.search?.toLowerCase();
    const limit = params.limit ?? 200;
    const offset = params.offset ?? 0;
    return (await allTransactions())
      .filter(
        (t) =>
          (!params.account_id || t.account_id === params.account_id) &&
          (!params.category_id || t.category_id === params.category_id) &&
          (!params.start_date || t.date >= params.start_date) &&
          (!params.end_date || t.date <= params.end_date) &&
          (!search || t.name.toLowerCase().includes(search)),
      )
      .sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at))
      .slice(offset, offset + limit);
  },

  /** Adds a transaction and applies its effect to the account balance, atomically. */
  create: async (payload: Partial<Transaction>): Promise<Transaction> => {
    const amount = requirePositive(payload.amount);
    const account = await getAccountSnap(payload.account_id ?? "");
    const direction = payload.direction as TransactionDirection;
    const ref = doc(householdCollection("transactions"));

    const batch = writeBatch(db);
    batch.set(ref, {
      account_id: account.id,
      category_id: payload.category_id ?? null,
      date: payload.date,
      amount_cents: toCents(amount),
      direction,
      name: payload.name,
      merchant_name: payload.merchant_name ?? null,
      notes: payload.notes ?? null,
      pending: false,
      is_manual: true,
      created_at: serverTimestamp(),
    });
    batch.update(account.ref, {
      current_balance_cents: increment(toCents(transactionDelta(snapshotData(account).type, amount, direction))),
      updated_at: serverTimestamp(),
    });
    await commit(batch);
    return toTransaction(await getDoc(ref));
  },

  /** Edits a transaction. Changing the amount moves the account balance by the difference. */
  update: async (
    id: string,
    payload: Partial<Pick<Transaction, "category_id" | "notes" | "name" | "amount" | "date">>,
  ): Promise<Transaction> => {
    const snap = await getDoc(doc(householdCollection("transactions"), id));
    if (!snap.exists()) throw new Error("Transaction not found");
    const current = toTransaction(snap);

    const changes: Record<string, unknown> = {};
    if (payload.category_id !== undefined) changes.category_id = payload.category_id;
    if (payload.notes !== undefined) changes.notes = payload.notes;
    if (payload.name !== undefined) changes.name = payload.name;
    if (payload.date !== undefined) changes.date = payload.date;

    const batch = writeBatch(db);
    if (payload.amount !== undefined) {
      const amount = requirePositive(payload.amount);
      changes.amount_cents = toCents(amount);
      if (amount !== current.amount) {
        const account = await getAccountSnap(current.account_id);
        const type = snapshotData(account).type;
        const change = transactionDelta(type, amount, current.direction) - transactionDelta(type, current.amount, current.direction);
        batch.update(account.ref, { current_balance_cents: increment(toCents(change)), updated_at: serverTimestamp() });
      }
    }
    batch.update(snap.ref, changes);
    await commit(batch);
    return toTransaction(await getDoc(snap.ref));
  },

  /** Deletes a transaction and undoes its effect on the account balance. */
  remove: async (id: string): Promise<void> => {
    const snap = await getDoc(doc(householdCollection("transactions"), id));
    if (!snap.exists()) throw new Error("Transaction not found");
    const txn = toTransaction(snap);
    const account = await getAccountSnap(txn.account_id);

    const batch = writeBatch(db);
    batch.delete(snap.ref);
    batch.update(account.ref, {
      current_balance_cents: increment(-toCents(transactionDelta(snapshotData(account).type, txn.amount, txn.direction))),
      updated_at: serverTimestamp(),
    });
    await commit(batch);
  },
};
