import pytest

from app.services.borrowing_capacity import DISCLAIMER, _amortized_principal, compute_borrowing_capacity


def _compute(**overrides):
    params = dict(
        annual_gross_income=120_000,
        monthly_debt_payments=500,
        cash_reserves=50_000,
        best_credit_score=750,
        interest_rate_pct=6.5,
        term_years=30,
        down_payment_pct=20,
    )
    params.update(overrides)
    return compute_borrowing_capacity(**params)


class TestAmortizedPrincipal:
    def test_matches_standard_amortization_table(self):
        # $1,000/month at 6% over 30 years supports a ~$166,791.61 loan.
        assert _amortized_principal(1000, 6, 30) == pytest.approx(166_791.61, abs=0.01)

    def test_zero_rate_is_simple_multiplication(self):
        assert _amortized_principal(1000, 0, 30) == 360_000

    def test_non_positive_payment_supports_no_loan(self):
        assert _amortized_principal(0, 6, 30) == 0
        assert _amortized_principal(-50, 6, 30) == 0


class TestComputeBorrowingCapacity:
    def test_front_end_ratio_binds_when_debt_is_low(self):
        result = _compute(interest_rate_pct=0)
        assert result["monthly_gross_income"] == 10_000
        assert result["current_dti_pct"] == 5.0
        # min(28% of income = 2,800, 36% of income - debts = 3,100)
        assert result["max_monthly_housing_payment"] == 2_800
        assert result["max_loan_principal"] == 2_800 * 360
        assert result["estimated_max_home_price"] == pytest.approx(2_800 * 360 / 0.8)
        assert result["required_down_payment"] == pytest.approx(2_800 * 360 / 0.8 * 0.2)
        assert result["down_payment_shortfall"] == pytest.approx(2_800 * 360 / 0.8 * 0.2 - 50_000)

    def test_back_end_ratio_binds_when_debt_is_high(self):
        result = _compute(monthly_debt_payments=1_500)
        # 36% of 10,000 - 1,500 = 2,100 < 2,800
        assert result["max_monthly_housing_payment"] == 2_100

    def test_debts_above_back_end_limit_leave_no_housing_room(self):
        result = _compute(monthly_debt_payments=5_000)
        assert result["max_monthly_housing_payment"] == 0
        assert result["max_loan_principal"] == 0
        assert result["estimated_max_home_price"] == 0

    def test_no_shortfall_when_reserves_cover_down_payment(self):
        result = _compute(cash_reserves=10_000_000)
        assert result["down_payment_shortfall"] == 0

    def test_down_payment_pct_is_clamped(self):
        # Anything >= 100% is clamped to 99% rather than dividing by zero.
        result = _compute(down_payment_pct=150)
        assert result["estimated_max_home_price"] == pytest.approx(result["max_loan_principal"] / 0.01, rel=1e-6)

    def test_zero_income(self):
        result = _compute(annual_gross_income=0)
        assert result["monthly_gross_income"] == 0
        assert result["current_dti_pct"] == 0
        assert result["max_monthly_housing_payment"] == 0
        assert "annual gross income" in result["mortgage_readiness"]
        assert result["business_loan_readiness"].startswith("Add income")

    def test_missing_credit_score(self):
        result = _compute(best_credit_score=None)
        assert result["mortgage_readiness"].startswith("Add a credit score")
        assert result["business_loan_readiness"].startswith("Add income and a credit score")
        assert result["real_estate_investment_readiness"].startswith("Add income and a credit score")
        assert result["notes"] == [DISCLAIMER]

    @pytest.mark.parametrize(
        "score, debt, expected_prefix",
        [
            (760, 500, "Strong"),
            (760, 4_000, "Good"),  # DTI 40%: too high for "Strong", fine for "Good"
            (700, 500, "Good"),
            (640, 500, "Workable"),
            (600, 500, "Below"),
        ],
    )
    def test_mortgage_readiness_tiers(self, score, debt, expected_prefix):
        result = _compute(best_credit_score=score, monthly_debt_payments=debt)
        assert result["mortgage_readiness"].startswith(expected_prefix)

    @pytest.mark.parametrize("score, expected_prefix", [(700, "Good"), (660, "Borderline"), (600, "Below")])
    def test_business_loan_readiness_tiers(self, score, expected_prefix):
        assert _compute(best_credit_score=score)["business_loan_readiness"].startswith(expected_prefix)

    @pytest.mark.parametrize("score, expected_prefix", [(720, "Good"), (670, "Workable"), (600, "Investment-property")])
    def test_real_estate_readiness_tiers(self, score, expected_prefix):
        assert _compute(best_credit_score=score)["real_estate_investment_readiness"].startswith(expected_prefix)

    def test_notes_include_purchase_ranges_from_reserves(self):
        notes = _compute(cash_reserves=50_000)["notes"]
        assert notes[0] == DISCLAIMER
        # SBA 7(a): 10-20% down; investment property: 20-25% down.
        assert "$250,000-$500,000" in notes[1]
        assert "$200,000-$250,000" in notes[2]
