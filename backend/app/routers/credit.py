from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app import models, schemas
from app.database import get_db
from app.deps import get_current_household_id
from app.services.borrowing_capacity import compute_borrowing_capacity
from app.services.credit_advisor import build_recommendations, score_band
from app.services.finance_utils import LIABILITY_TYPES

router = APIRouter(prefix="/credit", tags=["credit"])


def _get_household_user_or_404(db: Session, household_id: str, user_id: str) -> models.User:
    user = (
        db.query(models.User)
        .filter(models.User.id == user_id, models.User.household_id == household_id)
        .first()
    )
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Household member not found")
    return user


@router.get("/profiles", response_model=list[schemas.CreditProfileOut])
def list_profiles(db: Session = Depends(get_db), household_id: str = Depends(get_current_household_id)):
    return (
        db.query(models.CreditProfile)
        .join(models.User)
        .filter(models.User.household_id == household_id)
        .all()
    )


@router.put("/profiles/{user_id}", response_model=schemas.CreditProfileOut)
def upsert_profile(
    user_id: str,
    payload: schemas.CreditProfileUpsert,
    db: Session = Depends(get_db),
    household_id: str = Depends(get_current_household_id),
):
    _get_household_user_or_404(db, household_id, user_id)

    data = payload.model_dump(exclude={"recorded_date"})
    profile = db.query(models.CreditProfile).filter(models.CreditProfile.user_id == user_id).first()
    if profile:
        for field, value in data.items():
            setattr(profile, field, value)
    else:
        profile = models.CreditProfile(user_id=user_id, **data)
        db.add(profile)

    db.add(
        models.CreditScoreHistory(
            user_id=user_id,
            bureau=payload.bureau,
            score=payload.score,
            recorded_date=payload.recorded_date or date.today(),
        )
    )
    db.commit()
    db.refresh(profile)
    return profile


@router.get("/profiles/{user_id}/history", response_model=list[schemas.CreditScoreHistoryOut])
def get_history(
    user_id: str,
    db: Session = Depends(get_db),
    household_id: str = Depends(get_current_household_id),
):
    _get_household_user_or_404(db, household_id, user_id)
    return (
        db.query(models.CreditScoreHistory)
        .filter(models.CreditScoreHistory.user_id == user_id)
        .order_by(models.CreditScoreHistory.recorded_date)
        .all()
    )


@router.get("/profiles/{user_id}/recommendations", response_model=schemas.CreditRecommendationsOut)
def get_recommendations(
    user_id: str,
    db: Session = Depends(get_db),
    household_id: str = Depends(get_current_household_id),
):
    _get_household_user_or_404(db, household_id, user_id)
    profile = db.query(models.CreditProfile).filter(models.CreditProfile.user_id == user_id).first()
    if not profile:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No credit profile on file yet for this person")
    return schemas.CreditRecommendationsOut(
        user_id=user_id,
        score=profile.score,
        score_band=score_band(profile.score),
        recommendations=build_recommendations(profile),
    )


@router.post("/borrowing-capacity", response_model=schemas.BorrowingCapacityOut)
def get_borrowing_capacity(
    payload: schemas.BorrowingCapacityRequest,
    db: Session = Depends(get_db),
    household_id: str = Depends(get_current_household_id),
):
    household = db.get(models.Household, household_id)
    annual_income = payload.annual_gross_income or float(household.annual_gross_income or 0)

    accounts = db.query(models.Account).filter(models.Account.household_id == household_id).all()
    debt_from_accounts = sum(float(a.monthly_payment or 0) for a in accounts if a.type in LIABILITY_TYPES)
    monthly_debt_payments = debt_from_accounts + payload.extra_monthly_debt

    if payload.cash_reserves_override is not None:
        cash_reserves = payload.cash_reserves_override
    else:
        cash_reserves = sum(
            float(a.current_balance) for a in accounts if a.type in (models.AccountType.checking, models.AccountType.savings)
        )

    profiles = db.query(models.CreditProfile).join(models.User).filter(models.User.household_id == household_id).all()
    best_score = max((p.score for p in profiles), default=None)

    result = compute_borrowing_capacity(
        annual_gross_income=annual_income,
        monthly_debt_payments=monthly_debt_payments,
        cash_reserves=cash_reserves,
        best_credit_score=best_score,
        interest_rate_pct=payload.interest_rate_pct,
        term_years=payload.term_years,
        down_payment_pct=payload.down_payment_pct,
    )
    return schemas.BorrowingCapacityOut(**result)
