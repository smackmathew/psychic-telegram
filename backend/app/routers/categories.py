from fastapi import APIRouter, Depends, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app import models, schemas
from app.database import get_db
from app.deps import get_current_household_id

router = APIRouter(prefix="/categories", tags=["categories"])


@router.get("", response_model=list[schemas.CategoryOut])
def list_categories(db: Session = Depends(get_db), household_id: str = Depends(get_current_household_id)):
    return (
        db.query(models.Category)
        .filter(or_(models.Category.household_id == household_id, models.Category.household_id.is_(None)))
        .order_by(models.Category.type, models.Category.name)
        .all()
    )


@router.post("", response_model=schemas.CategoryOut, status_code=status.HTTP_201_CREATED)
def create_category(
    payload: schemas.CategoryCreate,
    db: Session = Depends(get_db),
    household_id: str = Depends(get_current_household_id),
):
    category = models.Category(household_id=household_id, **payload.model_dump())
    db.add(category)
    db.commit()
    db.refresh(category)
    return category
