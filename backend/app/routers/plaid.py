from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app import models, schemas
from app.config import get_settings
from app.database import get_db
from app.deps import get_current_household_id, get_current_user
from app.services.plaid_client import (
    create_link_token,
    exchange_public_token,
    import_accounts_for_item,
    sync_household_plaid_items,
)

router = APIRouter(prefix="/plaid", tags=["plaid"])
settings = get_settings()


def _require_plaid_enabled():
    if not settings.plaid_enabled:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Plaid isn't configured yet. Add PLAID_CLIENT_ID and PLAID_SECRET in the backend environment.",
        )


@router.post("/link-token", response_model=schemas.LinkTokenResponse)
def get_link_token(current_user: models.User = Depends(get_current_user)):
    _require_plaid_enabled()
    token = create_link_token(current_user.id)
    return schemas.LinkTokenResponse(link_token=token)


@router.post("/exchange-public-token", response_model=list[schemas.AccountOut], status_code=status.HTTP_201_CREATED)
def exchange_token(
    payload: schemas.ExchangePublicTokenRequest,
    db: Session = Depends(get_db),
    household_id: str = Depends(get_current_household_id),
):
    _require_plaid_enabled()
    result = exchange_public_token(payload.public_token)

    plaid_item = models.PlaidItem(
        household_id=household_id,
        plaid_item_id=result["item_id"],
        access_token=result["access_token"],
        institution_name=payload.institution_name,
    )
    db.add(plaid_item)
    db.commit()
    db.refresh(plaid_item)

    accounts = import_accounts_for_item(db, plaid_item)
    return accounts


@router.post("/sync", status_code=status.HTTP_204_NO_CONTENT)
def sync_now(db: Session = Depends(get_db), household_id: str = Depends(get_current_household_id)):
    _require_plaid_enabled()
    sync_household_plaid_items(db, household_id)


@router.get("/status")
def plaid_status():
    return {"enabled": settings.plaid_enabled, "environment": settings.plaid_env}
