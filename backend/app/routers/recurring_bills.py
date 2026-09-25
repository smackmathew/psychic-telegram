from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app import models, schemas
from app.database import get_db
from app.deps import get_current_household_id

router = APIRouter(prefix="/recurring-bills", tags=["recurring-bills"])


@router.get("", response_model=list[schemas.RecurringBillOut])
def list_recurring_bills(db: Session = Depends(get_db), household_id: str = Depends(get_current_household_id)):
    return (
        db.query(models.RecurringBill)
        .filter(models.RecurringBill.household_id == household_id)
        .order_by(models.RecurringBill.due_day)
        .all()
    )


@router.post("", response_model=schemas.RecurringBillOut, status_code=status.HTTP_201_CREATED)
def create_recurring_bill(
    payload: schemas.RecurringBillCreate,
    db: Session = Depends(get_db),
    household_id: str = Depends(get_current_household_id),
):
    bill = models.RecurringBill(household_id=household_id, **payload.model_dump())
    db.add(bill)
    db.commit()
    db.refresh(bill)
    return bill


@router.patch("/{bill_id}", response_model=schemas.RecurringBillOut)
def update_recurring_bill(
    bill_id: str,
    payload: schemas.RecurringBillCreate,
    db: Session = Depends(get_db),
    household_id: str = Depends(get_current_household_id),
):
    bill = (
        db.query(models.RecurringBill)
        .filter(models.RecurringBill.id == bill_id, models.RecurringBill.household_id == household_id)
        .first()
    )
    if not bill:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Recurring bill not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(bill, field, value)
    db.commit()
    db.refresh(bill)
    return bill


@router.delete("/{bill_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_recurring_bill(
    bill_id: str,
    db: Session = Depends(get_db),
    household_id: str = Depends(get_current_household_id),
):
    bill = (
        db.query(models.RecurringBill)
        .filter(models.RecurringBill.id == bill_id, models.RecurringBill.household_id == household_id)
        .first()
    )
    if not bill:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Recurring bill not found")
    db.delete(bill)
    db.commit()
