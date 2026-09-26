// Thresholds for the notification checks.
export const LARGE_TRANSACTION_THRESHOLD_CENTS = 500_00;
export const BUDGET_WARNING_PCT = 0.9;
export const UPCOMING_BILL_LEAD_DAYS = 3;
export const IDLE_CASH_INVESTMENT_THRESHOLD_CENTS = 10_000_00;

export const PLAID_PRODUCTS = ["transactions", "investments"] as const;
export const PLAID_COUNTRY_CODES = ["US"] as const;
