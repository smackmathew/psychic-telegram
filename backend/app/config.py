from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql://dashboard:dashboard@localhost:5432/household_dashboard"

    secret_key: str = "dev-secret-change-me"
    access_token_expire_minutes: int = 10080
    algorithm: str = "HS256"

    cors_origins: str = "http://localhost:5173"

    plaid_client_id: str = ""
    plaid_secret: str = ""
    plaid_env: str = "sandbox"
    plaid_products: str = "transactions,investments"
    plaid_country_codes: str = "US"

    large_transaction_threshold: float = 500
    budget_warning_pct: float = 0.9
    upcoming_bill_lead_days: int = 3
    idle_cash_investment_threshold: float = 10000

    scheduler_interval_minutes: int = 60

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def plaid_products_list(self) -> list[str]:
        return [p.strip() for p in self.plaid_products.split(",") if p.strip()]

    @property
    def plaid_country_codes_list(self) -> list[str]:
        return [c.strip() for c in self.plaid_country_codes.split(",") if c.strip()]

    @property
    def plaid_enabled(self) -> bool:
        return bool(self.plaid_client_id and self.plaid_secret)


@lru_cache
def get_settings() -> Settings:
    return Settings()
