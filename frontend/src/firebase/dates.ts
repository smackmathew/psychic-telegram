// Dates are stored as local "YYYY-MM-DD" strings, which sort and compare correctly as text.

export function toDateString(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function parse(dateString: string): Date {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/** First day of the month containing `dateString`. */
export function monthStart(dateString: string): string {
  return `${dateString.slice(0, 7)}-01`;
}

/** First day of the month `months` away from the month containing `dateString`. */
export function addMonths(dateString: string, months: number): string {
  const d = parse(monthStart(dateString));
  return toDateString(new Date(d.getFullYear(), d.getMonth() + months, 1));
}

/** Last day of the month containing `dateString`. */
export function monthEnd(dateString: string): string {
  const d = parse(monthStart(dateString));
  return toDateString(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

/** "Mar 2026" */
export function monthLabel(dateString: string): string {
  return parse(dateString).toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

/**
 * The next date, on or after `today`, that a bill due on `dueDay` (1-28) of each month falls on.
 * Matches the rule the bill-due notification check uses (functions/src/notificationRules.ts).
 */
export function nextDueDate(dueDay: number, today: string): string {
  const thisMonth = `${today.slice(0, 7)}-${String(dueDay).padStart(2, "0")}`;
  if (thisMonth >= today) return thisMonth;
  return `${addMonths(today, 1).slice(0, 7)}-${String(dueDay).padStart(2, "0")}`;
}

/** Whole days from `from` to `to` (negative if `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((parse(to).getTime() - parse(from).getTime()) / 86_400_000);
}
