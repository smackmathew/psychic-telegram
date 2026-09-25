// Tests firestore.rules directly, bypassing the app's own code, to check what a signed-in
// user could do by talking to Firestore themselves.
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { arrayUnion, collection, doc, getDoc, getDocs, setDoc, updateDoc, writeBatch } from "firebase/firestore";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

let env: RulesTestEnvironment;
const HID = "household-1";
const CODE = "ABCD2345";

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-household",
    firestore: { rules: readFileSync(resolve(__dirname, "../../firestore.rules"), "utf8"), host: "127.0.0.1", port: 8080 },
  });
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "households", HID), { name: "Alex's", member_ids: ["alex"], invite_code: CODE, annual_gross_income_cents: null });
    await setDoc(doc(db, "invites", CODE), { household_id: HID });
    await setDoc(doc(db, "users", "alex"), { household_id: HID });
    await setDoc(doc(db, "households", HID, "members", "alex"), { full_name: "Alex", email: "alex@example.com" });
    await setDoc(doc(db, "households", HID, "accounts", "acct"), { name: "Checking", type: "checking", current_balance_cents: 100000 });
  });
});

const as = (uid: string) => env.authenticatedContext(uid).firestore();

const validTransaction = { account_id: "acct", amount_cents: 500, direction: "debit", name: "Coffee", date: "2026-01-01" };

describe("household data", () => {
  it("is readable and writable by members", async () => {
    const db = as("alex");
    await assertSucceeds(getDocs(collection(db, "households", HID, "accounts")));
    await assertSucceeds(setDoc(doc(db, "households", HID, "transactions", "t1"), validTransaction));
  });

  it("is off limits to other signed-in users", async () => {
    const db = as("mallory");
    await assertFails(getDoc(doc(db, "households", HID)));
    await assertFails(getDocs(collection(db, "households", HID, "accounts")));
    await assertFails(getDocs(collection(db, "households", HID, "members")));
    await assertFails(setDoc(doc(db, "households", HID, "transactions", "t1"), validTransaction));
    await assertFails(updateDoc(doc(db, "households", HID, "accounts", "acct"), { current_balance_cents: 0 }));
  });

  it("is off limits when signed out", async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, "households", HID)));
    await assertFails(getDoc(doc(db, "invites", CODE)));
  });

  it("rejects invalid transactions", async () => {
    const db = as("alex");
    const txn = (fields: object) => setDoc(doc(db, "households", HID, "transactions", "t1"), { ...validTransaction, ...fields });
    await assertFails(txn({ amount_cents: 0 }));
    await assertFails(txn({ amount_cents: -500 }));
    await assertFails(txn({ amount_cents: 5.5 })); // cents must be whole
    await assertFails(txn({ amount_cents: null }));
    await assertFails(txn({ name: "" }));
    await assertFails(txn({ date: null }));
    await assertFails(txn({ direction: "sideways" }));
    await assertFails(txn({ account_id: "no-such-account" }));
  });

  it("rejects fractional account balances", async () => {
    await assertFails(updateDoc(doc(as("alex"), "households", HID, "accounts", "acct"), { current_balance_cents: 10.5 }));
  });
});

describe("joining a household", () => {
  function join(uid: string, code: string, memberIds = arrayUnion(uid)) {
    const db = as(uid);
    const batch = writeBatch(db);
    batch.update(doc(db, "households", HID), { member_ids: memberIds, join_code: code });
    batch.set(doc(db, "users", uid), { household_id: HID });
    batch.set(doc(db, "households", HID, "members", uid), { full_name: "Sam", email: "sam@example.com" });
    return batch.commit();
  }

  it("works with the invite code", async () => {
    await assertSucceeds(join("sam", CODE));
    await assertSucceeds(getDocs(collection(as("sam"), "households", HID, "accounts")));
  });

  it("fails with the wrong code", async () => {
    await assertFails(join("sam", "WRONG123"));
  });

  it("can't add anyone but yourself", async () => {
    await assertFails(join("sam", CODE, arrayUnion("sam", "mallory")));
  });

  it("can't claim a household without joining it", async () => {
    await assertFails(setDoc(doc(as("mallory"), "users", "mallory"), { household_id: HID }));
    await assertFails(setDoc(doc(as("mallory"), "households", HID, "members", "mallory"), { full_name: "M", email: "m@example.com" }));
  });

  it("can't change the invite code or remove members", async () => {
    const db = as("alex");
    await assertFails(updateDoc(doc(db, "households", HID), { invite_code: "NEWCODE1" }));
    await assertFails(updateDoc(doc(db, "households", HID), { member_ids: [] }));
  });

  it("can look up one invite by code but not list them", async () => {
    const db = as("sam");
    await assertSucceeds(getDoc(doc(db, "invites", CODE)));
    await assertFails(getDocs(collection(db, "invites")));
  });
});

describe("creating a household", () => {
  it("must list only yourself as a member", async () => {
    const db = as("sam");
    await assertSucceeds(setDoc(doc(db, "households", "h2"), { name: "Sam's", member_ids: ["sam"], invite_code: "SAMCODE2" }));
    await assertFails(setDoc(doc(db, "households", "h3"), { name: "Sneaky", member_ids: ["sam", "alex"], invite_code: "X" }));
  });

  it("can't point an invite at someone else's household", async () => {
    await assertFails(setDoc(doc(as("mallory"), "invites", "MALLORY1"), { household_id: HID }));
  });
});

describe("user profiles", () => {
  it("are private to their owner", async () => {
    await assertSucceeds(getDoc(doc(as("alex"), "users", "alex")));
    await assertFails(getDoc(doc(as("mallory"), "users", "alex")));
  });

  it("can't be moved to another household", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "households", "h2"), { name: "Other", member_ids: ["alex", "sam"], invite_code: "OTHER234" });
    });
    await assertFails(setDoc(doc(as("alex"), "users", "alex"), { household_id: "h2" }));
  });
});
