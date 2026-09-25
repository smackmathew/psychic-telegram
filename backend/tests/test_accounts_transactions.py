from datetime import date, timedelta

import pytest

TODAY = str(date.today())


def _balance(api, account_id):
    return next(a for a in api.get("/accounts").json() if a["id"] == account_id)["current_balance"]


def test_account_crud(api):
    account = api.create_account(name="Joint checking", current_balance=1_234.56, institution_name="Bank")
    assert account["is_manual"] is True
    assert account["current_balance"] == 1_234.56

    updated = api.patch(f"/accounts/{account['id']}", json={"name": "Renamed", "monthly_payment": 50})
    assert updated.status_code == 200
    assert updated.json()["name"] == "Renamed"
    assert updated.json()["institution_name"] == "Bank"  # untouched fields are kept

    assert api.delete(f"/accounts/{account['id']}").status_code == 204
    assert api.get("/accounts").json() == []


def test_deleting_account_deletes_its_transactions(api):
    account = api.create_account()
    api.create_transaction(account["id"], amount=5, date=TODAY)
    api.delete(f"/accounts/{account['id']}")
    assert api.get("/transactions").json() == []


@pytest.mark.parametrize(
    "account_type, direction, expected_balance",
    [
        ("checking", "credit", 1_100),
        ("checking", "debit", 900),
        ("credit_card", "debit", 1_100),  # a charge increases what's owed
        ("credit_card", "credit", 900),  # a payment decreases it
        ("loan", "credit", 900),
    ],
)
def test_transactions_adjust_account_balance(api, account_type, direction, expected_balance):
    account = api.create_account(type=account_type, current_balance=1_000)
    txn = api.create_transaction(account["id"], amount=100, direction=direction, date=TODAY)
    assert _balance(api, account["id"]) == expected_balance

    assert api.delete(f"/transactions/{txn['id']}").status_code == 204
    assert _balance(api, account["id"]) == 1_000


def test_transaction_amount_must_be_positive(api):
    account = api.create_account()
    response = api.post(
        "/transactions",
        json={"account_id": account["id"], "name": "Bad", "amount": -5, "direction": "debit", "date": TODAY},
    )
    assert response.status_code == 422


def test_transaction_for_unknown_account_is_rejected(api):
    response = api.post(
        "/transactions",
        json={"account_id": "does-not-exist", "name": "x", "amount": 5, "direction": "debit", "date": TODAY},
    )
    assert response.status_code == 404


def test_update_transaction(api):
    account = api.create_account()
    txn = api.create_transaction(account["id"], amount=20, date=TODAY, name="Coffee")
    groceries = api.category_id("Groceries")

    response = api.patch(f"/transactions/{txn['id']}", json={"category_id": groceries, "notes": "Actually groceries"})
    assert response.status_code == 200
    assert response.json()["category_id"] == groceries
    assert response.json()["name"] == "Coffee"


@pytest.mark.parametrize(
    "account_type, expected_balance",
    [
        ("checking", 850),  # a 100 debit left 900; bumping it to 150 leaves 850
        ("credit_card", 1_150),  # a 100 charge left 1,100 owed; bumping it to 150 leaves 1,150
    ],
)
def test_updating_transaction_amount_adjusts_account_balance(api, account_type, expected_balance):
    account = api.create_account(type=account_type, current_balance=1_000)
    txn = api.create_transaction(account["id"], amount=100, direction="debit", date=TODAY)

    response = api.patch(f"/transactions/{txn['id']}", json={"amount": 150})
    assert response.status_code == 200
    assert response.json()["amount"] == 150
    assert _balance(api, account["id"]) == expected_balance

    # Deleting the edited transaction restores the original balance.
    api.delete(f"/transactions/{txn['id']}")
    assert _balance(api, account["id"]) == 1_000


def test_update_transaction_amount_must_be_positive(api):
    account = api.create_account(current_balance=1_000)
    txn = api.create_transaction(account["id"], amount=100, direction="debit", date=TODAY)
    for amount in (0, -50):
        assert api.patch(f"/transactions/{txn['id']}", json={"amount": amount}).status_code == 422
    assert _balance(api, account["id"]) == 900

def test_list_transactions_filters(api):
    checking = api.create_account(name="Checking")
    card = api.create_account(name="Card", type="credit_card")
    groceries = api.category_id("Groceries")
    old = str(date.today() - timedelta(days=40))

    api.create_transaction(checking["id"], amount=10, date=TODAY, name="Whole Foods", category_id=groceries)
    api.create_transaction(checking["id"], amount=20, date=old, name="Old rent")
    api.create_transaction(card["id"], amount=30, date=TODAY, name="Netflix")

    def names(**params):
        return sorted(t["name"] for t in api.get("/transactions", params=params).json())

    assert names() == ["Netflix", "Old rent", "Whole Foods"]
    assert names(account_id=card["id"]) == ["Netflix"]
    assert names(category_id=groceries) == ["Whole Foods"]
    assert names(start_date=str(date.today() - timedelta(days=7))) == ["Netflix", "Whole Foods"]
    assert names(end_date=old) == ["Old rent"]
    assert names(search="whole") == ["Whole Foods"]  # case-insensitive


def test_list_transactions_is_newest_first_and_paginated(api):
    account = api.create_account()
    for days_ago in range(5):
        api.create_transaction(account["id"], amount=1, date=str(date.today() - timedelta(days=days_ago)), name=f"t{days_ago}")

    all_txns = api.get("/transactions").json()
    assert [t["name"] for t in all_txns] == ["t0", "t1", "t2", "t3", "t4"]

    page = api.get("/transactions", params={"limit": 2, "offset": 2}).json()
    assert [t["name"] for t in page] == ["t2", "t3"]


def test_create_custom_category(api):
    response = api.post("/categories", json={"name": "Pets", "type": "expense", "icon": "paw"})
    assert response.status_code == 201
    assert response.json()["is_default"] is False
