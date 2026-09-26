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
