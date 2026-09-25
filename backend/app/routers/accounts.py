from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app import models, schemas
from app.database import get_db
from app.deps import get_current_household_id

router = APIRouter(prefix="/accounts", tags=["accounts"])


def _get_account_or_404(db: Session, household_id: str, account_id: str) -> models.Account:
    account = (
        db.query(models.Account)
        .filter(models.Account.id == account_id, models.Account.household_id == household_id)
        .first()
    )
    if not account:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Account not found")
    return account


@router.get("", response_model=list[schemas.AccountOut])
def list_accounts(db: Session = Depends(get_db), household_id: str = Depends(get_current_household_id)):
    return db.query(models.Account).filter(models.Account.household_id == household_id).order_by(models.Account.created_at).all()


@router.post("", response_model=schemas.AccountOut, status_code=status.HTTP_201_CREATED)
def create_account(
    payload: schemas.AccountCreate,
    db: Session = Depends(get_db),
    household_id: str = Depends(get_current_household_id),
):
    account = models.Account(household_id=household_id, is_manual=True, **payload.model_dump())
    db.add(account)
    db.commit()
    db.refresh(account)
    return account


@router.patch("/{account_id}", response_model=schemas.AccountOut)
def update_account(
    account_id: str,
    payload: schemas.AccountUpdate,
    db: Session = Depends(get_db),
    household_id: str = Depends(get_current_household_id),
):
    account = _get_account_or_404(db, household_id, account_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(account, field, value)
    db.commit()
    db.refresh(account)
    return account


@router.delete("/{account_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_account(
    account_id: str,
    db: Session = Depends(get_db),
    household_id: str = Depends(get_current_household_id),
):
    account = _get_account_or_404(db, household_id, account_id)
    db.delete(account)
    db.commit()
