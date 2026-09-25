import pytest


def test_upsert_profile_keeps_one_profile_and_appends_history(api):
    first = api.put(
        f"/credit/profiles/{api.user_id}",
        json={"score": 700, "bureau": "experian", "utilization_pct": 25, "recorded_date": "2026-01-01"},
    )
    assert first.status_code == 200
    second = api.put(f"/credit/profiles/{api.user_id}", json={"score": 720, "recorded_date": "2026-02-01"}).json()

    assert second["id"] == first.json()["id"]
    assert second["score"] == 720
    assert [p["score"] for p in api.get("/credit/profiles").json()] == [720]

    history = api.get(f"/credit/profiles/{api.user_id}/history").json()
    assert [(h["recorded_date"], h["score"]) for h in history] == [("2026-01-01", 700), ("2026-02-01", 720)]


def test_member_can_update_partners_profile(api, partner_api):
    assert api.put(f"/credit/profiles/{partner_api.user_id}", json={"score": 690}).status_code == 200
    assert partner_api.get("/credit/profiles").json()[0]["score"] == 690


@pytest.mark.parametrize("payload", [{"score": 299}, {"score": 851}, {"score": 700, "utilization_pct": 101}])
def test_profile_validation(api, payload):
    assert api.put(f"/credit/profiles/{api.user_id}", json=payload).status_code == 422


def test_recommendations(api):
    assert api.get(f"/credit/profiles/{api.user_id}/recommendations").status_code == 404

    api.put(f"/credit/profiles/{api.user_id}", json={"score": 650, "utilization_pct": 60})
    body = api.get(f"/credit/profiles/{api.user_id}/recommendations").json()
    assert body["score_band"] == "Fair"
    assert body["recommendations"][0]["title"] == "Pay down revolving balances"


def test_unknown_member_is_404(api):
    assert api.put("/credit/profiles/not-a-user", json={"score": 700}).status_code == 404


class TestBorrowingCapacity:
    @pytest.fixture
    def household(self, api, partner_api):
        api.patch("/household", json={"annual_gross_income": 120_000})
        api.create_account(name="Checking", type="checking", current_balance=30_000)
        api.create_account(name="Savings", type="savings", current_balance=20_000)
        api.create_account(name="Brokerage", type="investment", current_balance=100_000)
        api.create_account(name="Card", type="credit_card", current_balance=2_000, monthly_payment=200)
        api.create_account(name="Car loan", type="loan", current_balance=15_000, monthly_payment=300)
        api.put(f"/credit/profiles/{api.user_id}", json={"score": 690})
        partner_api.put(f"/credit/profiles/{partner_api.user_id}", json={"score": 760})

    def test_uses_household_data(self, api, household):
        result = api.post("/credit/borrowing-capacity", json={}).json()
        assert result["monthly_gross_income"] == 10_000
        assert result["monthly_debt_payments"] == 500  # card + loan minimums
        assert result["cash_reserves"] == 50_000  # checking + savings, not investments
        assert result["current_dti_pct"] == 5.0
        assert result["mortgage_readiness"].startswith("Strong")  # best score in the household (760)

    def test_request_overrides(self, api, household):
        result = api.post(
            "/credit/borrowing-capacity",
            json={"annual_gross_income": 60_000, "extra_monthly_debt": 100, "cash_reserves_override": 1_000},
        ).json()
        assert result["monthly_gross_income"] == 5_000
        assert result["monthly_debt_payments"] == 600
        assert result["cash_reserves"] == 1_000

    def test_without_profiles_or_income(self, api):
        result = api.post("/credit/borrowing-capacity", json={}).json()
        assert result["monthly_gross_income"] == 0
        assert result["mortgage_readiness"].startswith("Add a credit score")


def test_update_household(api):
    updated = api.patch("/household", json={"annual_gross_income": 95_000}).json()
    assert updated["annual_gross_income"] == 95_000
    assert updated["name"] == "Test Household"
