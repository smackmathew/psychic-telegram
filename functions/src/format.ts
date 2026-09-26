/** "$1,234.50" */
export function money(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** "45" for 45.4 */
export function wholePercent(value: number): string {
  return Math.round(value).toString();
}
