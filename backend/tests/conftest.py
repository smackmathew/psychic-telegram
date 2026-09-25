"""Shared fixtures for the backend test suite.

Tests run against a real Postgres database (the same engine production uses), built from
the Alembic migrations so the suite also catches a migration that drifts from the models.
Point TEST_DATABASE_URL at a throwaway database; it defaults to a `_test` sibling of the
docker-compose database and is created automatically if it doesn't exist. Its schema is
dropped and rebuilt at the start of every run.

Each test runs inside a transaction that is rolled back afterwards, so routes can call
`db.commit()` freely (it only releases a SAVEPOINT) without tests leaking into each other.
"""

import os
from pathlib import Path

# Settings are read (and cached) at import time by several app modules, so the test
# environment has to be in place before anything under `app` is imported.
TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql://dashboard:dashboard@localhost:5432/household_dashboard_test",
)
os.environ["DATABASE_URL"] = TEST_DATABASE_URL
os.environ["SECRET_KEY"] = "test-secret-key"
# Long-lived tokens so tests that move the clock forward with freezegun stay signed in.
os.environ["ACCESS_TOKEN_EXPIRE_MINUTES"] = str(60 * 24 * 365)
os.environ["PLAID_CLIENT_ID"] = ""
os.environ["PLAID_SECRET"] = ""

import bcrypt  # noqa: E402
import pytest  # noqa: E402
from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine, text  # noqa: E402
from sqlalchemy.engine import make_url  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app.database import get_db  # noqa: E402
from app.main import app  # noqa: E402

BACKEND_DIR = Path(__file__).resolve().parents[1]


def _ensure_database_exists(url: str) -> None:
    db_url = make_url(url)
    admin_engine = create_engine(db_url.set(database="postgres"), isolation_level="AUTOCOMMIT")
    try:
        with admin_engine.connect() as conn:
            exists = conn.execute(
                text("SELECT 1 FROM pg_database WHERE datname = :name"), {"name": db_url.database}
            ).scalar()
            if not exists:
                conn.execute(text(f'CREATE DATABASE "{db_url.database}"'))
    finally:
        admin_engine.dispose()


@pytest.fixture(scope="session")
def engine():
    _ensure_database_exists(TEST_DATABASE_URL)
    engine = create_engine(TEST_DATABASE_URL)
    with engine.begin() as conn:
        # Also drops the Postgres enum types the migrations create.
        conn.execute(text("DROP SCHEMA public CASCADE"))
        conn.execute(text("CREATE SCHEMA public"))

    alembic_cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    alembic_cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    command.upgrade(alembic_cfg, "head")

    yield engine
    engine.dispose()


@pytest.fixture(autouse=True)
def fast_password_hashing(monkeypatch):
    # The default bcrypt cost (12 rounds) makes every signup take ~0.25s.
    real_gensalt = bcrypt.gensalt
    monkeypatch.setattr(bcrypt, "gensalt", lambda rounds=4, prefix=b"2b": real_gensalt(rounds, prefix))


@pytest.fixture
def db(engine):
    connection = engine.connect()
    transaction = connection.begin()
    session = Session(bind=connection, join_transaction_mode="create_savepoint")
    try:
        yield session
    finally:
        session.close()
        transaction.rollback()
        connection.close()


@pytest.fixture
def client(db):
    def override_get_db():
        yield db

    app.dependency_overrides[get_db] = override_get_db
    # Not used as a context manager on purpose: that would run the app lifespan and
    # start the background scheduler.
    yield TestClient(app)
    app.dependency_overrides.pop(get_db, None)


def signup(client: TestClient, email: str, full_name: str = "Test User", **extra) -> dict:
    payload = {"full_name": full_name, "email": email, "password": "correct-horse-battery", **extra}
    response = client.post("/auth/signup", json=payload)
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


class ApiClient:
    """A TestClient bound to one signed-in user's auth headers."""

    def __init__(self, client: TestClient, headers: dict):
        self._client = client
        self.headers = headers
        me = client.get("/auth/me", headers=headers).json()
        self.user_id = me["id"]
        self.household_id = me["household_id"]

    def get(self, url, **kwargs):
        return self._client.get(url, headers=self.headers, **kwargs)

    def post(self, url, **kwargs):
        return self._client.post(url, headers=self.headers, **kwargs)

    def put(self, url, **kwargs):
        return self._client.put(url, headers=self.headers, **kwargs)

    def patch(self, url, **kwargs):
        return self._client.patch(url, headers=self.headers, **kwargs)

    def delete(self, url, **kwargs):
        return self._client.delete(url, headers=self.headers, **kwargs)

    # Small helpers for the objects most tests need.
    def category_id(self, name: str) -> str:
        return next(c["id"] for c in self.get("/categories").json() if c["name"] == name)

    def create_account(self, **fields) -> dict:
        payload = {"name": "Checking", "type": "checking", "current_balance": 0, **fields}
        response = self.post("/accounts", json=payload)
        assert response.status_code == 201, response.text
        return response.json()

    def create_transaction(self, account_id: str, **fields) -> dict:
        payload = {"account_id": account_id, "name": "Txn", "direction": "debit", **fields}
        response = self.post("/transactions", json=payload)
        assert response.status_code == 201, response.text
        return response.json()


@pytest.fixture
def api(client) -> ApiClient:
    return ApiClient(client, signup(client, "alex@example.com", "Alex", household_name="Test Household"))


@pytest.fixture
def partner_api(client, api) -> ApiClient:
    """Second member of the same household as `api`, joined via invite code."""
    invite_code = api.get("/household").json()["invite_code"]
    return ApiClient(client, signup(client, "sam@example.com", "Sam", invite_code=invite_code))


@pytest.fixture
def other_api(client) -> ApiClient:
    """A user in a completely separate household, for data-isolation tests."""
    return ApiClient(client, signup(client, "stranger@example.com", "Stranger"))
