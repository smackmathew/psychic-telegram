"""Every household-scoped route must refuse to read or modify another household's data."""

from datetime import date


def test_accounts_are_scoped_to_household(api, other_api):
    account = api.create_account(name="Mine", current_balance=100)

    assert other_api.get("/accounts").json() == []
    assert other_api.patch(f"/accounts/{account['id']}", json={"name": "Stolen"}).status_code == 404
    assert other_api.delete(f"/accounts/{account['id']}").status_code == 404
    assert api.get("/accounts").json()[0]["name"] == "Mine"


def test_transactions_are_scoped_to_household(api, other_api):
    account = api.create_account()
    txn = api.create_transaction(account["id"], amount=10, date=str(date.today()))

    assert other_api.get("/transactions").json() == []
    assert other_api.get("/transactions", params={"account_id": account["id"]}).json() == []
    assert other_api.patch(f"/transactions/{txn['id']}", json={"notes": "x"}).status_code == 404
    assert other_api.delete(f"/transactions/{txn['id']}").status_code == 404
    # Can't post into someone else's account either.
    response = other_api.post(
        "/transactions",
        json={"account_id": account["id"], "name": "x", "amount": 1, "direction": "debit", "date": str(date.today())},
    )
    assert response.status_code == 404


def test_categories_are_scoped_to_household(api, other_api):
    api.post("/categories", json={"name": "Pets", "type": "expense"})
    assert "Pets" in {c["name"] for c in api.get("/categories").json()}
    assert "Pets" not in {c["name"] for c in other_api.get("/categories").json()}


def test_budgets_goals_and_bills_are_scoped_to_household(api, other_api):
    budget = api.post(
        "/budgets", json={"category_id": api.category_id("Groceries"), "month": str(date.today()), "amount_limit": 500}
    ).json()
    goal = api.post("/goals", json={"name": "Trip", "type": "savings", "target_amount": 1000}).json()
    bill = api.post("/recurring-bills", json={"name": "Rent", "amount": 1500, "due_day": 1}).json()

    assert other_api.get("/budgets").json() == []
    assert other_api.get("/goals").json() == []
    assert other_api.get("/recurring-bills").json() == []

    assert other_api.delete(f"/budgets/{budget['id']}").status_code == 404
    assert other_api.patch(f"/goals/{goal['id']}", json={"current_amount": 1}).status_code == 404
    assert other_api.delete(f"/goals/{goal['id']}").status_code == 404
    assert other_api.patch(f"/recurring-bills/{bill['id']}", json={**bill, "amount": 1}).status_code == 404
    assert other_api.delete(f"/recurring-bills/{bill['id']}").status_code == 404


def test_notifications_are_scoped_to_household(api, other_api):
    api.create_account(name="Big savings", type="savings", current_balance=50_000)
    created = api.post("/notifications/run-checks").json()
    assert created

    assert other_api.get("/notifications").json() == []
    assert other_api.post(f"/notifications/{created[0]['id']}/read").status_code == 404
    other_api.post("/notifications/read-all")
    assert api.get("/notifications", params={"unread_only": True}).json()


def test_credit_profiles_are_scoped_to_household(api, other_api):
    api.put(f"/credit/profiles/{api.user_id}", json={"score": 720})

    assert other_api.get("/credit/profiles").json() == []
    assert other_api.put(f"/credit/profiles/{api.user_id}", json={"score": 300}).status_code == 404
    assert other_api.get(f"/credit/profiles/{api.user_id}/history").status_code == 404
    assert other_api.get(f"/credit/profiles/{api.user_id}/recommendations").status_code == 404
    assert api.get("/credit/profiles").json()[0]["score"] == 720


def test_dashboard_only_counts_own_household(api, other_api):
    api.create_account(current_balance=1_000)
    summary = other_api.get("/dashboard/summary").json()
    assert summary["total_assets"] == 0
    assert summary["net_worth"] == 0
