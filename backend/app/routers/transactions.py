from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app import models, schemas
from app.database import get_db
from app.deps import get_current_household_id
from app.services.finance_utils import transaction_delta

router = APIRouter(prefix="/transactions", tags=["transactions"])


def _base_query(db: Session, household_id: str):
    return (
        db.query(models.Transaction)
        .join(models.Account)
        .filter(models.Account.household_id == household_id)
    )


@router.get("", response_model=list[schemas.TransactionOut])
def list_transactions(
    account_id: str | None = None,
    category_id: str | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
    search: str | None = None,
    limit: int = 200,
    offset: int = 0,
    db: Session = Depends(get_db),
    household_id: str = Depends(get_current_household_id),
):
    query = _base_query(db, household_id)
    if account_id:
        query = query.filter(models.Transaction.account_id == account_id)
    if category_id:
        query = query.filter(models.Transaction.category_id == category_id)
    if start_date:
        query = query.filter(models.Transaction.date >= start_date)
    if end_date:
        query = query.filter(models.Transaction.date <= end_date)
    if search:
        like = f"%{search}%"
        query = query.filter(models.Transaction.name.ilike(like))
    return (
        query.order_by(models.Transaction.date.desc(), models.Transaction.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )


@router.post("", response_model=schemas.TransactionOut, status_code=status.HTTP_201_CREATED)
def create_transaction(
    payload: schemas.TransactionCreate,
    db: Session = Depends(get_db),
    household_id: str = Depends(get_current_household_id),
):
    account = (
        db.query(models.Account)
        .filter(models.Account.id == payload.account_id, models.Account.household_id == household_id)
        .first()
    )
    if not account:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Account not found")

    txn = models.Transaction(is_manual=True, pending=False, **payload.model_dump())
    db.add(txn)

    delta = transaction_delta(account.type, float(txn.amount), txn.direction)
    account.current_balance = float(account.current_balance) + delta

    db.commit()
    db.refresh(txn)
    return txn


@router.patch("/{transaction_id}", response_model=schemas.TransactionOut)
def update_transaction(
    transaction_id: str,
    payload: schemas.TransactionUpdate,
    db: Session = Depends(get_db),
    household_id: str = Depends(get_current_household_id),
):
    txn = _base_query(db, household_id).filter(models.Transaction.id == transaction_id).first()
    if not txn:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Transaction not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(txn, field, value)
    db.commit()
    db.refresh(txn)
    return txn


@router.delete("/{transaction_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_transaction(
    transaction_id: str,
    db: Session = Depends(get_db),
    household_id: str = Depends(get_current_household_id),
):
    txn = _base_query(db, household_id).filter(models.Transaction.id == transaction_id).first()
    if not txn:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Transaction not found")
    account = txn.account
    delta = transaction_delta(account.type, float(txn.amount), txn.direction)
    account.current_balance = float(account.current_balance) - delta
    db.delete(txn)
    db.commit()
