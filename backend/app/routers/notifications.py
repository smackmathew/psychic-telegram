from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app import models, schemas
from app.database import get_db
from app.deps import get_current_household_id
from app.services.notification_rules import run_all_checks

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("", response_model=list[schemas.NotificationOut])
def list_notifications(
    unread_only: bool = False,
    limit: int = 50,
    db: Session = Depends(get_db),
    household_id: str = Depends(get_current_household_id),
):
    query = db.query(models.Notification).filter(models.Notification.household_id == household_id)
    if unread_only:
        query = query.filter(models.Notification.is_read.is_(False))
    return query.order_by(models.Notification.created_at.desc()).limit(limit).all()


@router.post("/{notification_id}/read", response_model=schemas.NotificationOut)
def mark_read(
    notification_id: str,
    db: Session = Depends(get_db),
    household_id: str = Depends(get_current_household_id),
):
    notification = (
        db.query(models.Notification)
        .filter(models.Notification.id == notification_id, models.Notification.household_id == household_id)
        .first()
    )
    if not notification:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Notification not found")
    notification.is_read = True
    db.commit()
    db.refresh(notification)
    return notification


@router.post("/read-all", status_code=status.HTTP_204_NO_CONTENT)
def mark_all_read(db: Session = Depends(get_db), household_id: str = Depends(get_current_household_id)):
    db.query(models.Notification).filter(
        models.Notification.household_id == household_id, models.Notification.is_read.is_(False)
    ).update({"is_read": True})
    db.commit()


@router.post("/run-checks", response_model=list[schemas.NotificationOut])
def run_checks_now(db: Session = Depends(get_db), household_id: str = Depends(get_current_household_id)):
    """Manually trigger the rule engine for this household (also runs on a schedule)."""
    created = run_all_checks(db, household_id)
    return created
