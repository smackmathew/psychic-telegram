import { describe, expect, it } from "vitest";
import { linkItem, syncHousehold, type PlaidClient } from "../src/plaidSync.js";
import { Household, db } from "./helpers.js";

/** A stand-in for Plaid that serves canned responses. */
function fakePlaid(overrides: Partial<Record<keyof PlaidClient, (...args: any[]) => unknown>> = {}) {
  let syncCalls = 0;
  const respond = (data: unknown) => Promise.resolve({ data });
  const client = {
    itemPublicTokenExchange: () => respond({ item_id: `item_${Date.now()}`, access_token: "access-sandbox-123" }),
    accountsGet: () =>
      respond({
        accounts: [
          { account_id: "chk", name: "Plaid Checking", type: "depository", subtype: "checking", balances: { current: 1200.5, available: 1100, iso_currency_code: "USD" } },
          { account_id: "sav", name: "Plaid Saving", type: "depository", subtype: "savings", balances: { current: 5000, available: null, iso_currency_code: "USD" } },
          { account_id: "cc", name: "Plaid Card", type: "credit", subtype: "credit card", balances: { current: 320.25, available: null, iso_currency_code: "USD" } },
          { account_id: "inv", name: "Plaid Brokerage", type: "investment", subtype: "brokerage", balances: { current: 9000, available: null, iso_currency_code: "USD" } },
        ],
      }),
    transactionsSync: () => {
      syncCalls += 1;
      // Two pages on the first sync, then one change and one removal.
      if (syncCalls === 1) {
        return respond({
          added: [{ transaction_id: "t1", account_id: "chk", date: "2026-03-01", amount: 42.1, name: "Coffee", merchant_name: "Cafe", pending: false }],
          modified: [],
          removed: [],
          next_cursor: "c1",
          has_more: true,
        });
      }
      if (syncCalls === 2) {
        return respond({
          added: [
            { transaction_id: "t2", account_id: "chk", date: "2026-03-02", amount: -2500, name: "Payroll", merchant_name: null, pending: false },
            { transaction_id: "t3", account_id: "unknown", date: "2026-03-02", amount: 5, name: "Other bank", merchant_name: null, pending: false },
          ],
          modified: [],
          removed: [],
          next_cursor: "c2",
          has_more: false,
        });
      }
      return respond({
        added: [],
        modified: [{ transaction_id: "t1", account_id: "chk", date: "2026-03-01", amount: 45, name: "Coffee (final)", merchant_name: "Cafe", pending: false }],
        removed: [{ transaction_id: "t2" }],
        next_cursor: "c3",
        has_more: false,
      });
    },
    investmentsHoldingsGet: () =>
      respond({ holdings: [{ account_id: "inv", institution_price: 100.5, quantity: 10 }, { account_id: "inv", institution_price: 20, quantity: 5 }] }),
    linkTokenCreate: () => respond({ link_token: "link-sandbox-abc" }),
    ...overrides,
  };
  return client as unknown as PlaidClient;
}

describe("linking and syncing a bank", () => {
  it("imports accounts, transactions and holdings, and re-syncs without duplicates", async () => {
    const h = await Household.create();
    const plaid = fakePlaid();

    const accountIds = await linkItem(db, plaid, h.id, "public-token", "First Platypus Bank");
    expect(accountIds).toEqual(["plaid_chk", "plaid_sav", "plaid_cc", "plaid_inv"]);

    const checking = await h.doc("accounts", "plaid_chk");
    expect(checking).toMatchObject({
      name: "Plaid Checking",
      type: "checking",
      institution_name: "First Platypus Bank",
      current_balance_cents: 120050,
      available_balance_cents: 110000,
      is_manual: false,
    });
    expect((await h.doc("accounts", "plaid_sav"))!.type).toBe("savings");
    expect((await h.doc("accounts", "plaid_cc"))!.type).toBe("credit_card");

    // The access token is stored where only functions can read it.
    const items = await db.collection("plaid_items").where("household_id", "==", h.id).get();
    expect(items.docs.map((d) => d.get("access_token"))).toEqual(["access-sandbox-123"]);

    await syncHousehold(db, plaid, h.id);
    let txns = Object.fromEntries((await h.all("transactions")).map((d) => [d.id, d.data()]));
    expect(Object.keys(txns).sort()).toEqual(["plaid_t1", "plaid_t2"]); // the unknown account's is skipped
    expect(txns.plaid_t1).toMatchObject({ account_id: "plaid_chk", amount_cents: 4210, direction: "debit", name: "Coffee" });
    expect(txns.plaid_t2).toMatchObject({ amount_cents: 250000, direction: "credit" });
    expect((await h.doc("accounts", "plaid_inv"))!.current_balance_cents).toBe(110500); // 100.5*10 + 20*5

    // The household categorizes a synced transaction; the next sync keeps that.
    await h.ref.collection("transactions").doc("plaid_t1").update({ category_id: "dining" });
    await syncHousehold(db, plaid, h.id);
    txns = Object.fromEntries((await h.all("transactions")).map((d) => [d.id, d.data()]));
    expect(Object.keys(txns)).toEqual(["plaid_t1"]);
    expect(txns.plaid_t1).toMatchObject({ amount_cents: 4500, name: "Coffee (final)", category_id: "dining" });
    expect((await h.all("accounts")).length).toBe(4);
    expect((await items.docs[0].ref.get()).get("transactions_cursor")).toBe("c3");
  });

  it("raises a single notification when a bank fails to sync", async () => {
    const h = await Household.create();
    const failing = fakePlaid({ accountsGet: () => Promise.reject(new Error("ITEM_LOGIN_REQUIRED")) });
    await linkItem(db, fakePlaid(), h.id, "public-token", "First Platypus Bank");

    await syncHousehold(db, failing, h.id);
    await syncHousehold(db, failing, h.id);
    const notes = await h.notifications();
    expect(notes.map((n) => n.title)).toEqual(["Bank sync failed for First Platypus Bank"]);
    expect(notes[0].type).toBe("sync_error");
  });
});
