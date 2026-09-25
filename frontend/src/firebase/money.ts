// Money is stored in Firestore as integer cents so balances can be adjusted with atomic
// increments without floating-point drift. The UI works in dollars; convert at the edge.

export function toCents(dollars: number): number {
  return Math.round(dollars * 100);
}

export function fromCents(cents: number): number {
  return cents / 100;
}

export function toCentsOrNull(dollars: number | null | undefined): number | null {
  return dollars == null ? null : toCents(dollars);
}

export function fromCentsOrNull(cents: number | null | undefined): number | null {
  return cents == null ? null : fromCents(cents);
}
