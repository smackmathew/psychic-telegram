// Dates are "YYYY-MM-DD" strings, the same format the app stores. The arithmetic here treats
// them as UTC calendar days, so it never shifts by a day because of the server's time zone.

function parse(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

function format(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Today's date in the given IANA time zone, e.g. "America/New_York". */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  // en-CA formats dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function addDays(date: string, days: number): string {
  const d = parse(date);
  d.setUTCDate(d.getUTCDate() + days);
  return format(d);
}

/** Same day of the month, `months` away (the day must exist in both months; bills use 1-28). */
export function addMonths(date: string, months: number): string {
  const d = parse(date);
  d.setUTCMonth(d.getUTCMonth() + months);
  return format(d);
}

export function withDay(date: string, day: number): string {
  return `${date.slice(0, 8)}${String(day).padStart(2, "0")}`;
}

export function monthStart(date: string): string {
  return withDay(date, 1);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((parse(to).getTime() - parse(from).getTime()) / 86_400_000);
}

/** "Apr 01" */
export function shortDate(date: string): string {
  const d = parse(date);
  const month = d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
  return `${month} ${String(d.getUTCDate()).padStart(2, "0")}`;
}
