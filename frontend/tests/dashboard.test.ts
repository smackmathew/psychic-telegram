import { beforeAll, describe, expect, it } from "vitest";
import { dashboardSummary } from "../src/firebase/dashboard";
import type { DashboardSummary } from "../src/types";
import { categoryId, createAccount, createTransaction, signUpNewHousehold } from "./helpers";

// Local noon on 15 March 2026, so the result doesn't depend on the machine's time zone.
const TODAY = new Date(2026, 2, 15, 12);

describe("dashboard summary", () => {
  let summary: DashboardSummary;

  beforeAll(async () => {
    await signUpNewHousehold();
    const checking = await createAccount({ name: "Checking", type: "checking", current_balance: 2_000 });
    const card = await createAccount({ name: "Card", type: "credit_card", current_balance: 0 });
    const groceries = await categoryId("Groceries");
    const dining = await categoryId("Dining Out");

    await createTransaction(checking.id, { amount: 500, date: "2026-01-10", name: "January spend" });
    await createTransaction(checking.id, { amount: 3_000, date: "2026-03-01", name: "Paycheck", direction: "credit" });
    await createTransaction(checking.id, { amount: 200, date: "2026-03-05", name: "Groceries", category_id: groceries });
    await createTransaction(card.id, { amount: 100, date: "2026-03-06", name: "Dinner", category_id: dining });
    await createTransaction(card.id, { amount: 30, date: "2026-03-07", name: "Refund", direction: "credit" });
    await createTransaction(checking.id, { amount: 40, date: "2026-03-08", name: "Uncategorized" });

    summary = await dashboardSummary(TODAY);
  });

  it("totals balances and net worth", () => {
    // Checking: 2,000 - 500 + 3,000 - 200 - 40; the card owes 100 - 30.
    expect(summary.total_assets).toBe(4_260);
    expect(summary.total_liabilities).toBe(70);
    expect(summary.net_worth).toBe(4_190);
  });

  it("totals this month's cash flow", () => {
    // A credit on a credit card (the refund) is not income.
    expect(summary.month_income).toBe(3_000);
    expect(summary.month_expenses).toBe(340);
  });

  it("sorts spending by category and skips uncategorized", () => {
    expect(summary.spending_by_category).toEqual([
      { category_name: "Groceries", amount: 200 },
      { category_name: "Dining Out", amount: 100 },
    ]);
  });

  it("rewinds transactions for the net-worth trend", () => {
    const trend = summary.net_worth_trend;
    expect(trend.map((p) => p.label)).toEqual(["Oct 2025", "Nov 2025", "Dec 2025", "Jan 2026", "Feb 2026", "Mar 2026"]);
    expect(trend.map((p) => p.net_worth)).toEqual([2_000, 2_000, 2_000, 1_500, 1_500, 4_190]);
    expect(trend.at(-1)!.assets).toBe(summary.total_assets);
    expect(trend.at(-1)!.liabilities).toBe(summary.total_liabilities);
  });
});

describe("dashboard summary for an empty household", () => {
  it("is all zeros", async () => {
    await signUpNewHousehold();
    const summary = await dashboardSummary(TODAY);
    expect(summary.net_worth).toBe(0);
    expect(summary.spending_by_category).toEqual([]);
    expect(summary.net_worth_trend).toHaveLength(6);
    expect(summary.unread_notifications).toBe(0);
  });
});
