// Linking banks through Plaid and syncing their accounts, transactions and investment
// holdings into the household's Firestore data.
//
// Plaid access tokens live in the top-level plaid_items collection. firestore.rules has no
// rule for it, so the web app can never read them; only these functions (which use the
// Admin SDK) can.
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { Configuration, CountryCode, PlaidApi, PlaidEnvironments, Products } from "plaid";
import { PLAID_COUNTRY_CODES, PLAID_PRODUCTS } from "./config.js";
import { createNotifications } from "./household.js";

/** The Plaid calls this module makes; tests pass a fake. */
export type PlaidClient = Pick<
  PlaidApi,
  "linkTokenCreate" | "itemPublicTokenExchange" | "accountsGet" | "transactionsSync" | "investmentsHoldingsGet"
>;

export function createPlaidClient(clientId: string, secret: string, environment: string): PlaidClient {
  return new PlaidApi(
    new Configuration({
      basePath: PlaidEnvironments[environment] ?? PlaidEnvironments.sandbox,
      baseOptions: { headers: { "PLAID-CLIENT-ID": clientId, "PLAID-SECRET": secret } },
    }),
  );
}

export async function createLinkToken(plaid: PlaidClient, uid: string): Promise<string> {
  const response = await plaid.linkTokenCreate({
    user: { client_user_id: uid },
    client_name: "Household Financial Dashboard",
    products: PLAID_PRODUCTS.map((p) => p as Products),
    country_codes: PLAID_COUNTRY_CODES.map((c) => c as CountryCode),
    language: "en",
  });
  return response.data.link_token;
}

function mapAccountType(type: string, subtype: string | null | undefined): string {
  if (type === "depository") return subtype === "savings" ? "savings" : "checking";
  if (type === "credit") return "credit_card";
  if (type === "loan") return "loan";
  if (type === "investment") return "investment";
  return "other";
}

const toCents = (dollars: number) => Math.round(dollars * 100);

interface PlaidItem {
  id: string;
  household_id: string;
  access_token: string;
  institution_name: string | null;
  transactions_cursor: string | null;
}

// Plaid's own IDs make the document IDs, so syncing again updates rather than duplicates.
const accountDocId = (plaidAccountId: string) => `plaid_${plaidAccountId}`;
const transactionDocId = (plaidTransactionId: string) => `plaid_${plaidTransactionId}`;

/** Exchanges the token from Plaid Link, stores the item, and imports its accounts. */
export async function linkItem(
  db: Firestore,
  plaid: PlaidClient,
  householdId: string,
  publicToken: string,
  institutionName: string | null,
): Promise<string[]> {
  const { data } = await plaid.itemPublicTokenExchange({ public_token: publicToken });
  const item: PlaidItem = {
    id: data.item_id,
    household_id: householdId,
    access_token: data.access_token,
    institution_name: institutionName,
    transactions_cursor: null,
  };
  const { id, ...fields } = item;
  await db.doc(`plaid_items/${id}`).set({ ...fields, created_at: FieldValue.serverTimestamp() });
  return importAccounts(db, plaid, item);
}

/** Creates or updates the household's accounts for an item, with Plaid's current balances. */
async function importAccounts(db: Firestore, plaid: PlaidClient, item: PlaidItem): Promise<string[]> {
  const { data } = await plaid.accountsGet({ access_token: item.access_token });
  const accounts = db.collection(`households/${item.household_id}/accounts`);
  const batch = db.batch();
  const ids: string[] = [];
  for (const account of data.accounts) {
    const ref = accounts.doc(accountDocId(account.account_id));
    const existing = await ref.get();
    const balances = {
      current_balance_cents:
        account.balances.current != null ? toCents(account.balances.current) : (existing.get("current_balance_cents") ?? 0),
      available_balance_cents: account.balances.available != null ? toCents(account.balances.available) : null,
      updated_at: FieldValue.serverTimestamp(),
    };
    if (existing.exists) {
      batch.update(ref, balances);
    } else {
      batch.set(ref, {
        name: account.name,
        institution_name: item.institution_name,
        type: mapAccountType(account.type, account.subtype),
        monthly_payment_cents: null,
        currency: account.balances.iso_currency_code ?? "USD",
        is_manual: false,
        plaid_item_id: item.id,
        created_at: FieldValue.serverTimestamp(),
        ...balances,
      });
    }
    ids.push(ref.id);
  }
  await batch.commit();
  return ids;
}

/**
 * Pulls new, changed and removed transactions since the item's last sync. Balances come
 * from Plaid (importAccounts), so these don't adjust them.
 */
async function syncTransactions(db: Firestore, plaid: PlaidClient, item: PlaidItem): Promise<void> {
  const household = db.doc(`households/${item.household_id}`);
  const accountIds = new Set(
    (await household.collection("accounts").where("plaid_item_id", "==", item.id).get()).docs.map((d) => d.id),
  );

  let cursor = item.transactions_cursor ?? undefined;
  let hasMore = true;
  while (hasMore) {
    const { data } = await plaid.transactionsSync({ access_token: item.access_token, cursor });
    const batch = db.batch();
    const added = new Set(data.added.map((t) => t.transaction_id));
    for (const txn of [...data.added, ...data.modified]) {
      const accountId = accountDocId(txn.account_id);
      if (!accountIds.has(accountId)) continue;
      batch.set(
        household.collection("transactions").doc(transactionDocId(txn.transaction_id)),
        {
          account_id: accountId,
          date: txn.date,
          amount_cents: toCents(Math.abs(txn.amount)),
          // Plaid amounts are positive for money leaving the account.
          direction: txn.amount > 0 ? "debit" : "credit",
          name: txn.name,
          merchant_name: txn.merchant_name ?? null,
          pending: txn.pending,
          is_manual: false,
          ...(added.has(txn.transaction_id) ? { created_at: FieldValue.serverTimestamp() } : {}),
        },
        // merge keeps anything the household set themselves, like the category and notes.
        { merge: true },
      );
    }
    for (const removed of data.removed) {
      if (removed.transaction_id) batch.delete(household.collection("transactions").doc(transactionDocId(removed.transaction_id)));
    }
    await batch.commit();
    cursor = data.next_cursor;
    hasMore = data.has_more;
  }
  await db.doc(`plaid_items/${item.id}`).update({ transactions_cursor: cursor ?? null });
}

/** Sets investment accounts' balances to the current value of their holdings. */
async function syncInvestmentHoldings(db: Firestore, plaid: PlaidClient, item: PlaidItem): Promise<void> {
  const accounts = db.collection(`households/${item.household_id}/accounts`);
  const investmentAccounts = (await accounts.where("plaid_item_id", "==", item.id).get()).docs.filter((d) => d.get("type") === "investment");
  if (investmentAccounts.length === 0) return;

  let holdings;
  try {
    holdings = (await plaid.investmentsHoldingsGet({ access_token: item.access_token })).data.holdings;
  } catch {
    logger.info(`Investments product not available for item ${item.id}`);
    return;
  }
  const totals = new Map<string, number>();
  for (const h of holdings) {
    const id = accountDocId(h.account_id);
    totals.set(id, (totals.get(id) ?? 0) + h.institution_price * h.quantity);
  }
  const batch = db.batch();
  for (const account of investmentAccounts) {
    const total = totals.get(account.id);
    if (total != null) batch.update(account.ref, { current_balance_cents: toCents(total), updated_at: FieldValue.serverTimestamp() });
  }
  await batch.commit();
}

/**
 * Syncs every bank linked to the household. A failing bank doesn't stop the others; it
 * raises a (one-time) "bank sync failed" notification instead.
 */
export async function syncHousehold(db: Firestore, plaid: PlaidClient, householdId: string): Promise<void> {
  const items = await db.collection("plaid_items").where("household_id", "==", householdId).get();
  for (const doc of items.docs) {
    const item: PlaidItem = {
      id: doc.id,
      household_id: householdId,
      access_token: doc.get("access_token"),
      institution_name: doc.get("institution_name") ?? null,
      transactions_cursor: doc.get("transactions_cursor") ?? null,
    };
    try {
      await importAccounts(db, plaid, item);
      await syncTransactions(db, plaid, item);
      await syncInvestmentHoldings(db, plaid, item);
    } catch (error) {
      logger.error(`Plaid sync failed for item ${item.id}`, error);
      await createNotifications(db, householdId, [
        {
          dedupe_key: `plaid_sync_error:${item.id}`,
          type: "sync_error",
          severity: "warning",
          title: `Bank sync failed for ${item.institution_name ?? "a linked account"}`,
          message: "We couldn't refresh this account from your bank. You may need to reconnect it.",
          related_entity_type: "plaid_item",
          related_entity_id: item.id,
        },
      ]);
    }
  }
}
