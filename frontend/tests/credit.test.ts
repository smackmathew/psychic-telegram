import { beforeEach, describe, expect, it } from "vitest";
import { CreditApi } from "../src/firebase/credit";
import { AuthApi, HouseholdApi } from "../src/firebase/household";
import { createAccount, signUpNewHousehold } from "./helpers";

let alex: { id: string; email: string };

/** Signs a partner up into the current household; afterwards the partner is the signed-in user. */
async function addPartner(): Promise<string> {
  const { invite_code } = await HouseholdApi.get();
  const partner = await AuthApi.signup({
    full_name: "Sam",
    email: `sam${Date.now()}@example.com`,
    password: "password123",
    invite_code,
  });
  return partner.id;
}

async function signBackInAsAlex() {
  await AuthApi.login(alex.email, "password123");
}

beforeEach(async () => {
  const { user, email } = await signUpNewHousehold("Alex");
  alex = { id: user.id, email };
});

describe("credit profiles", () => {
  it("keeps one profile per person and appends to their history", async () => {
    const first = await CreditApi.upsertProfile(alex.id, { score: 700, bureau: "experian", utilization_pct: 25, recorded_date: "2026-01-01" });
    const second = await CreditApi.upsertProfile(alex.id, { score: 720, recorded_date: "2026-02-01" });

    expect(second.id).toBe(first.id);
    expect(second.score).toBe(720);
    expect(second.utilization_pct).toBeNull(); // factors left out are cleared
    expect((await CreditApi.listProfiles()).map((p) => p.score)).toEqual([720]);

    const history = await CreditApi.history(alex.id);
    expect(history.map((h) => [h.recorded_date, h.score])).toEqual([
      ["2026-01-01", 700],
      ["2026-02-01", 720],
    ]);
  });

  it("lets a member update their partner's profile", async () => {
    const samId = await addPartner();
    await signBackInAsAlex();
    await CreditApi.upsertProfile(samId, { score: 690 });
    expect((await CreditApi.listProfiles()).map((p) => [p.user_id, p.score])).toEqual([[samId, 690]]);
  });

  it.each([{ score: 299 }, { score: 851 }, { score: 700.5 }, { score: 700, utilization_pct: 101 }, { score: 700, num_open_accounts: -1 }])(
    "rejects %j",
    async (payload) => {
      await expect(CreditApi.upsertProfile(alex.id, payload)).rejects.toThrow();
      expect(await CreditApi.listProfiles()).toEqual([]);
    },
  );

  it("gives recommendations once a profile exists", async () => {
    await expect(CreditApi.recommendations(alex.id)).rejects.toThrow("No credit profile on file yet");

    await CreditApi.upsertProfile(alex.id, { score: 650, utilization_pct: 60 });
    const body = await CreditApi.recommendations(alex.id);
    expect(body.score_band).toBe("Fair");
    expect(body.recommendations[0].title).toBe("Pay down revolving balances");
  });

  it("rejects someone who isn't in the household", async () => {
    await expect(CreditApi.upsertProfile("not-a-user", { score: 700 })).rejects.toThrow("Household member not found");
  });
});

describe("borrowing capacity", () => {
  async function setUpHousehold() {
    await HouseholdApi.update({ annual_gross_income: 120_000 });
    await createAccount({ name: "Checking", type: "checking", current_balance: 30_000 });
    await createAccount({ name: "Savings", type: "savings", current_balance: 20_000 });
    await createAccount({ name: "Brokerage", type: "investment", current_balance: 100_000 });
    await createAccount({ name: "Card", type: "credit_card", current_balance: 2_000, monthly_payment: 200 });
    await createAccount({ name: "Car loan", type: "loan", current_balance: 15_000, monthly_payment: 300 });
    await CreditApi.upsertProfile(alex.id, { score: 690 });
    const samId = await addPartner();
    await CreditApi.upsertProfile(samId, { score: 760 });
  }

  it("uses the household's data", async () => {
    await setUpHousehold();
    const result = await CreditApi.borrowingCapacity({});
    expect(result.monthly_gross_income).toBe(10_000);
    expect(result.monthly_debt_payments).toBe(500); // card + loan minimums
    expect(result.cash_reserves).toBe(50_000); // checking + savings, not investments
    expect(result.current_dti_pct).toBe(5);
    expect(result.mortgage_readiness).toMatch(/^Strong/); // best score in the household (760)
  });

  it("applies overrides from the request", async () => {
    await setUpHousehold();
    const result = await CreditApi.borrowingCapacity({ annual_gross_income: 60_000, extra_monthly_debt: 100, cash_reserves_override: 1_000 });
    expect(result.monthly_gross_income).toBe(5_000);
    expect(result.monthly_debt_payments).toBe(600);
    expect(result.cash_reserves).toBe(1_000);
  });

  it("works without profiles or income", async () => {
    const result = await CreditApi.borrowingCapacity({});
    expect(result.monthly_gross_income).toBe(0);
    expect(result.mortgage_readiness).toMatch(/^Add a credit score/);
  });
});
