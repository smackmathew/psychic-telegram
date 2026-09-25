"""Thin wrapper around the Plaid API: Link token creation, public token exchange,
and syncing transactions/balances/investment holdings into our own models.

Requires PLAID_CLIENT_ID / PLAID_SECRET to be set (see .env.example); until then,
`settings.plaid_enabled` is False and the /plaid router returns 503 so the rest of
the app still works with manually-entered accounts.
"""

import logging
from functools import lru_cache

import plaid
from plaid.api import plaid_api
from plaid.model.accounts_get_request import AccountsGetRequest
from plaid.model.country_code import CountryCode
from plaid.model.investments_holdings_get_request import InvestmentsHoldingsGetRequest
from plaid.model.item_public_token_exchange_request import ItemPublicTokenExchangeRequest
from plaid.model.link_token_create_request import LinkTokenCreateRequest
from plaid.model.link_token_create_request_user import LinkTokenCreateRequestUser
from plaid.model.products import Products
from plaid.model.transactions_sync_request import TransactionsSyncRequest
from sqlalchemy.orm import Session

from app import models
from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

_ENV_HOSTS = {
    "sandbox": plaid.Environment.Sandbox,
    "production": plaid.Environment.Production,
}


@lru_cache
def get_plaid_client() -> plaid_api.PlaidApi:
    configuration = plaid.Configuration(
        host=_ENV_HOSTS.get(settings.plaid_env, plaid.Environment.Sandbox),
        api_key={"clientId": settings.plaid_client_id, "secret": settings.plaid_secret},
    )
    api_client = plaid.ApiClient(configuration)
    return plaid_api.PlaidApi(api_client)


def create_link_token(user_id: str) -> str:
    client = get_plaid_client()
    request = LinkTokenCreateRequest(
        products=[Products(p) for p in settings.plaid_products_list],
        client_name="Household Financial Dashboard",
        country_codes=[CountryCode(c) for c in settings.plaid_country_codes_list],
        language="en",
        user=LinkTokenCreateRequestUser(client_user_id=user_id),
    )
    response = client.link_token_create(request)
    return response.link_token


def exchange_public_token(public_token: str) -> dict:
    client = get_plaid_client()
    response = client.item_public_token_exchange(ItemPublicTokenExchangeRequest(public_token=public_token))
    return {"access_token": response.access_token, "item_id": response.item_id}


def _map_account_type(plaid_type: str, plaid_subtype: str | None) -> models.AccountType:
    if plaid_type == "depository":
        return models.AccountType.savings if plaid_subtype == "savings" else models.AccountType.checking
    if plaid_type == "credit":
        return models.AccountType.credit_card
    if plaid_type == "loan":
        return models.AccountType.loan
    if plaid_type == "investment":
        return models.AccountType.investment
    return models.AccountType.other


def import_accounts_for_item(db: Session, plaid_item: models.PlaidItem) -> list[models.Account]:
    """Fetch accounts for a Plaid Item and create/update our Account rows + balances."""
    client = get_plaid_client()
    response = client.accounts_get(AccountsGetRequest(access_token=plaid_item.access_token))

    accounts = []
    for plaid_account in response.accounts:
        account = (
            db.query(models.Account)
            .filter(models.Account.plaid_account_id == plaid_account.account_id)
            .first()
        )
        balances = plaid_account.balances
        if account is None:
            account = models.Account(
                household_id=plaid_item.household_id,
                plaid_item_id=plaid_item.id,
                plaid_account_id=plaid_account.account_id,
                name=plaid_account.name,
                institution_name=plaid_item.institution_name,
                type=_map_account_type(plaid_account.type.value, plaid_account.subtype.value if plaid_account.subtype else None),
                is_manual=False,
                currency=balances.iso_currency_code or "USD",
            )
            db.add(account)
        account.current_balance = balances.current if balances.current is not None else account.current_balance
        account.available_balance = balances.available
        accounts.append(account)

    db.commit()
    return accounts


def sync_transactions_for_item(db: Session, plaid_item: models.PlaidItem) -> None:
    client = get_plaid_client()
    accounts_by_plaid_id = {
        a.plaid_account_id: a for a in db.query(models.Account).filter(models.Account.plaid_item_id == plaid_item.id).all()
    }

    cursor = plaid_item.transactions_cursor
    has_more = True
    while has_more:
        request = TransactionsSyncRequest(access_token=plaid_item.access_token, cursor=cursor)
        response = client.transactions_sync(request)

        for txn in response.added + response.modified:
            account = accounts_by_plaid_id.get(txn.account_id)
            if account is None:
                continue
            existing = (
                db.query(models.Transaction)
                .filter(models.Transaction.plaid_transaction_id == txn.transaction_id)
                .first()
            )
            direction = models.TransactionDirection.debit if txn.amount > 0 else models.TransactionDirection.credit
            fields = dict(
                account_id=account.id,
                plaid_transaction_id=txn.transaction_id,
                date=txn.date,
                amount=abs(txn.amount),
                direction=direction,
                name=txn.name,
                merchant_name=txn.merchant_name,
                pending=txn.pending,
                is_manual=False,
            )
            if existing:
                for field, value in fields.items():
                    setattr(existing, field, value)
            else:
                db.add(models.Transaction(**fields))

        for removed in response.removed:
            db.query(models.Transaction).filter(
                models.Transaction.plaid_transaction_id == removed.transaction_id
            ).delete()

        cursor = response.next_cursor
        has_more = response.has_more

    plaid_item.transactions_cursor = cursor
    db.commit()


def sync_investment_holdings_for_item(db: Session, plaid_item: models.PlaidItem) -> None:
    investment_accounts = (
        db.query(models.Account)
        .filter(models.Account.plaid_item_id == plaid_item.id, models.Account.type == models.AccountType.investment)
        .all()
    )
    if not investment_accounts:
        return

    client = get_plaid_client()
    try:
        response = client.investments_holdings_get(InvestmentsHoldingsGetRequest(access_token=plaid_item.access_token))
    except plaid.ApiException:
        logger.info("Investments product not available for item %s", plaid_item.plaid_item_id)
        return

    totals: dict[str, float] = {}
    for holding in response.holdings:
        value = float(holding.institution_price) * float(holding.quantity)
        totals[holding.account_id] = totals.get(holding.account_id, 0) + value

    for account in investment_accounts:
        if account.plaid_account_id in totals:
            account.current_balance = round(totals[account.plaid_account_id], 2)
    db.commit()


def sync_household_plaid_items(db: Session, household_id: str) -> None:
    items = db.query(models.PlaidItem).filter(models.PlaidItem.household_id == household_id).all()
    for item in items:
        try:
            import_accounts_for_item(db, item)
            sync_transactions_for_item(db, item)
            sync_investment_holdings_for_item(db, item)
        except plaid.ApiException:
            logger.exception("Plaid sync failed for item %s", item.plaid_item_id)
            note = models.Notification(
                household_id=household_id,
                type=models.NotificationType.sync_error,
                severity=models.NotificationSeverity.warning,
                title=f"Bank sync failed for {item.institution_name or 'a linked account'}",
                message="We couldn't refresh this account from your bank. You may need to reconnect it.",
                dedupe_key=f"plaid_sync_error:{item.id}",
                related_entity_type="plaid_item",
                related_entity_id=item.id,
            )
            exists = (
                db.query(models.Notification)
                .filter(models.Notification.dedupe_key == note.dedupe_key)
                .first()
            )
            if not exists:
                db.add(note)
                db.commit()
