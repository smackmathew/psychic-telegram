import { beforeEach, describe, expect, it } from "vitest";
import { addMonths, monthStart } from "../src/firebase/dates";
import { BudgetsApi, GoalsApi, RecurringBillsApi } from "../src/firebase/planning";
import { TODAY, categoryId, createAccount, createTransaction, signUpNewHousehold } from "./helpers";

const MONTH_START = monthStart(TODAY);

function dayBefore(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

beforeEach(async () => {
  await signUpNewHousehold();
});

describe("budgets", () => {
  it("counts only this month's debits in the budget's category", async () => {
    const groceries = await categoryId("Groceries");
    const dining = await categoryId("Dining Out");
    const account = await createAccount();

    await BudgetsApi.create({ category_id: groceries, month: TODAY, amount_limit: 400 });
    await createTransaction(account.id, { amount: 150, date: MONTH_START, category_id: groceries });
    await createTransaction(account.id, { amount: 50, date: MONTH_START, category_id: groceries });
    // None of these should count:
    await createTransaction(account.id, { amount: 999, date: dayBefore(MONTH_START), category_id: groceries });
    await createTransaction(account.id, { amount: 999, date: MONTH_START, category_id: dining });
    await createTransaction(account.id, { amount: 999, date: MONTH_START, category_id: groceries, direction: "credit" });

    const [progress] = await BudgetsApi.list();
    expect(progress.budget.category.name).toBe("Groceries");
    expect(progress.spent).toBe(200);
    expect(progress.remaining).toBe(200);
    expect(progress.pct_used).toBe(50);
  });

  it("never shows a negative amount remaining", async () => {
    const groceries = await categoryId("Groceries");
    const account = await createAccount();
    await BudgetsApi.create({ category_id: groceries, month: TODAY, amount_limit: 100 });
    await createTransaction(account.id, { amount: 150, date: MONTH_START, category_id: groceries });

    const [progress] = await BudgetsApi.list();
    expect(progress.remaining).toBe(0);
    expect(progress.pct_used).toBe(150);
  });

  it("normalizes the month and updates instead of duplicating", async () => {
    const groceries = await categoryId("Groceries");
    const first = await BudgetsApi.create({ category_id: groceries, month: `${TODAY.slice(0, 7)}-15`, amount_limit: 300 });
    expect(first.month).toBe(MONTH_START);

    const second = await BudgetsApi.create({ category_id: groceries, month: MONTH_START, amount_limit: 350 });
    expect(second.id).toBe(first.id);
    expect((await BudgetsApi.list()).map((b) => b.budget.amount_limit)).toEqual([350]);
  });

  it("lists budgets per month", async () => {
    const groceries = await categoryId("Groceries");
    const nextMonth = addMonths(MONTH_START, 1);
    await BudgetsApi.create({ category_id: groceries, month: nextMonth, amount_limit: 300 });

    expect(await BudgetsApi.list()).toEqual([]);
    expect(await BudgetsApi.list(nextMonth)).toHaveLength(1);
  });

  it("deletes a budget", async () => {
    const budget = await BudgetsApi.create({ category_id: await categoryId("Groceries"), month: TODAY, amount_limit: 1 });
    await BudgetsApi.remove(budget.id);
    expect(await BudgetsApi.list()).toEqual([]);
    await expect(BudgetsApi.remove(budget.id)).rejects.toThrow("Budget not found");
  });

  it.each([0, -10])("rejects a limit of %d", async (amount_limit) => {
    await expect(
      BudgetsApi.create({ category_id: await categoryId("Groceries"), month: TODAY, amount_limit }),
    ).rejects.toThrow();
  });
});

describe("goals", () => {
  it("creates, updates and deletes a goal", async () => {
    const goal = await GoalsApi.create({ name: "Emergency fund", type: "savings", target_amount: 10_000 });
    expect(goal.current_amount).toBe(0);

    const updated = await GoalsApi.update(goal.id, { current_amount: 2_500 });
    expect(updated.current_amount).toBe(2_500);
    expect(updated.target_amount).toBe(10_000);

    await GoalsApi.remove(goal.id);
    expect(await GoalsApi.list()).toEqual([]);
  });

  it("requires a positive target", async () => {
    await expect(GoalsApi.create({ name: "x", type: "savings", target_amount: 0 })).rejects.toThrow();
  });

  it("keeps an optional target date", async () => {
    const goal = await GoalsApi.create({ name: "Car", type: "savings", target_amount: 5_000, target_date: "2027-06-01" });
    expect(goal.target_date).toBe("2027-06-01");
  });
});

describe("recurring bills", () => {
  it("are sorted by due day", async () => {
    await RecurringBillsApi.create({ name: "Internet", amount: 80, due_day: 20 });
    await RecurringBillsApi.create({ name: "Rent", amount: 2000, due_day: 1 });
    expect((await RecurringBillsApi.list()).map((b) => b.name)).toEqual(["Rent", "Internet"]);
  });

  it.each([0, 29])("reject a due day of %d", async (due_day) => {
    await expect(RecurringBillsApi.create({ name: "x", amount: 1, due_day })).rejects.toThrow("Due day");
  });

  it("can be paused and deleted", async () => {
    const bill = await RecurringBillsApi.create({ name: "Gym", amount: 40, due_day: 5 });
    expect(bill.is_active).toBe(true);
    expect((await RecurringBillsApi.update(bill.id, { is_active: false })).is_active).toBe(false);
    await RecurringBillsApi.remove(bill.id);
    expect(await RecurringBillsApi.list()).toEqual([]);
  });
});
