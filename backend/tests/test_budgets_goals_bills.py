from datetime import date, timedelta

from dateutil.relativedelta import relativedelta

TODAY = date.today()
MONTH_START = TODAY.replace(day=1)


def test_budget_progress_counts_only_this_months_debits_in_category(api):
    groceries = api.category_id("Groceries")
    dining = api.category_id("Dining Out")
    account = api.create_account()

    api.post("/budgets", json={"category_id": groceries, "month": str(TODAY), "amount_limit": 400})
    api.create_transaction(account["id"], amount=150, date=str(MONTH_START), category_id=groceries)
    api.create_transaction(account["id"], amount=50, date=str(MONTH_START), category_id=groceries)
    # None of these should count:
    api.create_transaction(account["id"], amount=999, date=str(MONTH_START - timedelta(days=1)), category_id=groceries)
    api.create_transaction(account["id"], amount=999, date=str(MONTH_START), category_id=dining)
    api.create_transaction(account["id"], amount=999, date=str(MONTH_START), category_id=groceries, direction="credit")

    [progress] = api.get("/budgets").json()
    assert progress["budget"]["category"]["name"] == "Groceries"
    assert progress["spent"] == 200
    assert progress["remaining"] == 200
    assert progress["pct_used"] == 50.0


def test_budget_remaining_never_goes_negative(api):
    groceries = api.category_id("Groceries")
    account = api.create_account()
    api.post("/budgets", json={"category_id": groceries, "month": str(TODAY), "amount_limit": 100})
    api.create_transaction(account["id"], amount=150, date=str(MONTH_START), category_id=groceries)

    [progress] = api.get("/budgets").json()
    assert progress["remaining"] == 0
    assert progress["pct_used"] == 150.0


def test_budget_month_is_normalized_and_upserted(api):
    groceries = api.category_id("Groceries")
    mid_month = MONTH_START.replace(day=15)

    first = api.post("/budgets", json={"category_id": groceries, "month": str(mid_month), "amount_limit": 300}).json()
    assert first["month"] == str(MONTH_START)

    # Posting the same category/month again updates the limit instead of creating a duplicate.
    second = api.post("/budgets", json={"category_id": groceries, "month": str(MONTH_START), "amount_limit": 350})
    assert second.json()["id"] == first["id"]
    assert [b["budget"]["amount_limit"] for b in api.get("/budgets").json()] == [350]


def test_budgets_are_listed_per_month(api):
    groceries = api.category_id("Groceries")
    next_month = MONTH_START + relativedelta(months=1)
    api.post("/budgets", json={"category_id": groceries, "month": str(next_month), "amount_limit": 300})

    assert api.get("/budgets").json() == []
    assert len(api.get("/budgets", params={"month": str(next_month)}).json()) == 1


def test_delete_budget(api):
    budget = api.post(
        "/budgets", json={"category_id": api.category_id("Groceries"), "month": str(TODAY), "amount_limit": 1}
    ).json()
    assert api.delete(f"/budgets/{budget['id']}").status_code == 204
    assert api.get("/budgets").json() == []
    assert api.delete(f"/budgets/{budget['id']}").status_code == 404


def test_goal_crud(api):
    goal = api.post("/goals", json={"name": "Emergency fund", "type": "savings", "target_amount": 10_000}).json()
    assert goal["current_amount"] == 0

    updated = api.patch(f"/goals/{goal['id']}", json={"current_amount": 2_500}).json()
    assert updated["current_amount"] == 2_500
    assert updated["target_amount"] == 10_000

    assert api.delete(f"/goals/{goal['id']}").status_code == 204
    assert api.get("/goals").json() == []


def test_goal_target_must_be_positive(api):
    assert api.post("/goals", json={"name": "x", "type": "savings", "target_amount": 0}).status_code == 422


def test_recurring_bills_sorted_by_due_day(api):
    api.post("/recurring-bills", json={"name": "Internet", "amount": 80, "due_day": 20})
    api.post("/recurring-bills", json={"name": "Rent", "amount": 2000, "due_day": 1})
    assert [b["name"] for b in api.get("/recurring-bills").json()] == ["Rent", "Internet"]


def test_recurring_bill_due_day_is_validated(api):
    assert api.post("/recurring-bills", json={"name": "x", "amount": 1, "due_day": 29}).status_code == 422
    assert api.post("/recurring-bills", json={"name": "x", "amount": 1, "due_day": 0}).status_code == 422


def test_update_and_delete_recurring_bill(api):
    bill = api.post("/recurring-bills", json={"name": "Gym", "amount": 40, "due_day": 5}).json()
    updated = api.patch(f"/recurring-bills/{bill['id']}", json={**bill, "is_active": False}).json()
    assert updated["is_active"] is False
    assert api.delete(f"/recurring-bills/{bill['id']}").status_code == 204
    assert api.get("/recurring-bills").json() == []
