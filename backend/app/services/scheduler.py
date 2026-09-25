import logging

from apscheduler.schedulers.background import BackgroundScheduler

from app import models
from app.config import get_settings
from app.database import SessionLocal
from app.services.notification_rules import run_all_checks
from app.services.plaid_client import sync_household_plaid_items

logger = logging.getLogger(__name__)
settings = get_settings()
scheduler = BackgroundScheduler()


def run_household_sync_and_checks() -> None:
    db = SessionLocal()
    try:
        household_ids = [row[0] for row in db.query(models.Household.id).all()]
        for household_id in household_ids:
            try:
                if settings.plaid_enabled:
                    sync_household_plaid_items(db, household_id)
                run_all_checks(db, household_id)
            except Exception:
                logger.exception("Sync/notification check failed for household %s", household_id)
    finally:
        db.close()


def start_scheduler() -> None:
    if scheduler.running:
        return
    scheduler.add_job(
        run_household_sync_and_checks,
        "interval",
        minutes=settings.scheduler_interval_minutes,
        id="household_sync_and_checks",
        replace_existing=True,
    )
    scheduler.start()


def stop_scheduler() -> None:
    if scheduler.running:
        scheduler.shutdown(wait=False)
