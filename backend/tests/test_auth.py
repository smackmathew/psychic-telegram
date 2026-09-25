from app.routers.auth import DEFAULT_CATEGORIES
from tests.conftest import signup


def test_signup_creates_household_with_default_categories(api):
    household = api.get("/household").json()
    assert household["name"] == "Test Household"
    assert len(household["invite_code"]) == 8

    categories = api.get("/categories").json()
    assert {(c["name"], c["type"]) for c in categories} == {(name, ctype.value) for name, ctype in DEFAULT_CATEGORIES}
    assert all(c["is_default"] for c in categories)


def test_signup_without_household_name_uses_full_name(client):
    headers = signup(client, "solo@example.com", "Jordan")
    assert client.get("/household", headers=headers).json()["name"] == "Jordan's Household"


def test_invite_code_joins_existing_household(api, partner_api):
    assert partner_api.household_id == api.household_id
    members = api.get("/household/members").json()
    assert sorted(m["full_name"] for m in members) == ["Alex", "Sam"]
    # Joining doesn't duplicate the household's default categories.
    assert len(partner_api.get("/categories").json()) == len(DEFAULT_CATEGORIES)


def test_invalid_invite_code_is_rejected(client):
    response = client.post(
        "/auth/signup",
        json={"full_name": "X", "email": "x@example.com", "password": "long-enough", "invite_code": "nope"},
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "Invalid invite code"


def test_duplicate_email_is_rejected(client, api):
    response = client.post(
        "/auth/signup", json={"full_name": "Again", "email": "alex@example.com", "password": "long-enough"}
    )
    assert response.status_code == 400


def test_short_password_is_rejected(client):
    response = client.post("/auth/signup", json={"full_name": "X", "email": "x@example.com", "password": "short"})
    assert response.status_code == 422


def test_login_returns_working_token(client, api):
    response = client.post("/auth/login", json={"email": "alex@example.com", "password": "correct-horse-battery"})
    assert response.status_code == 200
    token = response.json()["access_token"]
    me = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.json()["email"] == "alex@example.com"


def test_login_with_wrong_password(client, api):
    response = client.post("/auth/login", json={"email": "alex@example.com", "password": "wrong-password"})
    assert response.status_code == 401


def test_login_with_unknown_email(client):
    response = client.post("/auth/login", json={"email": "ghost@example.com", "password": "whatever-123"})
    assert response.status_code == 401


def test_protected_routes_require_a_valid_token(client):
    assert client.get("/accounts").status_code == 401
    assert client.get("/accounts", headers={"Authorization": "Bearer not-a-jwt"}).status_code == 401


def test_health(client):
    assert client.get("/health").json() == {"status": "ok"}
