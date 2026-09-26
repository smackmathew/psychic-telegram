import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { evaluateRules, type HouseholdData, type NotificationDraft } from "./notificationRules.js";

// Reads and writes the same documents the web app does (see firestore.rules for the layout).
// Money is in *_cents fields; dates are "YYYY-MM-DD" strings.

export async function householdIdForUser(db: Firestore, uid: string): Promise<string | null> {
  const pointer = await db.doc(`users/${uid}`).get();
  return (pointer.get("household_id") as string | undefined) ?? null;
}

async function loadHouseholdData(db: Firestore, householdId: string): Promise<HouseholdData> {
  const household = db.doc(`households/${householdId}`);
  const [accounts, transactions, categories, budgets, goals, bills, members, profiles, history] = await Promise.all(
    ["accounts", "transactions", "categories", "budgets", "goals", "recurring_bills", "members", "credit_profiles", "credit_score_history"].map(
      (name) => household.collection(name).get(),
    ),
  );
  const rows = <T>(snap: FirebaseFirestore.QuerySnapshot, map: (d: FirebaseFirestore.QueryDocumentSnapshot) => T) => snap.docs.map(map);

  return {
    accounts: rows(accounts, (d) => ({ id: d.id, name: d.get("name"), type: d.get("type"), current_balance_cents: d.get("current_balance_cents") ?? 0 })),
    transactions: rows(transactions, (d) => ({
      id: d.id,
      account_id: d.get("account_id"),
      category_id: d.get("category_id") ?? null,
      date: d.get("date"),
      amount_cents: d.get("amount_cents"),
      direction: d.get("direction"),
      name: d.get("name"),
    })),
    categories: rows(categories, (d) => ({ id: d.id, name: d.get("name") })),
    budgets: rows(budgets, (d) => ({
      id: d.id,
      category_id: d.get("category_id"),
      month: d.get("month"),
      amount_limit_cents: d.get("amount_limit_cents"),
    })),
    goals: rows(goals, (d) => ({
      id: d.id,
      name: d.get("name"),
      target_amount_cents: d.get("target_amount_cents"),
      current_amount_cents: d.get("current_amount_cents") ?? 0,
      last_milestone_pct: d.get("last_milestone_pct") ?? 0,
    })),
    bills: rows(bills, (d) => ({
      id: d.id,
      name: d.get("name"),
      amount_cents: d.get("amount_cents"),
      due_day: d.get("due_day"),
      category_id: d.get("category_id") ?? null,
      is_active: d.get("is_active") ?? true,
    })),
    members: rows(members, (d) => ({ id: d.id, full_name: d.get("full_name") })),
    creditProfiles: rows(profiles, (d) => ({ user_id: d.id, utilization_pct: d.get("utilization_pct") ?? null })),
    creditHistory: rows(history, (d) => ({
      user_id: d.get("user_id"),
      score: d.get("score"),
      recorded_date: d.get("recorded_date"),
      created_at_ms: d.get("created_at")?.toMillis() ?? 0,
    })),
  };
}

export interface CreatedNotification extends NotificationDraft {
  id: string;
  is_read: boolean;
  created_at: string;
}

/**
 * Creates the drafts that don't exist yet. A notification's document ID is its dedupe key,
 * so each event is only ever announced once.
 */
export async function createNotifications(db: Firestore, householdId: string, drafts: NotificationDraft[]): Promise<CreatedNotification[]> {
  if (drafts.length === 0) return [];
  const collection = db.collection(`households/${householdId}/notifications`);
  const refs = drafts.map((d) => collection.doc(d.dedupe_key));
  const existing = await db.getAll(...refs);

  const batch = db.batch();
  const created: CreatedNotification[] = [];
  const now = new Date().toISOString();
  drafts.forEach((draft, i) => {
    if (existing[i].exists || created.some((c) => c.id === refs[i].id)) return;
    batch.create(refs[i], { ...draft, is_read: false, created_at: FieldValue.serverTimestamp() });
    created.push({ ...draft, id: refs[i].id, is_read: false, created_at: now });
  });
  await batch.commit();
  return created;
}

/** Runs every notification check for a household; returns the notifications it created. */
export async function runChecksForHousehold(db: Firestore, householdId: string, today: string): Promise<CreatedNotification[]> {
  const data = await loadHouseholdData(db, householdId);
  const { notifications, goalMilestones } = evaluateRules(data, today);
  const created = await createNotifications(db, householdId, notifications);

  if (goalMilestones.length) {
    const batch = db.batch();
    for (const { goalId, pct } of goalMilestones) {
      batch.update(db.doc(`households/${householdId}/goals/${goalId}`), { last_milestone_pct: pct });
    }
    await batch.commit();
  }
  return created;
}
