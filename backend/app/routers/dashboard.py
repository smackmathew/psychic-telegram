from datetime import date, timedelta

from dateutil.relativedelta import relativedelta
from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app import models, schemas
from app.database import get_db
from app.deps import get_current_household_id
from app.services.finance_utils import is_liability_account, transaction_delta

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


def _trend_points(accounts: list[models.Account]) -> list[schemas.NetWorthPoint]:
    today = date.today()
    cutoffs: list[tuple[str, date]] = []
    for i in range(5, -1, -1):
        month_start = today.replace(day=1) - relativedelta(months=i)
        if i == 0:
            as_of = today
        else:
            as_of = month_start + relativedelta(months=1) - timedelta(days=1)
        cutoffs.append((month_start.strftime("%b %Y"), as_of))

    points = []
    for label, cutoff in cutoffs:
        assets = 0.0
        liabilities = 0.0
        for account in accounts:
            removed = sum(
                transaction_delta(account.type, float(t.amount), t.direction)
                for t in account.transactions
                if t.date > cutoff
            )
            balance_as_of = float(account.current_balance) - removed
            if is_liability_account(account.type):
                liabilities += balance_as_of
            else:
                assets += balance_as_of
        points.append(schemas.NetWorthPoint(label=label, assets=round(assets, 2), liabilities=round(liabilities, 2), net_worth=round(assets - liabilities, 2)))
    return points


@router.get("/summary", response_model=schemas.DashboardSummary)
def get_summary(db: Session = Depends(get_db), household_id: str = Depends(get_current_household_id)):
    accounts = (
        db.query(models.Account)
        .options(joinedload(models.Account.transactions))
        .filter(models.Account.household_id == household_id)
        .all()
    )

    total_assets = sum(float(a.current_balance) for a in accounts if not is_liability_account(a.type))
    total_liabilities = sum(float(a.current_balance) for a in accounts if is_liability_account(a.type))

    month_start = date.today().replace(day=1)

    month_income = (
        db.query(func.coalesce(func.sum(models.Transaction.amount), 0))
        .join(models.Account)
        .filter(
            models.Account.household_id == household_id,
            models.Account.type.notin_([models.AccountType.credit_card, models.AccountType.loan]),
            models.Transaction.direction == models.TransactionDirection.credit,
            models.Transaction.date >= month_start,
        )
        .scalar()
    )
    month_expenses = (
        db.query(func.coalesce(func.sum(models.Transaction.amount), 0))
        .join(models.Account)
        .filter(
            models.Account.household_id == household_id,
            models.Transaction.direction == models.TransactionDirection.debit,
            models.Transaction.date >= month_start,
        )
        .scalar()
    )

    spending_rows = (
        db.query(models.Category.name, func.coalesce(func.sum(models.Transaction.amount), 0))
        .join(models.Transaction, models.Transaction.category_id == models.Category.id)
        .join(models.Account, models.Account.id == models.Transaction.account_id)
        .filter(
            models.Account.household_id == household_id,
            models.Transaction.direction == models.TransactionDirection.debit,
            models.Transaction.date >= month_start,
        )
        .group_by(models.Category.name)
        .order_by(func.sum(models.Transaction.amount).desc())
        .all()
    )

    unread_count = (
        db.query(func.count(models.Notification.id))
        .filter(models.Notification.household_id == household_id, models.Notification.is_read.is_(False))
        .scalar()
    )

    return schemas.DashboardSummary(
        total_assets=round(total_assets, 2),
        total_liabilities=round(total_liabilities, 2),
        net_worth=round(total_assets - total_liabilities, 2),
        month_income=round(float(month_income or 0), 2),
        month_expenses=round(float(month_expenses or 0), 2),
        spending_by_category=[schemas.SpendingByCategory(category_name=name, amount=round(float(amt), 2)) for name, amt in spending_rows],
        net_worth_trend=_trend_points(accounts),
        unread_notifications=int(unread_count or 0),
    )
