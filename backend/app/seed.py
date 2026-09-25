"""One-time setup: creates the household and the two user accounts.

Usage:
    python -m app.seed \
        --household-name "The Smiths" \
        --user1-name "Alex Smith" --user1-email alex@example.com --user1-password "..." \
        --user2-name "Sam Smith" --user2-email sam@example.com --user2-password "..."

Safe to re-run: it skips creating a household/user if one with that email already exists.
"""

import argparse

from app.database import Base, SessionLocal, engine
from app.models import Category, CategoryType, Household, User
from app.routers.auth import DEFAULT_CATEGORIES
from app.security import hash_password


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--household-name", required=True)
    parser.add_argument("--user1-name", required=True)
    parser.add_argument("--user1-email", required=True)
    parser.add_argument("--user1-password", required=True)
    parser.add_argument("--user2-name", required=True)
    parser.add_argument("--user2-email", required=True)
    parser.add_argument("--user2-password", required=True)
    args = parser.parse_args()

    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        household = db.query(Household).filter(Household.name == args.household_name).first()
        if household is None:
            household = Household(name=args.household_name)
            db.add(household)
            db.flush()
            for name, ctype in DEFAULT_CATEGORIES:
                db.add(Category(household_id=household.id, name=name, type=CategoryType(ctype), is_default=True))
            print(f"Created household '{household.name}' (invite code: {household.invite_code})")
        else:
            print(f"Household '{household.name}' already exists, reusing it")

        for name, email, password in (
            (args.user1_name, args.user1_email, args.user1_password),
            (args.user2_name, args.user2_email, args.user2_password),
        ):
            existing = db.query(User).filter(User.email == email).first()
            if existing:
                print(f"User {email} already exists, skipping")
                continue
            db.add(
                User(
                    household_id=household.id,
                    email=email,
                    full_name=name,
                    hashed_password=hash_password(password),
                )
            )
            print(f"Created user {name} <{email}>")

        db.commit()
    finally:
        db.close()


if __name__ == "__main__":
    main()
