from app import models, schemas


def score_band(score: int) -> str:
    if score >= 800:
        return "Exceptional"
    if score >= 740:
        return "Very Good"
    if score >= 670:
        return "Good"
    if score >= 580:
        return "Fair"
    return "Poor"


def build_recommendations(profile: models.CreditProfile) -> list[schemas.CreditRecommendation]:
    recs: list[schemas.CreditRecommendation] = []

    if profile.utilization_pct is not None:
        if float(profile.utilization_pct) > 30:
            recs.append(
                schemas.CreditRecommendation(
                    title="Pay down revolving balances",
                    detail=(
                        f"Utilization is {float(profile.utilization_pct):.0f}%. Amounts owed make up ~30% of a "
                        "FICO score, and scores are penalized once utilization crosses ~30%. Paying balances "
                        "before the statement closing date (not just the due date) usually helps fastest."
                    ),
                    priority="high",
                )
            )
        elif float(profile.utilization_pct) > 10:
            recs.append(
                schemas.CreditRecommendation(
                    title="Push utilization under 10%",
                    detail="You're in reasonable shape, but the very best scores typically keep utilization under 10%.",
                    priority="medium",
                )
            )

    if profile.on_time_payment_pct is not None and float(profile.on_time_payment_pct) < 100:
        recs.append(
            schemas.CreditRecommendation(
                title="Set up autopay for at least the minimum due",
                detail=(
                    "Payment history is the single largest factor (~35%) in most credit scores. Even one "
                    "30-day-late payment can cause a significant drop."
                ),
                priority="high",
            )
        )

    if profile.num_derogatory_marks and profile.num_derogatory_marks > 0:
        recs.append(
            schemas.CreditRecommendation(
                title="Resolve derogatory marks",
                detail=(
                    f"{profile.num_derogatory_marks} derogatory mark(s) on file. Paying off collections, "
                    "negotiating a pay-for-delete, or disputing inaccurate items can meaningfully raise your score."
                ),
                priority="high",
            )
        )

    if profile.num_hard_inquiries_12mo and profile.num_hard_inquiries_12mo > 2:
        recs.append(
            schemas.CreditRecommendation(
                title="Slow down on new credit applications",
                detail=(
                    f"{profile.num_hard_inquiries_12mo} hard inquiries in the last 12 months. Each one has a "
                    "small, temporary impact, but several in a short window signal risk to lenders."
                ),
                priority="medium",
            )
        )

    if profile.credit_age_years is not None and float(profile.credit_age_years) < 3:
        recs.append(
            schemas.CreditRecommendation(
                title="Keep your oldest accounts open",
                detail="Average account age is still building. Closing your oldest card can shorten your history and hurt scores.",
                priority="low",
            )
        )

    if profile.num_open_accounts is not None and profile.num_open_accounts < 2:
        recs.append(
            schemas.CreditRecommendation(
                title="Build a healthy credit mix over time",
                detail="Lenders like to see a track record across a couple of account types (e.g. a card plus an installment loan), managed responsibly.",
                priority="low",
            )
        )

    if profile.score < 670:
        recs.append(
            schemas.CreditRecommendation(
                title="Consider a secured card or credit-builder loan",
                detail="If you're rebuilding, a secured card or credit-builder loan reported to all three bureaus is one of the fastest, lowest-risk ways to add positive history.",
                priority="medium",
            )
        )

    if not recs:
        recs.append(
            schemas.CreditRecommendation(
                title="You're in great shape",
                detail="No red flags in what you've entered. Keep utilization low, pay on time, and avoid unnecessary new accounts.",
                priority="low",
            )
        )

    order = {"high": 0, "medium": 1, "low": 2}
    recs.sort(key=lambda r: order[r.priority])
    return recs
