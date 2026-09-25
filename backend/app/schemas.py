from datetime import date, datetime
from datetime import date as _Date  # aliased to avoid clashing with fields literally named `date`

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.models import (
    AccountType,
    CategoryType,
    CreditBureau,
    GoalType,
    NotificationSeverity,
    NotificationType,
    TransactionDirection,
)


# ---------- Auth ----------
class SignupRequest(BaseModel):
    full_name: str
    email: EmailStr
    password: str = Field(min_length=8)
    household_name: str | None = None
    invite_code: str | None = None


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    email: str
    full_name: str
    household_id: str


class HouseholdOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    name: str
    invite_code: str
    annual_gross_income: float | None = None


class HouseholdUpdate(BaseModel):
    name: str | None = None
    annual_gross_income: float | None = None


# ---------- Accounts ----------
class AccountBase(BaseModel):
    name: str
    institution_name: str | None = None
    type: AccountType
    current_balance: float = 0
    available_balance: float | None = None
    monthly_payment: float | None = None
    currency: str = "USD"


class AccountCreate(AccountBase):
    pass


class AccountUpdate(BaseModel):
    name: str | None = None
    institution_name: str | None = None
    type: AccountType | None = None
    current_balance: float | None = None
    available_balance: float | None = None
    monthly_payment: float | None = None


class AccountOut(AccountBase):
    model_config = ConfigDict(from_attributes=True)
    id: str
    is_manual: bool
    plaid_item_id: str | None = None
    updated_at: datetime


# ---------- Categories ----------
class CategoryBase(BaseModel):
    name: str
    type: CategoryType
    icon: str | None = None


class CategoryCreate(CategoryBase):
    pass


class CategoryOut(CategoryBase):
    model_config = ConfigDict(from_attributes=True)
    id: str
    is_default: bool


# ---------- Transactions ----------
class TransactionBase(BaseModel):
    account_id: str
    category_id: str | None = None
    date: _Date
    amount: float = Field(gt=0)
    direction: TransactionDirection
    name: str
    merchant_name: str | None = None
    notes: str | None = None


class TransactionCreate(TransactionBase):
    pass


class TransactionUpdate(BaseModel):
    category_id: str | None = None
    notes: str | None = None
    name: str | None = None
    amount: float | None = Field(default=None, gt=0)
    date: _Date | None = None

    @field_validator("name", "amount", "date")
    @classmethod
    def _not_null(cls, value):
        # These may be omitted, but the columns are non-nullable, so an explicit null is invalid.
        # (Validators don't run on defaults, so this only fires when the client sends null.)
        if value is None:
            raise ValueError("may be omitted but not null")
        return value


class TransactionOut(TransactionBase):
    model_config = ConfigDict(from_attributes=True)
    id: str
    pending: bool
    is_manual: bool
    created_at: datetime


# ---------- Budgets ----------
class BudgetBase(BaseModel):
    category_id: str
    month: date
    amount_limit: float = Field(gt=0)


class BudgetCreate(BudgetBase):
    pass


class BudgetOut(BudgetBase):
    model_config = ConfigDict(from_attributes=True)
    id: str
    category: CategoryOut


class BudgetProgress(BaseModel):
    budget: BudgetOut
    spent: float
    remaining: float
    pct_used: float


# ---------- Goals ----------
class GoalBase(BaseModel):
    name: str
    type: GoalType
    target_amount: float = Field(gt=0)
    current_amount: float = 0
    target_date: date | None = None
    linked_account_id: str | None = None


class GoalCreate(GoalBase):
    pass


class GoalUpdate(BaseModel):
    name: str | None = None
    target_amount: float | None = None
    current_amount: float | None = None
    target_date: date | None = None
    linked_account_id: str | None = None


class GoalOut(GoalBase):
    model_config = ConfigDict(from_attributes=True)
    id: str
    created_at: datetime


# ---------- Recurring bills ----------
class RecurringBillBase(BaseModel):
    name: str
    amount: float = Field(gt=0)
    due_day: int = Field(ge=1, le=28)
    category_id: str | None = None
    account_id: str | None = None
    is_active: bool = True


class RecurringBillCreate(RecurringBillBase):
    pass


class RecurringBillOut(RecurringBillBase):
    model_config = ConfigDict(from_attributes=True)
    id: str


# ---------- Notifications ----------
class NotificationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    type: NotificationType
    severity: NotificationSeverity
    title: str
    message: str
    is_read: bool
    related_entity_type: str | None = None
    related_entity_id: str | None = None
    created_at: datetime


# ---------- Plaid ----------
class LinkTokenResponse(BaseModel):
    link_token: str


class ExchangePublicTokenRequest(BaseModel):
    public_token: str
    institution_name: str | None = None


# ---------- Dashboard ----------
class NetWorthPoint(BaseModel):
    label: str
    assets: float
    liabilities: float
    net_worth: float


class SpendingByCategory(BaseModel):
    category_name: str
    amount: float


class DashboardSummary(BaseModel):
    total_assets: float
    total_liabilities: float
    net_worth: float
    month_income: float
    month_expenses: float
    spending_by_category: list[SpendingByCategory]
    net_worth_trend: list[NetWorthPoint]
    unread_notifications: int


# ---------- Credit ----------
class CreditProfileBase(BaseModel):
    bureau: CreditBureau = CreditBureau.other
    score: int = Field(ge=300, le=850)
    utilization_pct: float | None = Field(default=None, ge=0, le=100)
    on_time_payment_pct: float | None = Field(default=None, ge=0, le=100)
    credit_age_years: float | None = Field(default=None, ge=0)
    num_hard_inquiries_12mo: int | None = Field(default=None, ge=0)
    num_open_accounts: int | None = Field(default=None, ge=0)
    num_derogatory_marks: int | None = Field(default=None, ge=0)


class CreditProfileUpsert(CreditProfileBase):
    recorded_date: date | None = None  # defaults to today; used for the history entry


class CreditProfileOut(CreditProfileBase):
    model_config = ConfigDict(from_attributes=True)
    id: str
    user_id: str
    updated_at: datetime


class CreditScoreHistoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    bureau: CreditBureau
    score: int
    recorded_date: date


class CreditRecommendation(BaseModel):
    title: str
    detail: str
    priority: str  # high | medium | low


class CreditRecommendationsOut(BaseModel):
    user_id: str
    score: int
    score_band: str
    recommendations: list[CreditRecommendation]


class BorrowingCapacityRequest(BaseModel):
    annual_gross_income: float | None = None  # falls back to household.annual_gross_income
    extra_monthly_debt: float = 0  # any debt not already captured by loan/credit accounts
    interest_rate_pct: float = 6.5
    term_years: int = 30
    down_payment_pct: float = 20
    cash_reserves_override: float | None = None  # falls back to sum of liquid (checking/savings) balances


class BorrowingCapacityOut(BaseModel):
    monthly_gross_income: float
    monthly_debt_payments: float
    current_dti_pct: float
    max_monthly_housing_payment: float
    max_loan_principal: float
    estimated_max_home_price: float
    required_down_payment: float
    cash_reserves: float
    down_payment_shortfall: float
    mortgage_readiness: str
    business_loan_readiness: str
    real_estate_investment_readiness: str
    notes: list[str]
