// Seeds household data in the same shape the web app writes (see firestore.rules).
import { getApps, initializeApp } from "firebase-admin/app";
import { Timestamp, getFirestore, type Firestore } from "firebase-admin/firestore";

if (!getApps().length) initializeApp({ projectId: "demo-household" });
export const db: Firestore = getFirestore();

let counter = 0;
const newId = (prefix: string) => `${prefix}${Date.now()}_${++counter}`;

export class Household {
  readonly id = newId("h");
  readonly ref = db.doc(`households/${this.id}`);

  static async create(memberNames: Record<string, string> = { alex: "Alex" }): Promise<Household> {
    const h = new Household();
    await h.ref.set({ name: "Test", member_ids: Object.keys(memberNames), invite_code: "X" });
    for (const [uid, full_name] of Object.entries(memberNames)) {
      await h.ref.collection("members").doc(uid).set({ full_name, email: `${uid}@example.com` });
      await db.doc(`users/${uid}`).set({ household_id: h.id });
    }
    return h;
  }

  private async add(collection: string, data: object, id = newId(collection.slice(0, 3))): Promise<string> {
    await this.ref.collection(collection).doc(id).set(data);
    return id;
  }

  category(name: string): Promise<string> {
    return this.add("categories", { name, type: "expense" }, name.toLowerCase().replace(/\W/g, "_"));
  }

  account(fields: { name?: string; type?: string; balance?: number } = {}): Promise<string> {
    return this.add("accounts", {
      name: fields.name ?? "Checking",
      type: fields.type ?? "checking",
      current_balance_cents: Math.round((fields.balance ?? 0) * 100),
    });
  }

  transaction(accountId: string, fields: { amount: number; date: string; name?: string; direction?: string; category_id?: string }) {
    return this.add("transactions", {
      account_id: accountId,
      category_id: fields.category_id ?? null,
      date: fields.date,
      amount_cents: Math.round(fields.amount * 100),
      direction: fields.direction ?? "debit",
      name: fields.name ?? "Txn",
    });
  }

  budget(categoryId: string, month: string, limit: number) {
    return this.add("budgets", { category_id: categoryId, month, amount_limit_cents: limit * 100 }, `${month}_${categoryId}`);
  }

  goal(name: string, target: number, current: number) {
    return this.add("goals", { name, type: "savings", target_amount_cents: target * 100, current_amount_cents: current * 100, last_milestone_pct: 0 });
  }

  async setGoalAmount(goalId: string, current: number) {
    await this.ref.collection("goals").doc(goalId).update({ current_amount_cents: current * 100 });
  }

  bill(fields: { name: string; amount: number; due_day: number; category_id?: string; is_active?: boolean }) {
    return this.add("recurring_bills", {
      name: fields.name,
      amount_cents: fields.amount * 100,
      due_day: fields.due_day,
      category_id: fields.category_id ?? null,
      is_active: fields.is_active ?? true,
    });
  }

  async creditScore(uid: string, score: number, recordedDate: string, utilization: number | null = null) {
    await this.ref.collection("credit_profiles").doc(uid).set({ bureau: "other", score, utilization_pct: utilization });
    await this.add("credit_score_history", { user_id: uid, bureau: "other", score, recorded_date: recordedDate, created_at: Timestamp.now() });
  }

  async notifications() {
    return (await this.ref.collection("notifications").get()).docs.map((d) => d.data());
  }

  async doc(collection: string, id: string) {
    return (await this.ref.collection(collection).doc(id).get()).data();
  }

  async all(collection: string) {
    return (await this.ref.collection(collection).get()).docs;
  }
}
