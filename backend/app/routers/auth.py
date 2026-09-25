from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app import models, schemas
from app.database import get_db
from app.deps import get_current_user
from app.security import create_access_token, hash_password, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])

DEFAULT_CATEGORIES = [
    ("Salary", models.CategoryType.income),
    ("Bonus", models.CategoryType.income),
    ("Investment Income", models.CategoryType.income),
    ("Other Income", models.CategoryType.income),
    ("Groceries", models.CategoryType.expense),
    ("Dining Out", models.CategoryType.expense),
    ("Housing", models.CategoryType.expense),
    ("Utilities", models.CategoryType.expense),
    ("Transportation", models.CategoryType.expense),
    ("Insurance", models.CategoryType.expense),
    ("Healthcare", models.CategoryType.expense),
    ("Childcare", models.CategoryType.expense),
    ("Entertainment", models.CategoryType.expense),
    ("Shopping", models.CategoryType.expense),
    ("Subscriptions", models.CategoryType.expense),
    ("Travel", models.CategoryType.expense),
    ("Debt Payments", models.CategoryType.expense),
    ("Savings Transfer", models.CategoryType.expense),
    ("Investment Contribution", models.CategoryType.expense),
    ("Miscellaneous", models.CategoryType.expense),
]


@router.post("/signup", response_model=schemas.TokenResponse)
def signup(payload: schemas.SignupRequest, db: Session = Depends(get_db)):
    existing = db.query(models.User).filter(models.User.email == payload.email).first()
    if existing:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Email already registered")

    household = None
    if payload.invite_code:
        household = db.query(models.Household).filter(models.Household.invite_code == payload.invite_code).first()
        if not household:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid invite code")
    else:
        household = models.Household(name=payload.household_name or f"{payload.full_name}'s Household")
        db.add(household)
        db.flush()
        for name, ctype in DEFAULT_CATEGORIES:
            db.add(models.Category(household_id=household.id, name=name, type=ctype, is_default=True))

    user = models.User(
        household_id=household.id,
        email=payload.email,
        hashed_password=hash_password(payload.password),
        full_name=payload.full_name,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    token = create_access_token({"sub": user.id})
    return schemas.TokenResponse(access_token=token)


@router.post("/login", response_model=schemas.TokenResponse)
def login(payload: schemas.LoginRequest, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.email == payload.email).first()
    if not user or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Incorrect email or password")
    token = create_access_token({"sub": user.id})
    return schemas.TokenResponse(access_token=token)


@router.get("/me", response_model=schemas.UserOut)
def me(current_user: models.User = Depends(get_current_user)):
    return current_user
