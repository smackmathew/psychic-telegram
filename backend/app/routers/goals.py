from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app import models, schemas
from app.database import get_db
from app.deps import get_current_household_id

router = APIRouter(prefix="/goals", tags=["goals"])


@router.get("", response_model=list[schemas.GoalOut])
def list_goals(db: Session = Depends(get_db), household_id: str = Depends(get_current_household_id)):
    return db.query(models.Goal).filter(models.Goal.household_id == household_id).order_by(models.Goal.created_at).all()


@router.post("", response_model=schemas.GoalOut, status_code=status.HTTP_201_CREATED)
def create_goal(
    payload: schemas.GoalCreate,
    db: Session = Depends(get_db),
    household_id: str = Depends(get_current_household_id),
):
    goal = models.Goal(household_id=household_id, **payload.model_dump())
    db.add(goal)
    db.commit()
    db.refresh(goal)
    return goal


@router.patch("/{goal_id}", response_model=schemas.GoalOut)
def update_goal(
    goal_id: str,
    payload: schemas.GoalUpdate,
    db: Session = Depends(get_db),
    household_id: str = Depends(get_current_household_id),
):
    goal = db.query(models.Goal).filter(models.Goal.id == goal_id, models.Goal.household_id == household_id).first()
    if not goal:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Goal not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(goal, field, value)
    db.commit()
    db.refresh(goal)
    return goal


@router.delete("/{goal_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_goal(
    goal_id: str,
    db: Session = Depends(get_db),
    household_id: str = Depends(get_current_household_id),
):
    goal = db.query(models.Goal).filter(models.Goal.id == goal_id, models.Goal.household_id == household_id).first()
    if not goal:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Goal not found")
    db.delete(goal)
    db.commit()
