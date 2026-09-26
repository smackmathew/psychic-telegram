import { describe, expect, it } from "vitest";
import { addDays } from "../src/dates.js";
import { runChecksForHousehold } from "../src/household.js";
import { Household, db } from "./helpers.js";

const TODAY = "2026-03-10";

async function run(h: Household, today = TODAY) {
  return runChecksForHousehold(db, h.id, today);
}

const titles = (notes: { title: string }[]) => notes.map((n) => n.title).sort();

describe("budget overages", () => {
  async function setUp(limit = 100) {
    const h = await Household.create();
    const groceries = await h.category("Groceries");
    const account = await h.account();
    await h.budget(groceries, "2026-03-01", limit);
    return { h, groceries, account };
  }

  it("is quiet under the warning threshold", async () => {
    const { h, groceries, account } = await setUp();
    await h.transaction(account, { amount: 80, date: TODAY, category_id: groceries });
    expect(await run(h)).toEqual([]);
  });

  it("warns, then reports the overage, each only once", async () => {
    const { h, groceries, account } = await setUp();
    await h.transaction(account, { amount: 95, date: TODAY, category_id: groceries });

    const [warning, ...rest] = await run(h);
    expect(rest).toEqual([]);
    expect(warning.title).toBe("Approaching budget limit: Groceries");
    expect(warning.severity).toBe("info");
    expect(warning.message).toBe("You've used 95% of your $100.00 Groceries budget this month ($95.00 spent).");
    expect(await run(h)).toEqual([]);

    await h.transaction(account, { amount: 10, date: TODAY, category_id: groceries });
    const [exceeded, ...more] = await run(h);
    expect(more).toEqual([]);
    expect(exceeded.title).toBe("Budget exceeded: Groceries");
    expect(exceeded.severity).toBe("warning");
    expect(exceeded.related_entity_type).toBe("budget");
    expect(await run(h)).toEqual([]);
  });

  it("ignores last month's spending", async () => {
    const { h, groceries, account } = await setUp();
    await h.transaction(account, { amount: 500, date: "2026-02-28", category_id: groceries });
    expect(await run(h)).toEqual([]);
  });
});

describe("goal milestones", () => {
  it("announces only the highest new milestone", async () => {
    const h = await Household.create();
    const goal = await h.goal("House", 1000, 600);

    const [note] = await run(h);
    expect(note.title).toBe("50% of the way to House");
    expect(note.related_entity_id).toBe(goal);
    expect((await h.doc("goals", goal))!.last_milestone_pct).toBe(50);
    expect(await run(h)).toEqual([]);

    await h.setGoalAmount(goal, 1000);
    const [done] = await run(h);
    expect(done.title).toBe("Goal complete: House!");
    expect(done.severity).toBe("success");
    expect(await run(h)).toEqual([]);
  });

  it("is quiet below the first milestone", async () => {
    const h = await Household.create();
    await h.goal("Car", 1000, 200);
    expect(await run(h)).toEqual([]);
  });
});

describe("upcoming bills", () => {
  it("announces a bill within the lead time once", async () => {
    const h = await Household.create();
    await h.bill({ name: "Internet", amount: 80, due_day: 12 });
    const [note] = await run(h);
    expect(note.title).toBe("Internet due in 2 days");
    expect(note.severity).toBe("info");
    expect(await run(h)).toEqual([]);
  });

  it("warns about a bill due today or tomorrow", async () => {
    const h = await Household.create();
    await h.bill({ name: "Rent", amount: 2000, due_day: 10 });
    await h.bill({ name: "Phone", amount: 60, due_day: 11 });
    const notes = await run(h);
    expect(titles(notes)).toEqual(["Phone due tomorrow", "Rent due today"]);
    expect(notes.every((n) => n.severity === "warning")).toBe(true);
  });

  it("is quiet outside the lead time", async () => {
    const h = await Household.create();
    await h.bill({ name: "Gym", amount: 40, due_day: 20 });
    await h.bill({ name: "Water", amount: 40, due_day: 9 }); // just passed
    expect(await run(h)).toEqual([]);
  });

  it("is quiet for a paused bill", async () => {
    const h = await Household.create();
    await h.bill({ name: "Old gym", amount: 40, due_day: 11, is_active: false });
    expect(await run(h)).toEqual([]);
  });

  it("is quiet once a payment within 15% has posted", async () => {
    const h = await Household.create();
    const account = await h.account();
    await h.bill({ name: "Internet", amount: 80, due_day: 12 });
    await h.transaction(account, { amount: 85, date: addDays(TODAY, -3), name: "ISP" });
    expect(await run(h)).toEqual([]);
  });

  it("doesn't count a payment outside the tolerance or in another category", async () => {
    const h = await Household.create();
    const account = await h.account();
    const utilities = await h.category("Utilities");
    const shopping = await h.category("Shopping");
    await h.bill({ name: "Power", amount: 100, due_day: 12, category_id: utilities });
    await h.transaction(account, { amount: 150, date: TODAY, category_id: utilities }); // >15% off
    await h.transaction(account, { amount: 100, date: TODAY, category_id: shopping });
    expect(titles(await run(h))).toEqual(["Power due in 2 days"]);
  });

  it("rolls the due date into next month", async () => {
    const h = await Household.create();
    await h.bill({ name: "Rent", amount: 2000, due_day: 1 });
    const [note] = await run(h, "2026-03-30");
    expect(note.title).toBe("Rent due in 2 days");
    expect(note.message).toBe("$2,000.00 for Rent is due on Apr 01.");
  });
});

describe("large transactions", () => {
  it("reports recent large debits only", async () => {
    const h = await Household.create();
    const account = await h.account();
    const big = await h.transaction(account, { amount: 600, date: TODAY, name: "TV" });
    await h.transaction(account, { amount: 600, date: addDays(TODAY, -5), name: "Old" });
    await h.transaction(account, { amount: 600, date: TODAY, name: "Paycheck", direction: "credit" });
    await h.transaction(account, { amount: 400, date: TODAY, name: "Small" });

    const [note, ...rest] = await run(h);
    expect(rest).toEqual([]);
    expect(note.title).toBe("Large transaction: $600.00");
    expect(note.message).toBe("TV on Mar 10 was $600.00.");
    expect(note.related_entity_id).toBe(big);
    expect(await run(h)).toEqual([]);
  });
});

describe("idle cash", () => {
  it("flags only savings above the threshold", async () => {
    const h = await Household.create();
    const savings = await h.account({ name: "HYSA", type: "savings", balance: 15_000 });
    await h.account({ name: "Checking", type: "checking", balance: 15_000 });
    await h.account({ name: "Small savings", type: "savings", balance: 5_000 });

    const [note, ...rest] = await run(h);
    expect(rest).toEqual([]);
    expect(note.title).toBe("Idle cash in HYSA");
    expect(note.related_entity_id).toBe(savings);
    expect(await run(h)).toEqual([]);
  });

  it("fires again the next month", async () => {
    const h = await Household.create();
    await h.account({ name: "HYSA", type: "savings", balance: 15_000 });
    expect(await run(h)).toHaveLength(1);
    expect(await run(h, "2026-04-10")).toHaveLength(1);
  });
});

describe("credit alerts", () => {
  it("flags high utilization once a month", async () => {
    const h = await Household.create();
    await h.creditScore("alex", 720, "2026-03-01", 45);
    expect(titles(await run(h))).toEqual(["High credit utilization for Alex"]);
    expect(await run(h)).toEqual([]);
  });

  it("flags a score drop of 15 or more", async () => {
    const h = await Household.create({ alex: "Alex", sam: "Sam" });
    await h.creditScore("alex", 760, "2026-02-01");
    await h.creditScore("alex", 745, "2026-03-01");
    await h.creditScore("sam", 760, "2026-02-01");
    await h.creditScore("sam", 750, "2026-03-01");

    const [note, ...rest] = await run(h);
    expect(rest).toEqual([]);
    expect(note.title).toBe("Credit score drop for Alex");
    expect(note.message).toContain("from 760 to 745");
  });
});

describe("stored notifications", () => {
  it("are unread, and keyed so each event is stored once", async () => {
    const h = await Household.create();
    await h.account({ name: "HYSA", type: "savings", balance: 15_000 });
    await h.goal("Trip", 100, 100);
    expect(await run(h)).toHaveLength(2);
    await run(h);

    const stored = await h.notifications();
    expect(stored).toHaveLength(2);
    expect(stored.every((n) => n.is_read === false && n.created_at)).toBe(true);
  });
});
