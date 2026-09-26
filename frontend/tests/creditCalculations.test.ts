// Pure calculations: no Firebase involved.
import { describe, expect, it } from "vitest";
import { DISCLAIMER, amortizedPrincipal, computeBorrowingCapacity, type BorrowingCapacityInputs } from "../src/firebase/borrowingCapacity";
import { buildRecommendations, scoreBand } from "../src/firebase/creditAdvisor";

describe("credit score bands", () => {
  it.each([
    [850, "Exceptional"], [800, "Exceptional"], [799, "Very Good"], [740, "Very Good"], [739, "Good"],
    [670, "Good"], [669, "Fair"], [580, "Fair"], [579, "Poor"], [300, "Poor"],
  ])("%d is %s", (score, band) => {
    expect(scoreBand(score)).toBe(band);
  });
});

describe("credit recommendations", () => {
  const titles = (fields: Record<string, number> = {}) =>
    buildRecommendations({ score: 780, ...fields }).map((r) => r.title);

  it("gives a clean profile a single all-clear", () => {
    expect(titles({ utilization_pct: 5, on_time_payment_pct: 100, credit_age_years: 10, num_open_accounts: 5 })).toEqual([
      "You're in great shape",
    ]);
  });

  it("gives an all-clear when no factors are entered", () => {
    expect(titles()).toEqual(["You're in great shape"]);
  });

  it.each<[Record<string, number>, string]>([
    [{ utilization_pct: 45 }, "Pay down revolving balances"],
    [{ utilization_pct: 20 }, "Push utilization under 10%"],
    [{ on_time_payment_pct: 97 }, "Set up autopay for at least the minimum due"],
    [{ num_derogatory_marks: 1 }, "Resolve derogatory marks"],
    [{ num_hard_inquiries_12mo: 3 }, "Slow down on new credit applications"],
    [{ credit_age_years: 1.5 }, "Keep your oldest accounts open"],
    [{ num_open_accounts: 1 }, "Build a healthy credit mix over time"],
    [{ score: 640 }, "Consider a secured card or credit-builder loan"],
  ])("%j triggers %s", (fields, expected) => {
    const result = titles(fields);
    expect(result).toContain(expected);
    expect(result).not.toContain("You're in great shape");
  });

  it.each([
    { utilization_pct: 10 }, // at the threshold, not over it
    { num_hard_inquiries_12mo: 2 },
    { num_derogatory_marks: 0 },
    { credit_age_years: 3 },
    { num_open_accounts: 2 },
    { score: 670 },
  ])("thresholds are exclusive: %j", (fields) => {
    expect(titles(fields)).toEqual(["You're in great shape"]);
  });

  it("sorts by priority", () => {
    const priorities = buildRecommendations({
      score: 600,
      utilization_pct: 50,
      credit_age_years: 1,
      num_hard_inquiries_12mo: 5,
      num_derogatory_marks: 2,
    }).map((r) => r.priority);
    const order = { high: 0, medium: 1, low: 2 };
    expect(priorities).toEqual([...priorities].sort((a, b) => order[a] - order[b]));
    expect(priorities[0]).toBe("high");
    expect(priorities.at(-1)).toBe("low");
  });
});

describe("amortized principal", () => {
  it("matches a standard amortization table", () => {
    // $1,000/month at 6% over 30 years supports a ~$166,791.61 loan.
    expect(amortizedPrincipal(1000, 6, 30)).toBeCloseTo(166_791.61, 2);
  });

  it("is simple multiplication at a zero rate", () => {
    expect(amortizedPrincipal(1000, 0, 30)).toBe(360_000);
  });

  it("supports no loan for a non-positive payment", () => {
    expect(amortizedPrincipal(0, 6, 30)).toBe(0);
    expect(amortizedPrincipal(-50, 6, 30)).toBe(0);
  });
});

describe("borrowing capacity", () => {
  const compute = (overrides: Partial<BorrowingCapacityInputs> = {}) =>
    computeBorrowingCapacity({
      annualGrossIncome: 120_000,
      monthlyDebtPayments: 500,
      cashReserves: 50_000,
      bestCreditScore: 750,
      interestRatePct: 6.5,
      termYears: 30,
      downPaymentPct: 20,
      ...overrides,
    });

  it("is limited by the 28% front-end ratio when debt is low", () => {
    const result = compute({ interestRatePct: 0 });
    expect(result.monthly_gross_income).toBe(10_000);
    expect(result.current_dti_pct).toBe(5);
    // min(28% of income = 2,800, 36% of income - debts = 3,100)
    expect(result.max_monthly_housing_payment).toBe(2_800);
    expect(result.max_loan_principal).toBe(2_800 * 360);
    expect(result.estimated_max_home_price).toBeCloseTo((2_800 * 360) / 0.8, 2);
    expect(result.required_down_payment).toBeCloseTo(((2_800 * 360) / 0.8) * 0.2, 2);
    expect(result.down_payment_shortfall).toBeCloseTo(((2_800 * 360) / 0.8) * 0.2 - 50_000, 2);
  });

  it("is limited by the 36% back-end ratio when debt is high", () => {
    // 36% of 10,000 - 1,500 = 2,100 < 2,800
    expect(compute({ monthlyDebtPayments: 1_500 }).max_monthly_housing_payment).toBe(2_100);
  });

  it("leaves no housing room when debts exceed the back-end limit", () => {
    const result = compute({ monthlyDebtPayments: 5_000 });
    expect(result.max_monthly_housing_payment).toBe(0);
    expect(result.max_loan_principal).toBe(0);
    expect(result.estimated_max_home_price).toBe(0);
  });

  it("has no shortfall when reserves cover the down payment", () => {
    expect(compute({ cashReserves: 10_000_000 }).down_payment_shortfall).toBe(0);
  });

  it("clamps the down payment to 99% rather than dividing by zero", () => {
    const result = compute({ downPaymentPct: 150 });
    expect(result.estimated_max_home_price / (result.max_loan_principal / 0.01)).toBeCloseTo(1, 5);
  });

  it("handles zero income", () => {
    const result = compute({ annualGrossIncome: 0 });
    expect(result.monthly_gross_income).toBe(0);
    expect(result.current_dti_pct).toBe(0);
    expect(result.max_monthly_housing_payment).toBe(0);
    expect(result.mortgage_readiness).toContain("annual gross income");
    expect(result.business_loan_readiness).toMatch(/^Add income/);
  });

  it("handles a missing credit score", () => {
    const result = compute({ bestCreditScore: null });
    expect(result.mortgage_readiness).toMatch(/^Add a credit score/);
    expect(result.business_loan_readiness).toMatch(/^Add income and a credit score/);
    expect(result.real_estate_investment_readiness).toMatch(/^Add income and a credit score/);
    expect(result.notes).toEqual([DISCLAIMER]);
  });

  it.each([
    [760, 500, "Strong"],
    [760, 4_000, "Good"], // DTI 40%: too high for "Strong", fine for "Good"
    [700, 500, "Good"],
    [640, 500, "Workable"],
    [600, 500, "Below"],
  ])("mortgage readiness for score %d and debt %d starts with %s", (score, debt, prefix) => {
    expect(compute({ bestCreditScore: score, monthlyDebtPayments: debt }).mortgage_readiness.startsWith(prefix)).toBe(true);
  });

  it.each([[700, "Good"], [660, "Borderline"], [600, "Below"]])("business loan readiness for %d is %s", (score, prefix) => {
    expect(compute({ bestCreditScore: score }).business_loan_readiness.startsWith(prefix)).toBe(true);
  });

  it.each([[720, "Good"], [670, "Workable"], [600, "Investment-property"]])("investment readiness for %d is %s", (score, prefix) => {
    expect(compute({ bestCreditScore: score }).real_estate_investment_readiness.startsWith(prefix)).toBe(true);
  });

  it("notes purchase ranges from reserves", () => {
    const { notes } = compute({ cashReserves: 50_000 });
    expect(notes[0]).toBe(DISCLAIMER);
    // SBA 7(a): 10-20% down; investment property: 20-25% down.
    expect(notes[1]).toContain("$250,000-$500,000");
    expect(notes[2]).toContain("$200,000-$250,000");
  });
});
