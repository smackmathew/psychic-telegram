from datetime import date

import pytest
from freezegun import freeze_time


@pytest.fixture(autouse=True)
def frozen_today():
    with freeze_time(date(2026, 3, 15)):
        yield


@pytest.fixture
def summary(api):
    checking = api.create_account(name="Checking", type="checking", current_balance=2_000)
    card = api.create_account(name="Card", type="credit_card", current_balance=0)
    groceries = api.category_id("Groceries")
    dining = api.category_id("Dining Out")

    api.create_transaction(checking["id"], amount=500, date="2026-01-10", name="January spend")
    api.create_transaction(checking["id"], amount=3_000, date="2026-03-01", name="Paycheck", direction="credit")
    api.create_transaction(checking["id"], amount=200, date="2026-03-05", name="Groceries", category_id=groceries)
    api.create_transaction(card["id"], amount=100, date="2026-03-06", name="Dinner", category_id=dining)
    api.create_transaction(card["id"], amount=30, date="2026-03-07", name="Refund", direction="credit")
    api.create_transaction(checking["id"], amount=40, date="2026-03-08", name="Uncategorized")

    response = api.get("/dashboard/summary")
    assert response.status_code == 200
    return response.json()


def test_balances_and_net_worth(summary):
    # Checking: 2,000 - 500 + 3,000 - 200 - 40; card owes 100 - 30.
    assert summary["total_assets"] == 4_260
    assert summary["total_liabilities"] == 70
    assert summary["net_worth"] == 4_190


def test_month_cash_flow(summary):
    # A credit on a credit card (the refund) is not income.
    assert summary["month_income"] == 3_000
    assert summary["month_expenses"] == 340


def test_spending_by_category_is_sorted_and_skips_uncategorized(summary):
    assert summary["spending_by_category"] == [
        {"category_name": "Groceries", "amount": 200},
        {"category_name": "Dining Out", "amount": 100},
    ]


def test_net_worth_trend_rewinds_transactions(summary):
    trend = summary["net_worth_trend"]
    assert [p["label"] for p in trend] == ["Oct 2025", "Nov 2025", "Dec 2025", "Jan 2026", "Feb 2026", "Mar 2026"]
    assert [p["net_worth"] for p in trend] == [2_000, 2_000, 2_000, 1_500, 1_500, 4_190]
    assert trend[-1]["assets"] == summary["total_assets"]
    assert trend[-1]["liabilities"] == summary["total_liabilities"]


def test_empty_household(api):
    summary = api.get("/dashboard/summary").json()
    assert summary["net_worth"] == 0
    assert summary["spending_by_category"] == []
    assert len(summary["net_worth_trend"]) == 6
    assert summary["unread_notifications"] == 0
