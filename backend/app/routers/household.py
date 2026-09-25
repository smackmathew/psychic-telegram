from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app import models, schemas
from app.database import get_db
from app.deps import get_current_household_id

router = APIRouter(prefix="/household", tags=["household"])


@router.get("", response_model=schemas.HouseholdOut)
def get_household(db: Session = Depends(get_db), household_id: str = Depends(get_current_household_id)):
    return db.get(models.Household, household_id)


@router.patch("", response_model=schemas.HouseholdOut)
def update_household(
    payload: schemas.HouseholdUpdate,
    db: Session = Depends(get_db),
    household_id: str = Depends(get_current_household_id),
):
    household = db.get(models.Household, household_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(household, field, value)
    db.commit()
    db.refresh(household)
    return household


@router.get("/members", response_model=list[schemas.UserOut])
def list_members(db: Session = Depends(get_db), household_id: str = Depends(get_current_household_id)):
    return db.query(models.User).filter(models.User.household_id == household_id).all()
