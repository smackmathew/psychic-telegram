"""Rule-of-thumb borrowing-capacity estimates (28/36 DTI, standard mortgage amortization,
typical SBA / investment-property down payment norms). These are educational estimates,
not a loan pre-approval or financial advice - actual terms depend on the lender, full
credit report, assets, and program-specific underwriting."""

DISCLAIMER = (
    "These are rough, rule-of-thumb estimates (28/36 debt-to-income guideline, standard mortgage "
    "amortization, typical down-payment norms) - not a pre-approval or financial/lending advice. "
    "Actual borrowing capacity depends on the lender, your full credit report, assets, and program."
)


def _amortized_principal(monthly_payment: float, annual_rate_pct: float, term_years: int) -> float:
    r = (annual_rate_pct / 100) / 12
    n = term_years * 12
    if monthly_payment <= 0:
        return 0.0
    if r == 0:
        return monthly_payment * n
    return monthly_payment * (1 - (1 + r) ** -n) / r


def compute_borrowing_capacity(
    annual_gross_income: float,
    monthly_debt_payments: float,
    cash_reserves: float,
    best_credit_score: int | None,
    interest_rate_pct: float,
    term_years: int,
    down_payment_pct: float,
) -> dict:
    monthly_income = annual_gross_income / 12 if annual_gross_income else 0.0
    current_dti_pct = (monthly_debt_payments / monthly_income * 100) if monthly_income else 0.0

    max_housing_front_end = monthly_income * 0.28
    max_total_debt_back_end = monthly_income * 0.36
    max_housing_back_end = max(max_total_debt_back_end - monthly_debt_payments, 0.0)
    max_monthly_housing_payment = min(max_housing_front_end, max_housing_back_end) if monthly_income else 0.0

    max_loan_principal = _amortized_principal(max_monthly_housing_payment, interest_rate_pct, term_years)
    down_pct = max(min(down_payment_pct, 99), 0) / 100
    estimated_max_home_price = max_loan_principal / (1 - down_pct) if down_pct < 1 else max_loan_principal
    required_down_payment = estimated_max_home_price * down_pct
    down_payment_shortfall = max(required_down_payment - cash_reserves, 0.0)

    notes = [DISCLAIMER]

    if best_credit_score is None:
        mortgage_readiness = "Add a credit score for household members to get a real readiness read."
    elif monthly_income <= 0:
        mortgage_readiness = "Add your household's annual gross income (Household settings) to estimate mortgage readiness."
    elif best_credit_score >= 740 and current_dti_pct <= 36:
        mortgage_readiness = "Strong: score and DTI are in range for the best conventional mortgage rates."
    elif best_credit_score >= 670 and current_dti_pct <= 43:
        mortgage_readiness = "Good: you'd likely qualify for a conventional mortgage, possibly not at the top-tier rate."
    elif best_credit_score >= 620:
        mortgage_readiness = "Workable via FHA or non-conventional programs; a conventional loan may be tough at this score/DTI."
    else:
        mortgage_readiness = "Below typical conventional/FHA minimums today - focus on credit-building and paying down debt first."

    if best_credit_score is None or monthly_income <= 0:
        business_loan_readiness = "Add income and a credit score to estimate SBA/business-loan readiness."
    else:
        low_purchase = cash_reserves / 0.20 if cash_reserves else 0.0
        high_purchase = cash_reserves / 0.10 if cash_reserves else 0.0
        size_note = (
            f"Based on your ${cash_reserves:,.0f} in liquid reserves, a typical SBA 7(a) acquisition loan "
            f"(10-20% down) could support a purchase price of roughly ${low_purchase:,.0f}-${high_purchase:,.0f}, "
            "before lenders also weigh cash flow of the target business and 3-6 months of reserves."
        )
        notes.append(size_note)
        if best_credit_score >= 680 and current_dti_pct <= 43:
            business_loan_readiness = "Good: score and DTI are in the range most SBA/bank lenders want for a business acquisition loan."
        elif best_credit_score >= 650:
            business_loan_readiness = "Borderline: SBA lenders may work with this score, but expect more scrutiny and possibly a larger down payment."
        else:
            business_loan_readiness = "Below what most SBA/bank lenders want (650+) - build credit before pursuing acquisition financing."

    if best_credit_score is None or monthly_income <= 0:
        real_estate_investment_readiness = "Add income and a credit score to estimate investment-property readiness."
    else:
        low_rental = cash_reserves / 0.25 if cash_reserves else 0.0
        high_rental = cash_reserves / 0.20 if cash_reserves else 0.0
        notes.append(
            f"Investment (non owner-occupied) properties usually need 20-25% down and stricter DTI. Your reserves "
            f"could cover the down payment on a ${low_rental:,.0f}-${high_rental:,.0f} property, subject to rental-income "
            "underwriting rules."
        )
        if best_credit_score >= 700 and current_dti_pct <= 45:
            real_estate_investment_readiness = "Good: likely to qualify for investment-property financing at competitive terms."
        elif best_credit_score >= 660:
            real_estate_investment_readiness = "Workable, but expect a rate premium over an owner-occupied mortgage."
        else:
            real_estate_investment_readiness = "Investment-property lenders are stricter than primary-residence lenders - build credit/DTI room first."

    return {
        "monthly_gross_income": round(monthly_income, 2),
        "monthly_debt_payments": round(monthly_debt_payments, 2),
        "current_dti_pct": round(current_dti_pct, 1),
        "max_monthly_housing_payment": round(max_monthly_housing_payment, 2),
        "max_loan_principal": round(max_loan_principal, 2),
        "estimated_max_home_price": round(estimated_max_home_price, 2),
        "required_down_payment": round(required_down_payment, 2),
        "cash_reserves": round(cash_reserves, 2),
        "down_payment_shortfall": round(down_payment_shortfall, 2),
        "mortgage_readiness": mortgage_readiness,
        "business_loan_readiness": business_loan_readiness,
        "real_estate_investment_readiness": real_estate_investment_readiness,
        "notes": notes,
    }
