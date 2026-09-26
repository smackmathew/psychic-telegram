import { getDocs, query, where } from "firebase/firestore";
import type { DashboardSummary, NetWorthPoint } from "../types";
import { addMonths, monthEnd, monthLabel, monthStart, toDateString } from "./dates";
import { isLiabilityAccount, transactionDelta } from "./finance";
import { AccountsApi, allTransactions, CategoriesApi } from "./ledger";
import { fromCents, toCents } from "./money";
import { householdCollection } from "./session";

const TREND_MONTHS = 6;

/**
 * Totals, this month's cash flow and spending, and a six-month net-worth trend. Sums are
 * worked out in cents. `today` is a parameter so tests can pin the date.
 */
export async function dashboardSummary(today: Date = new Date()): Promise<DashboardSummary> {
  const [accounts, transactions, categories, unread] = await Promise.all([
    AccountsApi.list(),
    allTransactions(),
    CategoriesApi.list(),
    getDocs(query(householdCollection("notifications"), where("is_read", "==", false))),
  ]);
  const todayString = toDateString(today);
  const thisMonth = monthStart(todayString);
  const accountsById = new Map(accounts.map((a) => [a.id, a]));
  const categoryNames = new Map(categories.map((c) => [c.id, c.name]));

  let assetsCents = 0;
  let liabilitiesCents = 0;
  for (const account of accounts) {
    if (isLiabilityAccount(account.type)) liabilitiesCents += toCents(account.current_balance);
    else assetsCents += toCents(account.current_balance);
  }

  let incomeCents = 0;
  let expensesCents = 0;
  const spendingCents = new Map<string, number>();
  for (const t of transactions) {
    const account = accountsById.get(t.account_id);
    if (!account || t.date < thisMonth) continue;
    const cents = toCents(t.amount);
    if (t.direction === "credit") {
      // Money into a credit card or loan is a payment or refund, not income.
      if (!isLiabilityAccount(account.type)) incomeCents += cents;
    } else {
      expensesCents += cents;
      const name = t.category_id ? categoryNames.get(t.category_id) : undefined;
      if (name) spendingCents.set(name, (spendingCents.get(name) ?? 0) + cents);
    }
  }

  // Net worth at the end of each of the last six months (up to today for this month):
  // start from today's balances and undo every transaction dated after that point.
  const trend: NetWorthPoint[] = [];
  for (let i = TREND_MONTHS - 1; i >= 0; i--) {
    const start = addMonths(thisMonth, -i);
    const asOf = i === 0 ? todayString : monthEnd(start);
    let assets = 0;
    let liabilities = 0;
    for (const account of accounts) {
      const undone = transactions
        .filter((t) => t.account_id === account.id && t.date > asOf)
        .reduce((sum, t) => sum + toCents(transactionDelta(account.type, t.amount, t.direction)), 0);
      const balance = toCents(account.current_balance) - undone;
      if (isLiabilityAccount(account.type)) liabilities += balance;
      else assets += balance;
    }
    trend.push({
      label: monthLabel(start),
      assets: fromCents(assets),
      liabilities: fromCents(liabilities),
      net_worth: fromCents(assets - liabilities),
    });
  }

  return {
    total_assets: fromCents(assetsCents),
    total_liabilities: fromCents(liabilitiesCents),
    net_worth: fromCents(assetsCents - liabilitiesCents),
    month_income: fromCents(incomeCents),
    month_expenses: fromCents(expensesCents),
    spending_by_category: [...spendingCents.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([category_name, cents]) => ({ category_name, amount: fromCents(cents) })),
    net_worth_trend: trend,
    unread_notifications: unread.size,
  };
}

export const DashboardApi = {
  // Wrapped so React Query's context argument isn't taken for `today`.
  summary: () => dashboardSummary(),
};
