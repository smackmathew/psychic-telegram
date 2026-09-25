from datetime import date, timedelta

import pytest
from freezegun import freeze_time

TODAY = date(2026, 3, 10)


@pytest.fixture(autouse=True)
def frozen_today():
    with freeze_time(TODAY):
        yield


def run_checks(api) -> list[dict]:
    response = api.post("/notifications/run-checks")
    assert response.status_code == 200, response.text
    return response.json()


def titles(notifications) -> list[str]:
    return sorted(n["title"] for n in notifications)


class TestBudgetOverages:
    def _setup(self, api, limit=100):
        groceries = api.category_id("Groceries")
        account = api.create_account()
        api.post("/budgets", json={"category_id": groceries, "month": str(TODAY), "amount_limit": limit})
        return account, groceries

    def test_under_warning_threshold_is_quiet(self, api):
        account, groceries = self._setup(api)
        api.create_transaction(account["id"], amount=80, date=str(TODAY), category_id=groceries)
        assert run_checks(api) == []

    def test_warning_then_exceeded_each_fire_once(self, api):
        account, groceries = self._setup(api)
        api.create_transaction(account["id"], amount=95, date=str(TODAY), category_id=groceries)

        [warning] = run_checks(api)
        assert warning["title"] == "Approaching budget limit: Groceries"
        assert warning["severity"] == "info"
        assert run_checks(api) == []

        api.create_transaction(account["id"], amount=10, date=str(TODAY), category_id=groceries)
        [exceeded] = run_checks(api)
        assert exceeded["title"] == "Budget exceeded: Groceries"
        assert exceeded["severity"] == "warning"
        assert exceeded["related_entity_type"] == "budget"
        assert run_checks(api) == []

    def test_last_months_spending_is_ignored(self, api):
        account, groceries = self._setup(api)
        api.create_transaction(account["id"], amount=500, date=str(TODAY.replace(day=1) - timedelta(days=1)), category_id=groceries)
        assert run_checks(api) == []


class TestGoalMilestones:
    def test_only_highest_new_milestone_is_announced(self, api):
        goal = api.post("/goals", json={"name": "House", "type": "savings", "target_amount": 1000, "current_amount": 600}).json()

        [note] = run_checks(api)
        assert note["title"] == "50% of the way to House"
        assert note["related_entity_id"] == goal["id"]
        assert run_checks(api) == []

        api.patch(f"/goals/{goal['id']}", json={"current_amount": 1000})
        [done] = run_checks(api)
        assert done["title"] == "Goal complete: House!"
        assert done["severity"] == "success"
        assert run_checks(api) == []

    def test_below_first_milestone_is_quiet(self, api):
        api.post("/goals", json={"name": "Car", "type": "savings", "target_amount": 1000, "current_amount": 200})
        assert run_checks(api) == []


class TestUpcomingBills:
    def test_bill_within_lead_days_is_announced_once(self, api):
        api.post("/recurring-bills", json={"name": "Internet", "amount": 80, "due_day": 12})
        [note] = run_checks(api)
        assert note["title"] == "Internet due in 2 days"
        assert note["severity"] == "info"
        assert run_checks(api) == []

    def test_bill_due_today_is_a_warning(self, api):
        api.post("/recurring-bills", json={"name": "Rent", "amount": 2000, "due_day": 10})
        [note] = run_checks(api)
        assert note["title"] == "Rent due today"
        assert note["severity"] == "warning"

    def test_bill_outside_lead_days_is_quiet(self, api):
        api.post("/recurring-bills", json={"name": "Gym", "amount": 40, "due_day": 20})
        api.post("/recurring-bills", json={"name": "Water", "amount": 40, "due_day": 9})  # just passed
        assert run_checks(api) == []

    def test_inactive_bill_is_quiet(self, api):
        api.post("/recurring-bills", json={"name": "Old gym", "amount": 40, "due_day": 11, "is_active": False})
        assert run_checks(api) == []

    def test_bill_already_paid_is_quiet(self, api):
        account = api.create_account()
        api.post("/recurring-bills", json={"name": "Internet", "amount": 80, "due_day": 12})
        api.create_transaction(account["id"], amount=85, date=str(TODAY - timedelta(days=3)), name="ISP")  # within 15%
        assert run_checks(api) == []

    def test_payment_outside_tolerance_or_category_does_not_count(self, api):
        account = api.create_account()
        utilities = api.category_id("Utilities")
        api.post("/recurring-bills", json={"name": "Power", "amount": 100, "due_day": 12, "category_id": utilities})
        api.create_transaction(account["id"], amount=150, date=str(TODAY), category_id=utilities)  # >15% off
        api.create_transaction(account["id"], amount=100, date=str(TODAY), category_id=api.category_id("Shopping"))
        assert titles(run_checks(api)) == ["Power due in 2 days"]

    @freeze_time(date(2026, 3, 30))
    def test_due_date_rolls_into_next_month(self, api):
        api.post("/recurring-bills", json={"name": "Rent", "amount": 2000, "due_day": 1})
        [note] = run_checks(api)
        assert note["title"] == "Rent due in 2 days"
        assert "Apr 01" in note["message"]


class TestLargeTransactions:
    def test_recent_large_debits_only(self, api):
        account = api.create_account()
        big = api.create_transaction(account["id"], amount=600, date=str(TODAY), name="TV")
        api.create_transaction(account["id"], amount=600, date=str(TODAY - timedelta(days=5)), name="Old")
        api.create_transaction(account["id"], amount=600, date=str(TODAY), name="Paycheck", direction="credit")
        api.create_transaction(account["id"], amount=400, date=str(TODAY), name="Small")

        [note] = run_checks(api)
        assert note["title"] == "Large transaction: $600.00"
        assert note["related_entity_id"] == big["id"]
        assert run_checks(api) == []


class TestIdleCash:
    def test_only_savings_above_threshold(self, api):
        savings = api.create_account(name="HYSA", type="savings", current_balance=15_000)
        api.create_account(name="Checking", type="checking", current_balance=15_000)
        api.create_account(name="Small savings", type="savings", current_balance=5_000)

        [note] = run_checks(api)
        assert note["title"] == "Idle cash in HYSA"
        assert note["related_entity_id"] == savings["id"]
        assert run_checks(api) == []

    def test_fires_again_next_month(self, api):
        api.create_account(name="HYSA", type="savings", current_balance=15_000)
        assert len(run_checks(api)) == 1
        with freeze_time(date(2026, 4, 10)):
            assert len(run_checks(api)) == 1


class TestCreditAlerts:
    def test_high_utilization(self, api):
        api.put(f"/credit/profiles/{api.user_id}", json={"score": 720, "utilization_pct": 45})
        assert titles(run_checks(api)) == ["High credit utilization for Alex"]
        assert run_checks(api) == []

    def test_score_drop_of_15_or_more(self, api, partner_api):
        api.put(f"/credit/profiles/{api.user_id}", json={"score": 760, "recorded_date": "2026-02-01"})
        api.put(f"/credit/profiles/{api.user_id}", json={"score": 745, "recorded_date": "2026-03-01"})
        partner_api.put(f"/credit/profiles/{partner_api.user_id}", json={"score": 760, "recorded_date": "2026-02-01"})
        partner_api.put(f"/credit/profiles/{partner_api.user_id}", json={"score": 750, "recorded_date": "2026-03-01"})

        [note] = run_checks(api)
        assert note["title"] == "Credit score drop for Alex"
        assert "from 760 to 745" in note["message"]


def test_notification_read_flow(api):
    api.create_account(name="HYSA", type="savings", current_balance=15_000)
    api.post("/goals", json={"name": "Trip", "type": "savings", "target_amount": 100, "current_amount": 100})
    first, second = run_checks(api)

    assert api.get("/dashboard/summary").json()["unread_notifications"] == 2
    read = api.post(f"/notifications/{first['id']}/read").json()
    assert read["is_read"] is True
    assert [n["id"] for n in api.get("/notifications", params={"unread_only": True}).json()] == [second["id"]]

    assert api.post("/notifications/read-all").status_code == 204
    assert api.get("/notifications", params={"unread_only": True}).json() == []
    assert len(api.get("/notifications").json()) == 2
