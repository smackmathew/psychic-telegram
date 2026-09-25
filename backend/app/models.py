import enum
import uuid
from datetime import date, datetime
from datetime import date as _Date  # aliased to avoid clashing with the `date` column name below

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.database import Base


def _uuid() -> str:
    return str(uuid.uuid4())


class AccountType(str, enum.Enum):
    checking = "checking"
    savings = "savings"
    credit_card = "credit_card"
    investment = "investment"
    loan = "loan"
    other = "other"


class CategoryType(str, enum.Enum):
    income = "income"
    expense = "expense"


class TransactionDirection(str, enum.Enum):
    debit = "debit"  # money out (expense)
    credit = "credit"  # money in (income)


class GoalType(str, enum.Enum):
    savings = "savings"
    debt_payoff = "debt_payoff"
    investment = "investment"


class NotificationType(str, enum.Enum):
    bill_due = "bill_due"
    budget_exceeded = "budget_exceeded"
    goal_milestone = "goal_milestone"
    large_transaction = "large_transaction"
    investment_opportunity = "investment_opportunity"
    sync_error = "sync_error"
    credit_alert = "credit_alert"


class CreditBureau(str, enum.Enum):
    experian = "experian"
    equifax = "equifax"
    transunion = "transunion"
    other = "other"


class NotificationSeverity(str, enum.Enum):
    info = "info"
    warning = "warning"
    success = "success"


class Household(Base):
    __tablename__ = "households"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(255))
    invite_code: Mapped[str] = mapped_column(String(16), unique=True, default=lambda: uuid.uuid4().hex[:8])
    annual_gross_income: Mapped[float | None] = mapped_column(Numeric(14, 2), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    users: Mapped[list["User"]] = relationship(back_populates="household")
    accounts: Mapped[list["Account"]] = relationship(back_populates="household")


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    household_id: Mapped[str] = mapped_column(ForeignKey("households.id"))
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    hashed_password: Mapped[str] = mapped_column(String(255))
    full_name: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    household: Mapped["Household"] = relationship(back_populates="users")


class PlaidItem(Base):
    __tablename__ = "plaid_items"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    household_id: Mapped[str] = mapped_column(ForeignKey("households.id"))
    plaid_item_id: Mapped[str] = mapped_column(String(255), unique=True)
    access_token: Mapped[str] = mapped_column(String(255))
    institution_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    transactions_cursor: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    accounts: Mapped[list["Account"]] = relationship(back_populates="plaid_item")


class Account(Base):
    __tablename__ = "accounts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    household_id: Mapped[str] = mapped_column(ForeignKey("households.id"))
    plaid_item_id: Mapped[str | None] = mapped_column(ForeignKey("plaid_items.id"), nullable=True)
    plaid_account_id: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True)

    name: Mapped[str] = mapped_column(String(255))
    institution_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    type: Mapped[AccountType] = mapped_column(Enum(AccountType), default=AccountType.other)
    is_manual: Mapped[bool] = mapped_column(Boolean, default=True)
    current_balance: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    available_balance: Mapped[float | None] = mapped_column(Numeric(14, 2), nullable=True)
    monthly_payment: Mapped[float | None] = mapped_column(Numeric(14, 2), nullable=True)  # for credit_card/loan accounts
    currency: Mapped[str] = mapped_column(String(8), default="USD")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    household: Mapped["Household"] = relationship(back_populates="accounts")
    plaid_item: Mapped["PlaidItem | None"] = relationship(back_populates="accounts")
    transactions: Mapped[list["Transaction"]] = relationship(back_populates="account", cascade="all, delete-orphan")


class Category(Base):
    __tablename__ = "categories"
    __table_args__ = (UniqueConstraint("household_id", "name", "type", name="uq_category_household_name_type"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    household_id: Mapped[str | None] = mapped_column(ForeignKey("households.id"), nullable=True)
    name: Mapped[str] = mapped_column(String(255))
    type: Mapped[CategoryType] = mapped_column(Enum(CategoryType), default=CategoryType.expense)
    icon: Mapped[str | None] = mapped_column(String(64), nullable=True)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)


class Transaction(Base):
    __tablename__ = "transactions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    account_id: Mapped[str] = mapped_column(ForeignKey("accounts.id"))
    category_id: Mapped[str | None] = mapped_column(ForeignKey("categories.id"), nullable=True)
    plaid_transaction_id: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True)

    date: Mapped[_Date] = mapped_column(Date)
    amount: Mapped[float] = mapped_column(Numeric(14, 2))
    direction: Mapped[TransactionDirection] = mapped_column(Enum(TransactionDirection))
    name: Mapped[str] = mapped_column(String(500))
    merchant_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    pending: Mapped[bool] = mapped_column(Boolean, default=False)
    is_manual: Mapped[bool] = mapped_column(Boolean, default=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    account: Mapped["Account"] = relationship(back_populates="transactions")
    category: Mapped["Category | None"] = relationship()


class Budget(Base):
    __tablename__ = "budgets"
    __table_args__ = (UniqueConstraint("household_id", "category_id", "month", name="uq_budget_household_category_month"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    household_id: Mapped[str] = mapped_column(ForeignKey("households.id"))
    category_id: Mapped[str] = mapped_column(ForeignKey("categories.id"))
    month: Mapped[date] = mapped_column(Date)  # first day of the budgeted month
    amount_limit: Mapped[float] = mapped_column(Numeric(14, 2))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    category: Mapped["Category"] = relationship()


class Goal(Base):
    __tablename__ = "goals"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    household_id: Mapped[str] = mapped_column(ForeignKey("households.id"))
    name: Mapped[str] = mapped_column(String(255))
    type: Mapped[GoalType] = mapped_column(Enum(GoalType), default=GoalType.savings)
    target_amount: Mapped[float] = mapped_column(Numeric(14, 2))
    current_amount: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    target_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    linked_account_id: Mapped[str | None] = mapped_column(ForeignKey("accounts.id"), nullable=True)
    last_milestone_pct: Mapped[int] = mapped_column(default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    linked_account: Mapped["Account | None"] = relationship()


class RecurringBill(Base):
    __tablename__ = "recurring_bills"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    household_id: Mapped[str] = mapped_column(ForeignKey("households.id"))
    name: Mapped[str] = mapped_column(String(255))
    amount: Mapped[float] = mapped_column(Numeric(14, 2))
    due_day: Mapped[int] = mapped_column()  # day of month, 1-28
    category_id: Mapped[str | None] = mapped_column(ForeignKey("categories.id"), nullable=True)
    account_id: Mapped[str | None] = mapped_column(ForeignKey("accounts.id"), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    household_id: Mapped[str] = mapped_column(ForeignKey("households.id"))
    type: Mapped[NotificationType] = mapped_column(Enum(NotificationType))
    severity: Mapped[NotificationSeverity] = mapped_column(Enum(NotificationSeverity), default=NotificationSeverity.info)
    title: Mapped[str] = mapped_column(String(255))
    message: Mapped[str] = mapped_column(Text)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False)
    dedupe_key: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    related_entity_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    related_entity_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class CreditProfile(Base):
    """Latest known credit snapshot for one household member. Populated by manual/periodic
    entry (e.g. copying numbers from a free credit-monitoring site) since a live bureau pull
    requires a paid third-party API not configured in this project."""

    __tablename__ = "credit_profiles"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), unique=True)
    bureau: Mapped[CreditBureau] = mapped_column(Enum(CreditBureau), default=CreditBureau.other)
    score: Mapped[int] = mapped_column()
    utilization_pct: Mapped[float | None] = mapped_column(Numeric(5, 2), nullable=True)
    on_time_payment_pct: Mapped[float | None] = mapped_column(Numeric(5, 2), nullable=True)
    credit_age_years: Mapped[float | None] = mapped_column(Numeric(5, 2), nullable=True)
    num_hard_inquiries_12mo: Mapped[int | None] = mapped_column(nullable=True)
    num_open_accounts: Mapped[int | None] = mapped_column(nullable=True)
    num_derogatory_marks: Mapped[int | None] = mapped_column(nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    user: Mapped["User"] = relationship()


class CreditScoreHistory(Base):
    __tablename__ = "credit_score_history"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    bureau: Mapped[CreditBureau] = mapped_column(Enum(CreditBureau), default=CreditBureau.other)
    score: Mapped[int] = mapped_column()
    recorded_date: Mapped[date] = mapped_column(Date)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
