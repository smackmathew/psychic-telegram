import type { AccountType, TransactionDirection } from "../types";

const LIABILITY_TYPES: AccountType[] = ["credit_card", "loan"];

export function isLiabilityAccount(type: AccountType): boolean {
  return LIABILITY_TYPES.includes(type);
}

/**
 * Signed change to apply to an account's balance for a transaction.
 *
 * Asset accounts (checking/savings/investment): a credit (money in) increases the balance,
 * a debit (money out) decreases it. Liability accounts (credit_card/loan) track the amount
 * owed: a debit (a charge) increases what's owed, a credit (a payment) decreases it.
 */
export function transactionDelta(type: AccountType, amount: number, direction: TransactionDirection): number {
  if (isLiabilityAccount(type)) {
    return direction === "debit" ? amount : -amount;
  }
  return direction === "credit" ? amount : -amount;
}
