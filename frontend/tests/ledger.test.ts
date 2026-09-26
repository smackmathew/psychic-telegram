import { beforeEach, describe, expect, it } from "vitest";
import { AccountsApi, CategoriesApi, TransactionsApi } from "../src/firebase/ledger";
import type { AccountType, TransactionDirection } from "../src/types";
import { TODAY, balance, categoryId, createAccount, createTransaction, daysAgo, signUpNewHousehold } from "./helpers";

beforeEach(async () => {
  await signUpNewHousehold();
});

describe("accounts", () => {
  it("creates, updates and deletes an account", async () => {
    const account = await createAccount({ name: "Joint checking", current_balance: 1234.56, institution_name: "Bank" });
    expect(account.is_manual).toBe(true);
    expect(account.current_balance).toBe(1234.56);

    const updated = await AccountsApi.update(account.id, { name: "Renamed", monthly_payment: 50 });
    expect(updated.name).toBe("Renamed");
    expect(updated.monthly_payment).toBe(50);
    expect(updated.institution_name).toBe("Bank"); // untouched fields are kept

    await AccountsApi.remove(account.id);
    expect(await AccountsApi.list()).toEqual([]);
  });

  it("deletes an account's transactions along with it", async () => {
    const account = await createAccount();
    await createTransaction(account.id, { amount: 5 });
    await AccountsApi.remove(account.id);
    expect(await TransactionsApi.list()).toEqual([]);
  });

  it("lists accounts oldest first", async () => {
    await createAccount({ name: "First" });
    await createAccount({ name: "Second" });
    expect((await AccountsApi.list()).map((a) => a.name)).toEqual(["First", "Second"]);
  });
});

describe("transactions and account balances", () => {
  it.each<[AccountType, TransactionDirection, number]>([
    ["checking", "credit", 1100],
    ["checking", "debit", 900],
    ["credit_card", "debit", 1100], // a charge increases what's owed
    ["credit_card", "credit", 900], // a payment decreases it
    ["loan", "credit", 900],
  ])("a %s %s of 100 moves the balance to %d, and deleting it undoes that", async (type, direction, expected) => {
    const account = await createAccount({ type, current_balance: 1000 });
    const txn = await createTransaction(account.id, { amount: 100, direction });
    expect(await balance(account.id)).toBe(expected);

    await TransactionsApi.remove(txn.id);
    expect(await balance(account.id)).toBe(1000);
  });

  it.each<[AccountType, number]>([
    ["checking", 850], // a 100 debit left 900; bumping it to 150 leaves 850
    ["credit_card", 1150], // a 100 charge left 1,100 owed; bumping it to 150 leaves 1,150
  ])("editing the amount on a %s account moves the balance by the difference", async (type, expected) => {
    const account = await createAccount({ type, current_balance: 1000 });
    const txn = await createTransaction(account.id, { amount: 100, direction: "debit" });

    const updated = await TransactionsApi.update(txn.id, { amount: 150 });
    expect(updated.amount).toBe(150);
    expect(await balance(account.id)).toBe(expected);

    await TransactionsApi.remove(txn.id);
    expect(await balance(account.id)).toBe(1000);
  });

  it("keeps cents exact across many small transactions", async () => {
    const account = await createAccount({ current_balance: 0 });
    for (let i = 0; i < 10; i++) {
      await createTransaction(account.id, { amount: 0.1, direction: "credit" });
    }
    expect(await balance(account.id)).toBe(1);
  });

  it.each([0, -5, null])("rejects an amount of %s", async (amount) => {
    const account = await createAccount({ current_balance: 1000 });
    await expect(createTransaction(account.id, { amount: amount as number })).rejects.toThrow();

    const txn = await createTransaction(account.id, { amount: 100 });
    await expect(TransactionsApi.update(txn.id, { amount: amount as number })).rejects.toThrow();
    expect(await balance(account.id)).toBe(900);
  });

  it.each([
    ["name", null],
    ["name", ""],
    ["date", null],
    ["date", "not a date"],
  ])("rejects a %s of %j when editing", async (field, value) => {
    const account = await createAccount({ current_balance: 1000 });
    const txn = await createTransaction(account.id, { amount: 100, name: "Coffee" });
    await expect(TransactionsApi.update(txn.id, { [field]: value })).rejects.toThrow();

    const [unchanged] = await TransactionsApi.list();
    expect([unchanged.name, unchanged.date, unchanged.amount]).toEqual(["Coffee", TODAY, 100]);
  });

  it("rejects a transaction for an unknown account", async () => {
    await expect(createTransaction("does-not-exist")).rejects.toThrow("Account not found");
  });

  it("updates category and notes, and can clear the category", async () => {
    const account = await createAccount();
    const txn = await createTransaction(account.id, { amount: 20, name: "Coffee" });
    const groceries = await categoryId("Groceries");

    const updated = await TransactionsApi.update(txn.id, { category_id: groceries, notes: "Actually groceries" });
    expect(updated.category_id).toBe(groceries);
    expect(updated.notes).toBe("Actually groceries");
    expect(updated.name).toBe("Coffee");

    expect((await TransactionsApi.update(txn.id, { category_id: null })).category_id).toBeNull();
  });
});

describe("listing transactions", () => {
  it("filters by account, category, date range and name", async () => {
    const checking = await createAccount({ name: "Checking" });
    const card = await createAccount({ name: "Card", type: "credit_card" });
    const groceries = await categoryId("Groceries");
    const old = daysAgo(40);

    await createTransaction(checking.id, { amount: 10, name: "Whole Foods", category_id: groceries });
    await createTransaction(checking.id, { amount: 20, name: "Old rent", date: old });
    await createTransaction(card.id, { amount: 30, name: "Netflix" });

    const names = async (params = {}) => (await TransactionsApi.list(params)).map((t) => t.name).sort();
    expect(await names()).toEqual(["Netflix", "Old rent", "Whole Foods"]);
    expect(await names({ account_id: card.id })).toEqual(["Netflix"]);
    expect(await names({ category_id: groceries })).toEqual(["Whole Foods"]);
    expect(await names({ start_date: daysAgo(7) })).toEqual(["Netflix", "Whole Foods"]);
    expect(await names({ end_date: old })).toEqual(["Old rent"]);
    expect(await names({ search: "whole" })).toEqual(["Whole Foods"]); // case-insensitive
  });

  it("is newest first and paginated", async () => {
    const account = await createAccount();
    for (let i = 0; i < 5; i++) {
      await createTransaction(account.id, { amount: 1, date: daysAgo(i), name: `t${i}` });
    }
    expect((await TransactionsApi.list()).map((t) => t.name)).toEqual(["t0", "t1", "t2", "t3", "t4"]);
    expect((await TransactionsApi.list({ limit: 2, offset: 2 })).map((t) => t.name)).toEqual(["t2", "t3"]);
  });
});

describe("categories", () => {
  it("starts with the default categories", async () => {
    const categories = await CategoriesApi.list();
    expect(categories).toHaveLength(20);
    expect(categories.every((c) => c.is_default)).toBe(true);
  });

  it("creates a custom category", async () => {
    const category = await CategoriesApi.create({ name: "Pets", type: "expense", icon: "paw" });
    expect(category.is_default).toBe(false);
    expect((await CategoriesApi.list()).map((c) => c.name)).toContain("Pets");
  });
});
