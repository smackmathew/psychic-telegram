export type AccountType = "checking" | "savings" | "credit_card" | "investment" | "loan" | "other";
export type CategoryType = "income" | "expense";
export type TransactionDirection = "debit" | "credit";
export type GoalType = "savings" | "debt_payoff" | "investment";
export type NotificationType =
  | "bill_due"
  | "budget_exceeded"
  | "goal_milestone"
  | "large_transaction"
  | "investment_opportunity"
  | "sync_error"
  | "credit_alert";
export type NotificationSeverity = "info" | "warning" | "success";
export type CreditBureau = "experian" | "equifax" | "transunion" | "other";

export interface User {
  id: string;
  email: string;
  full_name: string;
  household_id: string;
}

export interface Household {
  id: string;
  name: string;
  invite_code: string;
  annual_gross_income: number | null;
}

export interface Account {
  id: string;
  name: string;
  institution_name: string | null;
  type: AccountType;
  current_balance: number;
  available_balance: number | null;
  monthly_payment: number | null;
  currency: string;
  is_manual: boolean;
  plaid_item_id: string | null;
  updated_at: string;
}

export interface Category {
  id: string;
  name: string;
  type: CategoryType;
  icon: string | null;
  is_default: boolean;
}

export interface Transaction {
  id: string;
  account_id: string;
  category_id: string | null;
  date: string;
  amount: number;
  direction: TransactionDirection;
  name: string;
  merchant_name: string | null;
  notes: string | null;
  pending: boolean;
  is_manual: boolean;
  created_at: string;
}

export interface BudgetOut {
  id: string;
  category_id: string;
  month: string;
  amount_limit: number;
  category: Category;
}

export interface BudgetProgress {
  budget: BudgetOut;
  spent: number;
  remaining: number;
  pct_used: number;
}

export interface Goal {
  id: string;
  name: string;
  type: GoalType;
  target_amount: number;
  current_amount: number;
  target_date: string | null;
  linked_account_id: string | null;
  created_at: string;
}

export interface RecurringBill {
  id: string;
  name: string;
  amount: number;
  due_day: number;
  category_id: string | null;
  account_id: string | null;
  is_active: boolean;
}

export interface Notification {
  id: string;
  type: NotificationType;
  severity: NotificationSeverity;
  title: string;
  message: string;
  is_read: boolean;
  related_entity_type: string | null;
  related_entity_id: string | null;
  created_at: string;
}

export interface NetWorthPoint {
  label: string;
  assets: number;
  liabilities: number;
  net_worth: number;
}

export interface SpendingByCategory {
  category_name: string;
  amount: number;
}

export interface DashboardSummary {
  total_assets: number;
  total_liabilities: number;
  net_worth: number;
  month_income: number;
  month_expenses: number;
  spending_by_category: SpendingByCategory[];
  net_worth_trend: NetWorthPoint[];
  unread_notifications: number;
}

export interface CreditProfile {
  id: string;
  user_id: string;
  bureau: CreditBureau;
  score: number;
  utilization_pct: number | null;
  on_time_payment_pct: number | null;
  credit_age_years: number | null;
  num_hard_inquiries_12mo: number | null;
  num_open_accounts: number | null;
  num_derogatory_marks: number | null;
  updated_at: string;
}

export interface CreditScoreHistoryPoint {
  id: string;
  bureau: CreditBureau;
  score: number;
  recorded_date: string;
}

export interface CreditRecommendation {
  title: string;
  detail: string;
  priority: "high" | "medium" | "low";
}

export interface CreditRecommendationsOut {
  user_id: string;
  score: number;
  score_band: string;
  recommendations: CreditRecommendation[];
}

export interface BorrowingCapacityRequest {
  annual_gross_income?: number | null;
  extra_monthly_debt?: number;
  interest_rate_pct?: number;
  term_years?: number;
  down_payment_pct?: number;
  cash_reserves_override?: number | null;
}

export interface BorrowingCapacityOut {
  monthly_gross_income: number;
  monthly_debt_payments: number;
  current_dti_pct: number;
  max_monthly_housing_payment: number;
  max_loan_principal: number;
  estimated_max_home_price: number;
  required_down_payment: number;
  cash_reserves: number;
  down_payment_shortfall: number;
  mortgage_readiness: string;
  business_loan_readiness: string;
  real_estate_investment_readiness: string;
  notes: string[];
}
