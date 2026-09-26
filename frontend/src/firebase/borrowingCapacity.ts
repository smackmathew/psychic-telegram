// Rule-of-thumb borrowing-capacity estimates (28/36 DTI, standard mortgage amortization,
// typical SBA / investment-property down payment norms). These are educational estimates,
// not a loan pre-approval or financial advice - actual terms depend on the lender, full
// credit report, assets, and program-specific underwriting.
import type { BorrowingCapacityOut } from "../types";

export const DISCLAIMER =
  "These are rough, rule-of-thumb estimates (28/36 debt-to-income guideline, standard mortgage " +
  "amortization, typical down-payment norms) - not a pre-approval or financial/lending advice. " +
  "Actual borrowing capacity depends on the lender, your full credit report, assets, and program.";

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/** "$250,000" */
function dollars(value: number): string {
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

/** The loan a monthly payment supports at a given rate and term. */
export function amortizedPrincipal(monthlyPayment: number, annualRatePct: number, termYears: number): number {
  const r = annualRatePct / 100 / 12;
  const n = termYears * 12;
  if (monthlyPayment <= 0) return 0;
  if (r === 0) return monthlyPayment * n;
  return (monthlyPayment * (1 - (1 + r) ** -n)) / r;
}

export interface BorrowingCapacityInputs {
  annualGrossIncome: number;
  monthlyDebtPayments: number;
  cashReserves: number;
  bestCreditScore: number | null;
  interestRatePct: number;
  termYears: number;
  downPaymentPct: number;
}

export function computeBorrowingCapacity(inputs: BorrowingCapacityInputs): BorrowingCapacityOut {
  const { annualGrossIncome, monthlyDebtPayments, cashReserves, bestCreditScore, interestRatePct, termYears, downPaymentPct } = inputs;
  const monthlyIncome = annualGrossIncome ? annualGrossIncome / 12 : 0;
  const currentDtiPct = monthlyIncome ? (monthlyDebtPayments / monthlyIncome) * 100 : 0;

  const maxHousingFrontEnd = monthlyIncome * 0.28;
  const maxTotalDebtBackEnd = monthlyIncome * 0.36;
  const maxHousingBackEnd = Math.max(maxTotalDebtBackEnd - monthlyDebtPayments, 0);
  const maxMonthlyHousingPayment = monthlyIncome ? Math.min(maxHousingFrontEnd, maxHousingBackEnd) : 0;

  const maxLoanPrincipal = amortizedPrincipal(maxMonthlyHousingPayment, interestRatePct, termYears);
  const downPct = Math.max(Math.min(downPaymentPct, 99), 0) / 100;
  const estimatedMaxHomePrice = downPct < 1 ? maxLoanPrincipal / (1 - downPct) : maxLoanPrincipal;
  const requiredDownPayment = estimatedMaxHomePrice * downPct;
  const downPaymentShortfall = Math.max(requiredDownPayment - cashReserves, 0);

  const notes = [DISCLAIMER];

  let mortgageReadiness: string;
  if (bestCreditScore == null) {
    mortgageReadiness = "Add a credit score for household members to get a real readiness read.";
  } else if (monthlyIncome <= 0) {
    mortgageReadiness = "Add your household's annual gross income (Household settings) to estimate mortgage readiness.";
  } else if (bestCreditScore >= 740 && currentDtiPct <= 36) {
    mortgageReadiness = "Strong: score and DTI are in range for the best conventional mortgage rates.";
  } else if (bestCreditScore >= 670 && currentDtiPct <= 43) {
    mortgageReadiness = "Good: you'd likely qualify for a conventional mortgage, possibly not at the top-tier rate.";
  } else if (bestCreditScore >= 620) {
    mortgageReadiness = "Workable via FHA or non-conventional programs; a conventional loan may be tough at this score/DTI.";
  } else {
    mortgageReadiness = "Below typical conventional/FHA minimums today - focus on credit-building and paying down debt first.";
  }

  let businessLoanReadiness: string;
  if (bestCreditScore == null || monthlyIncome <= 0) {
    businessLoanReadiness = "Add income and a credit score to estimate SBA/business-loan readiness.";
  } else {
    const lowPurchase = cashReserves ? cashReserves / 0.2 : 0;
    const highPurchase = cashReserves ? cashReserves / 0.1 : 0;
    notes.push(
      `Based on your ${dollars(cashReserves)} in liquid reserves, a typical SBA 7(a) acquisition loan ` +
        `(10-20% down) could support a purchase price of roughly ${dollars(lowPurchase)}-${dollars(highPurchase)}, ` +
        "before lenders also weigh cash flow of the target business and 3-6 months of reserves.",
    );
    if (bestCreditScore >= 680 && currentDtiPct <= 43) {
      businessLoanReadiness = "Good: score and DTI are in the range most SBA/bank lenders want for a business acquisition loan.";
    } else if (bestCreditScore >= 650) {
      businessLoanReadiness = "Borderline: SBA lenders may work with this score, but expect more scrutiny and possibly a larger down payment.";
    } else {
      businessLoanReadiness = "Below what most SBA/bank lenders want (650+) - build credit before pursuing acquisition financing.";
    }
  }

  let realEstateInvestmentReadiness: string;
  if (bestCreditScore == null || monthlyIncome <= 0) {
    realEstateInvestmentReadiness = "Add income and a credit score to estimate investment-property readiness.";
  } else {
    const lowRental = cashReserves ? cashReserves / 0.25 : 0;
    const highRental = cashReserves ? cashReserves / 0.2 : 0;
    notes.push(
      "Investment (non owner-occupied) properties usually need 20-25% down and stricter DTI. Your reserves " +
        `could cover the down payment on a ${dollars(lowRental)}-${dollars(highRental)} property, subject to rental-income ` +
        "underwriting rules.",
    );
    if (bestCreditScore >= 700 && currentDtiPct <= 45) {
      realEstateInvestmentReadiness = "Good: likely to qualify for investment-property financing at competitive terms.";
    } else if (bestCreditScore >= 660) {
      realEstateInvestmentReadiness = "Workable, but expect a rate premium over an owner-occupied mortgage.";
    } else {
      realEstateInvestmentReadiness =
        "Investment-property lenders are stricter than primary-residence lenders - build credit/DTI room first.";
    }
  }

  return {
    monthly_gross_income: round(monthlyIncome, 2),
    monthly_debt_payments: round(monthlyDebtPayments, 2),
    current_dti_pct: round(currentDtiPct, 1),
    max_monthly_housing_payment: round(maxMonthlyHousingPayment, 2),
    max_loan_principal: round(maxLoanPrincipal, 2),
    estimated_max_home_price: round(estimatedMaxHomePrice, 2),
    required_down_payment: round(requiredDownPayment, 2),
    cash_reserves: round(cashReserves, 2),
    down_payment_shortfall: round(downPaymentShortfall, 2),
    mortgage_readiness: mortgageReadiness,
    business_loan_readiness: businessLoanReadiness,
    real_estate_investment_readiness: realEstateInvestmentReadiness,
    notes,
  };
}
