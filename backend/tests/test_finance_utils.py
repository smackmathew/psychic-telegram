import pytest

from app.models import AccountType, TransactionDirection
from app.services.finance_utils import is_liability_account, transaction_delta


@pytest.mark.parametrize(
    "account_type, expected",
    [
        (AccountType.credit_card, True),
        (AccountType.loan, True),
        (AccountType.checking, False),
        (AccountType.savings, False),
        (AccountType.investment, False),
        (AccountType.other, False),
    ],
)
def test_is_liability_account(account_type, expected):
    assert is_liability_account(account_type) is expected


@pytest.mark.parametrize(
    "account_type, direction, expected",
    [
        # Asset accounts: money in raises the balance, money out lowers it.
        (AccountType.checking, TransactionDirection.credit, 100),
        (AccountType.checking, TransactionDirection.debit, -100),
        (AccountType.savings, TransactionDirection.credit, 100),
        (AccountType.investment, TransactionDirection.debit, -100),
        # Liability accounts track the amount owed: a charge raises it, a payment lowers it.
        (AccountType.credit_card, TransactionDirection.debit, 100),
        (AccountType.credit_card, TransactionDirection.credit, -100),
        (AccountType.loan, TransactionDirection.credit, -100),
    ],
)
def test_transaction_delta(account_type, direction, expected):
    assert transaction_delta(account_type, 100, direction) == expected
