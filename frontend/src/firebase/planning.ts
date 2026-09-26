import { doc, getDoc, getDocs, serverTimestamp, writeBatch, type DocumentSnapshot } from "firebase/firestore";
import type { BudgetOut, BudgetProgress, Goal, RecurringBill } from "../types";
import { db } from "./app";
import { monthEnd, monthStart, toDateString } from "./dates";
import { allTransactions, CategoriesApi } from "./ledger";
import { fromCents, toCents } from "./money";
import { commit, householdCollection, isoString, snapshotData } from "./session";

function requirePositive(amount: number | null | undefined, label: string): number {
  if (amount == null || !(amount > 0)) throw new Error(`${label} must be greater than 0`);
  return amount;
}

function byCreatedAt(a: DocumentSnapshot, b: DocumentSnapshot): number {
  return (snapshotData(a).created_at?.toMillis() ?? 0) - (snapshotData(b).created_at?.toMillis() ?? 0);
}

// ---------- Budgets ----------

// One budget per category per month: the document ID is built from both, so setting a
// budget again for the same category and month updates it instead of adding a duplicate.
function budgetId(month: string, categoryId: string): string {
  return `${month}_${categoryId}`;
}

export const BudgetsApi = {
  /** Budgets for the month containing `month` (default: this month), with spending so far. */
  list: async (month?: string): Promise<BudgetProgress[]> => {
    const start = monthStart(month ?? toDateString(new Date()));
    const end = monthEnd(start);
    const [budgetSnap, categories, transactions] = await Promise.all([
      getDocs(householdCollection("budgets")),
      CategoriesApi.list(),
      allTransactions(),
    ]);
    const categoriesById = new Map(categories.map((c) => [c.id, c]));

    return budgetSnap.docs
      .filter((d) => d.data().month === start && categoriesById.has(d.data().category_id))
      .sort(byCreatedAt)
      .map((d) => {
        const data = d.data();
        const limitCents = data.amount_limit_cents as number;
        const spentCents = transactions
          .filter((t) => t.category_id === data.category_id && t.direction === "debit" && t.date >= start && t.date <= end)
          .reduce((sum, t) => sum + toCents(t.amount), 0);
        const budget: BudgetOut = {
          id: d.id,
          category_id: data.category_id,
          month: data.month,
          amount_limit: fromCents(limitCents),
          category: categoriesById.get(data.category_id)!,
        };
        return {
          budget,
          spent: fromCents(spentCents),
          remaining: fromCents(Math.max(limitCents - spentCents, 0)),
          pct_used: limitCents ? Math.round((spentCents / limitCents) * 1000) / 10 : 0,
        };
      });
  },

  /** Sets the limit for a category in the month containing `month`. */
  create: async (payload: { category_id: string; month: string; amount_limit: number }): Promise<BudgetOut> => {
    const month = monthStart(payload.month);
    const limit = requirePositive(payload.amount_limit, "Budget");
    const ref = doc(householdCollection("budgets"), budgetId(month, payload.category_id));
    const existing = await getDoc(ref);

    const batch = writeBatch(db);
    batch.set(ref, {
      category_id: payload.category_id,
      month,
      amount_limit_cents: toCents(limit),
      created_at: existing.exists() ? existing.data().created_at : serverTimestamp(),
    });
    await commit(batch);
    const category = (await CategoriesApi.list()).find((c) => c.id === payload.category_id)!;
    return { id: ref.id, category_id: payload.category_id, month, amount_limit: limit, category };
  },

  remove: async (id: string): Promise<void> => {
    const ref = doc(householdCollection("budgets"), id);
    if (!(await getDoc(ref)).exists()) throw new Error("Budget not found");
    const batch = writeBatch(db);
    batch.delete(ref);
    await commit(batch);
  },
};

// ---------- Goals ----------

function toGoal(snap: DocumentSnapshot): Goal {
  const d = snapshotData(snap);
  return {
    id: snap.id,
    name: d.name,
    type: d.type,
    target_amount: fromCents(d.target_amount_cents),
    current_amount: fromCents(d.current_amount_cents),
    target_date: d.target_date ?? null,
    linked_account_id: d.linked_account_id ?? null,
    created_at: isoString(d.created_at),
  };
}

export const GoalsApi = {
  list: async (): Promise<Goal[]> => {
    const snap = await getDocs(householdCollection("goals"));
    return [...snap.docs].sort(byCreatedAt).map(toGoal);
  },

  create: async (payload: Partial<Goal>): Promise<Goal> => {
    const ref = doc(householdCollection("goals"));
    const batch = writeBatch(db);
    batch.set(ref, {
      name: payload.name,
      type: payload.type ?? "savings",
      target_amount_cents: toCents(requirePositive(payload.target_amount, "Target amount")),
      current_amount_cents: toCents(payload.current_amount ?? 0),
      target_date: payload.target_date || null,
      linked_account_id: payload.linked_account_id ?? null,
      // Highest milestone (25/50/75/100%) already announced; used by the notification checks.
      last_milestone_pct: 0,
      created_at: serverTimestamp(),
    });
    await commit(batch);
    return toGoal(await getDoc(ref));
  },

  update: async (id: string, payload: Partial<Goal>): Promise<Goal> => {
    const ref = doc(householdCollection("goals"), id);
    if (!(await getDoc(ref)).exists()) throw new Error("Goal not found");
    const changes: Record<string, unknown> = {};
    if (payload.name !== undefined) changes.name = payload.name;
    if (payload.target_amount !== undefined) {
      changes.target_amount_cents = toCents(requirePositive(payload.target_amount, "Target amount"));
    }
    if (payload.current_amount !== undefined) changes.current_amount_cents = toCents(payload.current_amount);
    if (payload.target_date !== undefined) changes.target_date = payload.target_date || null;
    if (payload.linked_account_id !== undefined) changes.linked_account_id = payload.linked_account_id;

    const batch = writeBatch(db);
    batch.update(ref, changes);
    await commit(batch);
    return toGoal(await getDoc(ref));
  },

  remove: async (id: string): Promise<void> => {
    const ref = doc(householdCollection("goals"), id);
    if (!(await getDoc(ref)).exists()) throw new Error("Goal not found");
    const batch = writeBatch(db);
    batch.delete(ref);
    await commit(batch);
  },
};

// ---------- Recurring bills ----------

function toBill(snap: DocumentSnapshot): RecurringBill {
  const d = snapshotData(snap);
  return {
    id: snap.id,
    name: d.name,
    amount: fromCents(d.amount_cents),
    due_day: d.due_day,
    category_id: d.category_id ?? null,
    account_id: d.account_id ?? null,
    is_active: d.is_active ?? true,
  };
}

function billFields(payload: Partial<RecurringBill>): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  if (payload.name !== undefined) fields.name = payload.name;
  if (payload.amount !== undefined) fields.amount_cents = toCents(requirePositive(payload.amount, "Amount"));
  if (payload.due_day !== undefined) {
    if (!Number.isInteger(payload.due_day) || payload.due_day < 1 || payload.due_day > 28) {
      throw new Error("Due day must be between 1 and 28");
    }
    fields.due_day = payload.due_day;
  }
  if (payload.category_id !== undefined) fields.category_id = payload.category_id;
  if (payload.account_id !== undefined) fields.account_id = payload.account_id;
  if (payload.is_active !== undefined) fields.is_active = payload.is_active;
  return fields;
}

export const RecurringBillsApi = {
  /** Sorted by the day of the month they're due. */
  list: async (): Promise<RecurringBill[]> => {
    const snap = await getDocs(householdCollection("recurring_bills"));
    return snap.docs.map(toBill).sort((a, b) => a.due_day - b.due_day);
  },

  create: async (payload: Partial<RecurringBill>): Promise<RecurringBill> => {
    const ref = doc(householdCollection("recurring_bills"));
    const batch = writeBatch(db);
    batch.set(ref, {
      category_id: null,
      account_id: null,
      is_active: true,
      ...billFields(payload),
      created_at: serverTimestamp(),
    });
    await commit(batch);
    return toBill(await getDoc(ref));
  },

  update: async (id: string, payload: Partial<RecurringBill>): Promise<RecurringBill> => {
    const ref = doc(householdCollection("recurring_bills"), id);
    if (!(await getDoc(ref)).exists()) throw new Error("Recurring bill not found");
    const batch = writeBatch(db);
    batch.update(ref, billFields(payload));
    await commit(batch);
    return toBill(await getDoc(ref));
  },

  remove: async (id: string): Promise<void> => {
    const ref = doc(householdCollection("recurring_bills"), id);
    if (!(await getDoc(ref)).exists()) throw new Error("Recurring bill not found");
    const batch = writeBatch(db);
    batch.delete(ref);
    await commit(batch);
  },
};
