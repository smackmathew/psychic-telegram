from app.models import AccountType, TransactionDirection

LIABILITY_TYPES = {AccountType.credit_card, AccountType.loan}


def is_liability_account(account_type: AccountType) -> bool:
    return account_type in LIABILITY_TYPES


def transaction_delta(account_type: AccountType, amount: float, direction: TransactionDirection) -> float:
    """Signed change to apply to Account.current_balance for a transaction.

    Asset accounts (checking/savings/investment): a credit (money in) increases the
    balance, a debit (money out) decreases it.
    Liability accounts (credit_card/loan) track the amount owed: a debit (a charge/
    new expense) increases what's owed, a credit (a payment) decreases it.
    """
    if is_liability_account(account_type):
        return amount if direction == TransactionDirection.debit else -amount
    return amount if direction == TransactionDirection.credit else -amount
