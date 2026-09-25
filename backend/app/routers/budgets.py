from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app import models, schemas
from app.database import get_db
from app.deps import get_current_household_id

router = APIRouter(prefix="/budgets", tags=["budgets"])


def _month_bounds(month: date) -> tuple[date, date]:
    start = month.replace(day=1)
    if start.month == 12:
        end = start.replace(year=start.year + 1, month=1)
    else:
        end = start.replace(month=start.month + 1)
    return start, end


@router.get("", response_model=list[schemas.BudgetProgress])
def list_budgets(
    month: date | None = None,
    db: Session = Depends(get_db),
    household_id: str = Depends(get_current_household_id),
):
    target_month = (month or date.today()).replace(day=1)
    budgets = (
        db.query(models.Budget)
        .filter(models.Budget.household_id == household_id, models.Budget.month == target_month)
        .all()
    )
    start, end = _month_bounds(target_month)
    results = []
    for budget in budgets:
        spent = (
            db.query(func.coalesce(func.sum(models.Transaction.amount), 0))
            .join(models.Account)
            .filter(
                models.Account.household_id == household_id,
                models.Transaction.category_id == budget.category_id,
                models.Transaction.direction == models.TransactionDirection.debit,
                models.Transaction.date >= start,
                models.Transaction.date < end,
            )
            .scalar()
        )
        spent = float(spent or 0)
        limit = float(budget.amount_limit)
        results.append(
            schemas.BudgetProgress(
                budget=budget,
                spent=spent,
                remaining=max(limit - spent, 0),
                pct_used=round((spent / limit) * 100, 1) if limit else 0,
            )
        )
    return results


@router.post("", response_model=schemas.BudgetOut, status_code=status.HTTP_201_CREATED)
def create_budget(
    payload: schemas.BudgetCreate,
    db: Session = Depends(get_db),
    household_id: str = Depends(get_current_household_id),
):
    data = payload.model_dump()
    data["month"] = data["month"].replace(day=1)
    existing = (
        db.query(models.Budget)
        .filter(
            models.Budget.household_id == household_id,
            models.Budget.category_id == data["category_id"],
            models.Budget.month == data["month"],
        )
        .first()
    )
    if existing:
        existing.amount_limit = data["amount_limit"]
        db.commit()
        db.refresh(existing)
        return existing

    budget = models.Budget(household_id=household_id, **data)
    db.add(budget)
    db.commit()
    db.refresh(budget)
    return budget


@router.delete("/{budget_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_budget(
    budget_id: str,
    db: Session = Depends(get_db),
    household_id: str = Depends(get_current_household_id),
):
    budget = (
        db.query(models.Budget)
        .filter(models.Budget.id == budget_id, models.Budget.household_id == household_id)
        .first()
    )
    if not budget:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Budget not found")
    db.delete(budget)
    db.commit()
