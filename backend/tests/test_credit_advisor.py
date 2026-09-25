import pytest

from app.models import CreditProfile
from app.services.credit_advisor import build_recommendations, score_band


@pytest.mark.parametrize(
    "score, band",
    [(850, "Exceptional"), (800, "Exceptional"), (799, "Very Good"), (740, "Very Good"), (739, "Good"),
     (670, "Good"), (669, "Fair"), (580, "Fair"), (579, "Poor"), (300, "Poor")],
)
def test_score_band_boundaries(score, band):
    assert score_band(score) == band


def _titles(**fields):
    profile = CreditProfile(score=fields.pop("score", 780), **fields)
    return [rec.title for rec in build_recommendations(profile)]


def test_clean_profile_gets_single_all_clear():
    assert _titles(utilization_pct=5, on_time_payment_pct=100, credit_age_years=10, num_open_accounts=5) == [
        "You're in great shape"
    ]


def test_profile_with_no_factors_entered_gets_all_clear():
    assert _titles() == ["You're in great shape"]


@pytest.mark.parametrize(
    "fields, expected_title",
    [
        ({"utilization_pct": 45}, "Pay down revolving balances"),
        ({"utilization_pct": 20}, "Push utilization under 10%"),
        ({"on_time_payment_pct": 97}, "Set up autopay for at least the minimum due"),
        ({"num_derogatory_marks": 1}, "Resolve derogatory marks"),
        ({"num_hard_inquiries_12mo": 3}, "Slow down on new credit applications"),
        ({"credit_age_years": 1.5}, "Keep your oldest accounts open"),
        ({"num_open_accounts": 1}, "Build a healthy credit mix over time"),
        ({"score": 640}, "Consider a secured card or credit-builder loan"),
    ],
)
def test_each_factor_triggers_its_recommendation(fields, expected_title):
    titles = _titles(**fields)
    assert expected_title in titles
    assert "You're in great shape" not in titles


@pytest.mark.parametrize(
    "fields",
    [
        {"utilization_pct": 10},  # at the threshold, not over it
        {"num_hard_inquiries_12mo": 2},
        {"num_derogatory_marks": 0},
        {"credit_age_years": 3},
        {"num_open_accounts": 2},
        {"score": 670},
    ],
)
def test_thresholds_are_exclusive(fields):
    assert _titles(**fields) == ["You're in great shape"]


def test_recommendations_are_sorted_by_priority():
    profile = CreditProfile(
        score=600, utilization_pct=50, credit_age_years=1, num_hard_inquiries_12mo=5, num_derogatory_marks=2
    )
    priorities = [rec.priority for rec in build_recommendations(profile)]
    assert priorities == sorted(priorities, key={"high": 0, "medium": 1, "low": 2}.__getitem__)
    assert priorities[0] == "high" and priorities[-1] == "low"
