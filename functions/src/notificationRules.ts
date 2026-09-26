// The notification rule engine: given a household's data and today's date, decides which
// notifications should exist. Pure (no Firestore), so it's easy to test; household.ts loads
// the data and writes the results.
import {
  BUDGET_WARNING_PCT,
  IDLE_CASH_INVESTMENT_THRESHOLD_CENTS,
  LARGE_TRANSACTION_THRESHOLD_CENTS,
  UPCOMING_BILL_LEAD_DAYS,
} from "./config.js";
import { addDays, addMonths, daysBetween, monthStart, shortDate, withDay } from "./dates.js";
import { money, wholePercent } from "./format.js";

export interface HouseholdData {
  accounts: { id: string; name: string; type: string; current_balance_cents: number }[];
  transactions: {
    id: string;
    account_id: string;
    category_id: string | null;
    date: string;
    amount_cents: number;
    direction: "debit" | "credit";
    name: string;
  }[];
  categories: { id: string; name: string }[];
  budgets: { id: string; category_id: string; month: string; amount_limit_cents: number }[];
  goals: { id: string; name: string; target_amount_cents: number; current_amount_cents: number; last_milestone_pct: number }[];
  bills: { id: string; name: string; amount_cents: number; due_day: number; category_id: string | null; is_active: boolean }[];
  members: { id: string; full_name: string }[];
  creditProfiles: { user_id: string; utilization_pct: number | null }[];
  creditHistory: { user_id: string; score: number; recorded_date: string; created_at_ms: number }[];
}

export type NotificationType =
  | "bill_due"
  | "budget_exceeded"
  | "goal_milestone"
  | "large_transaction"
  | "investment_opportunity"
  | "sync_error"
  | "credit_alert";

export interface NotificationDraft {
  /** Identifies the event; a notification is only ever created once per key. */
  dedupe_key: string;
  type: NotificationType;
  severity: "info" | "warning" | "success";
  title: string;
  message: string;
  related_entity_type: string;
  related_entity_id: string;
}

export interface RuleResults {
  notifications: NotificationDraft[];
  /** Goals whose highest announced milestone moved up. */
  goalMilestones: { goalId: string; pct: number }[];
}

const MILESTONES = [25, 50, 75, 100];

export function evaluateRules(data: HouseholdData, today: string): RuleResults {
  const notifications: NotificationDraft[] = [];
  const goalMilestones: { goalId: string; pct: number }[] = [];
  const accountIds = new Set(data.accounts.map((a) => a.id));
  const transactions = data.transactions.filter((t) => accountIds.has(t.account_id));
  const debits = transactions.filter((t) => t.direction === "debit");
  const thisMonth = monthStart(today);
  const nextMonth = addMonths(thisMonth, 1);
  const period = today.slice(0, 7);

  // Budgets: a heads-up at 90% of the limit and another once it's exceeded, once each per month.
  const categoryNames = new Map(data.categories.map((c) => [c.id, c.name]));
  for (const budget of data.budgets.filter((b) => b.month === thisMonth)) {
    const limit = budget.amount_limit_cents;
    if (limit <= 0) continue;
    const spent = debits
      .filter((t) => t.category_id === budget.category_id && t.date >= thisMonth && t.date < nextMonth)
      .reduce((sum, t) => sum + t.amount_cents, 0);
    const pct = spent / limit;
    const category = categoryNames.get(budget.category_id) ?? "this category";
    const related = { related_entity_type: "budget", related_entity_id: budget.id };
    if (pct >= 1) {
      notifications.push({
        dedupe_key: `budget:${budget.id}:${period}:exceeded`,
        type: "budget_exceeded",
        severity: "warning",
        title: `Budget exceeded: ${category}`,
        message: `You've spent ${money(spent)} of your ${money(limit)} ${category} budget this month (${wholePercent(pct * 100)}%).`,
        ...related,
      });
    } else if (pct >= BUDGET_WARNING_PCT) {
      notifications.push({
        dedupe_key: `budget:${budget.id}:${period}:warning`,
        type: "budget_exceeded",
        severity: "info",
        title: `Approaching budget limit: ${category}`,
        message: `You've used ${wholePercent(pct * 100)}% of your ${money(limit)} ${category} budget this month (${money(spent)} spent).`,
        ...related,
      });
    }
  }

  // Goals: announce only the highest newly reached milestone.
  for (const goal of data.goals) {
    if (goal.target_amount_cents <= 0) continue;
    const pct = (goal.current_amount_cents / goal.target_amount_cents) * 100;
    const reached = MILESTONES.filter((m) => pct >= m && m > goal.last_milestone_pct);
    if (reached.length === 0) continue;
    const milestone = Math.max(...reached);
    notifications.push({
      dedupe_key: `goal:${goal.id}:${milestone}`,
      type: "goal_milestone",
      severity: milestone === 100 ? "success" : "info",
      title: milestone === 100 ? `Goal complete: ${goal.name}!` : `${milestone}% of the way to ${goal.name}`,
      message: `${goal.name} is at ${money(goal.current_amount_cents)} of ${money(goal.target_amount_cents)} (${wholePercent(pct)}%).`,
      related_entity_type: "goal",
      related_entity_id: goal.id,
    });
    goalMilestones.push({ goalId: goal.id, pct: milestone });
  }

  // Bills due within the lead time, unless a matching payment has already posted.
  for (const bill of data.bills.filter((b) => b.is_active)) {
    let due = withDay(today, bill.due_day);
    if (due < today) due = addMonths(due, 1);
    const daysUntil = daysBetween(today, due);
    if (daysUntil < 0 || daysUntil > UPCOMING_BILL_LEAD_DAYS) continue;

    const periodStart = addMonths(due, -1);
    const alreadyPaid = debits.some(
      (t) =>
        t.date >= periodStart &&
        t.date <= addDays(due, 1) &&
        t.amount_cents >= bill.amount_cents * 0.85 &&
        t.amount_cents <= bill.amount_cents * 1.15 &&
        (!bill.category_id || t.category_id === bill.category_id),
    );
    if (alreadyPaid) continue;

    const when = daysUntil === 0 ? "today" : daysUntil === 1 ? "tomorrow" : `in ${daysUntil} days`;
    notifications.push({
      dedupe_key: `bill:${bill.id}:${due}`,
      type: "bill_due",
      severity: daysUntil <= 1 ? "warning" : "info",
      title: `${bill.name} due ${when}`,
      message: `${money(bill.amount_cents)} for ${bill.name} is due on ${shortDate(due)}.`,
      related_entity_type: "recurring_bill",
      related_entity_id: bill.id,
    });
  }

  // Large debits in the last two days.
  const since = addDays(today, -2);
  for (const t of debits.filter((t) => t.amount_cents >= LARGE_TRANSACTION_THRESHOLD_CENTS && t.date >= since)) {
    notifications.push({
      dedupe_key: `large_txn:${t.id}`,
      type: "large_transaction",
      severity: "info",
      title: `Large transaction: ${money(t.amount_cents)}`,
      message: `${t.name} on ${shortDate(t.date)} was ${money(t.amount_cents)}.`,
      related_entity_type: "transaction",
      related_entity_id: t.id,
    });
  }

  // Savings balances above the idle-cash threshold, at most once a month per account.
  for (const account of data.accounts) {
    if (account.type !== "savings" || account.current_balance_cents < IDLE_CASH_INVESTMENT_THRESHOLD_CENTS) continue;
    notifications.push({
      dedupe_key: `idle_cash:${account.id}:${period}`,
      type: "investment_opportunity",
      severity: "info",
      title: `Idle cash in ${account.name}`,
      message:
        `${account.name} has ${money(account.current_balance_cents)}, above your ` +
        `${money(IDLE_CASH_INVESTMENT_THRESHOLD_CENTS)} idle-cash threshold. Once your emergency fund is covered, ` +
        "consider moving the excess into an investment or high-yield account.",
      related_entity_type: "account",
      related_entity_id: account.id,
    });
  }

  // Credit: high utilization (monthly) and a drop of 15+ points between the last two scores.
  const names = new Map(data.members.map((m) => [m.id, m.full_name]));
  for (const profile of data.creditProfiles) {
    const name = names.get(profile.user_id) ?? "a household member";
    const related = { related_entity_type: "credit_profile", related_entity_id: profile.user_id };
    if (profile.utilization_pct != null && profile.utilization_pct > 30) {
      notifications.push({
        dedupe_key: `credit_util:${profile.user_id}:${period}`,
        type: "credit_alert",
        severity: "warning",
        title: `High credit utilization for ${name}`,
        message:
          `${name}'s reported utilization is ${wholePercent(profile.utilization_pct)}%, ` +
          "above the 30% level that most scoring models penalize. Paying down balances " +
          "before the statement closes date can help.",
        ...related,
      });
    }

    const [latest, previous] = data.creditHistory
      .filter((h) => h.user_id === profile.user_id)
      .sort((a, b) => b.recorded_date.localeCompare(a.recorded_date) || b.created_at_ms - a.created_at_ms);
    if (latest && previous && previous.score - latest.score >= 15) {
      notifications.push({
        dedupe_key: `credit_drop:${profile.user_id}:${latest.recorded_date}`,
        type: "credit_alert",
        severity: "warning",
        title: `Credit score drop for ${name}`,
        message:
          `${name}'s score fell from ${previous.score} to ${latest.score}. ` +
          "Check for new derogatory marks, hard inquiries, or a spike in utilization.",
        ...related,
      });
    }
  }

  return { notifications, goalMilestones };
}
