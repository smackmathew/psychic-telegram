from datetime import date, timedelta

from dateutil.relativedelta import relativedelta
from sqlalchemy import func
from sqlalchemy.orm import Session

from app import models
from app.config import get_settings

settings = get_settings()

MILESTONES = (25, 50, 75, 100)


def _create_if_new(db: Session, household_id: str, dedupe_key: str, **kwargs) -> models.Notification | None:
    existing = (
        db.query(models.Notification)
        .filter(models.Notification.household_id == household_id, models.Notification.dedupe_key == dedupe_key)
        .first()
    )
    if existing:
        return None
    notification = models.Notification(household_id=household_id, dedupe_key=dedupe_key, **kwargs)
    db.add(notification)
    return notification


def check_budget_overages(db: Session, household_id: str) -> list[models.Notification]:
    created = []
    month_start = date.today().replace(day=1)
    month_end = month_start + relativedelta(months=1)
    period_label = month_start.strftime("%Y-%m")

    budgets = db.query(models.Budget).filter(models.Budget.household_id == household_id, models.Budget.month == month_start).all()
    for budget in budgets:
        spent = (
            db.query(func.coalesce(func.sum(models.Transaction.amount), 0))
            .join(models.Account)
            .filter(
                models.Account.household_id == household_id,
                models.Transaction.category_id == budget.category_id,
                models.Transaction.direction == models.TransactionDirection.debit,
                models.Transaction.date >= month_start,
                models.Transaction.date < month_end,
            )
            .scalar()
        )
        spent = float(spent or 0)
        limit = float(budget.amount_limit)
        if limit <= 0:
            continue
        pct = spent / limit
        category_name = budget.category.name if budget.category else "this category"

        if pct >= 1.0:
            note = _create_if_new(
                db,
                household_id,
                dedupe_key=f"budget:{budget.id}:{period_label}:exceeded",
                type=models.NotificationType.budget_exceeded,
                severity=models.NotificationSeverity.warning,
                title=f"Budget exceeded: {category_name}",
                message=f"You've spent ${spent:,.2f} of your ${limit:,.2f} {category_name} budget this month ({pct * 100:.0f}%).",
                related_entity_type="budget",
                related_entity_id=budget.id,
            )
            if note:
                created.append(note)
        elif pct >= settings.budget_warning_pct:
            note = _create_if_new(
                db,
                household_id,
                dedupe_key=f"budget:{budget.id}:{period_label}:warning",
                type=models.NotificationType.budget_exceeded,
                severity=models.NotificationSeverity.info,
                title=f"Approaching budget limit: {category_name}",
                message=f"You've used {pct * 100:.0f}% of your ${limit:,.2f} {category_name} budget this month (${spent:,.2f} spent).",
                related_entity_type="budget",
                related_entity_id=budget.id,
            )
            if note:
                created.append(note)
    return created


def check_goal_milestones(db: Session, household_id: str) -> list[models.Notification]:
    created = []
    goals = db.query(models.Goal).filter(models.Goal.household_id == household_id).all()
    for goal in goals:
        if float(goal.target_amount) <= 0:
            continue
        pct = (float(goal.current_amount) / float(goal.target_amount)) * 100
        reached = [m for m in MILESTONES if pct >= m and m > goal.last_milestone_pct]
        if not reached:
            continue
        milestone = max(reached)
        severity = models.NotificationSeverity.success if milestone == 100 else models.NotificationSeverity.info
        title = f"Goal complete: {goal.name}!" if milestone == 100 else f"{milestone}% of the way to {goal.name}"
        note = _create_if_new(
            db,
            household_id,
            dedupe_key=f"goal:{goal.id}:{milestone}",
            type=models.NotificationType.goal_milestone,
            severity=severity,
            title=title,
            message=f"{goal.name} is at ${float(goal.current_amount):,.2f} of ${float(goal.target_amount):,.2f} ({pct:.0f}%).",
            related_entity_type="goal",
            related_entity_id=goal.id,
        )
        goal.last_milestone_pct = milestone
        if note:
            created.append(note)
    return created


def check_upcoming_bills(db: Session, household_id: str) -> list[models.Notification]:
    created = []
    today = date.today()
    lead_days = settings.upcoming_bill_lead_days
    bills = (
        db.query(models.RecurringBill)
        .filter(models.RecurringBill.household_id == household_id, models.RecurringBill.is_active.is_(True))
        .all()
    )
    for bill in bills:
        try:
            due_date = today.replace(day=bill.due_day)
        except ValueError:
            continue
        if due_date < today:
            due_date = due_date + relativedelta(months=1)
        days_until = (due_date - today).days
        if days_until < 0 or days_until > lead_days:
            continue

        period_start = due_date - relativedelta(months=1)
        already_paid = (
            db.query(models.Transaction)
            .join(models.Account)
            .filter(
                models.Account.household_id == household_id,
                models.Transaction.direction == models.TransactionDirection.debit,
                models.Transaction.date >= period_start,
                models.Transaction.date <= due_date + timedelta(days=1),
                models.Transaction.amount >= float(bill.amount) * 0.85,
                models.Transaction.amount <= float(bill.amount) * 1.15,
                *([models.Transaction.category_id == bill.category_id] if bill.category_id else []),
            )
            .first()
        )
        if already_paid:
            continue

        note = _create_if_new(
            db,
            household_id,
            dedupe_key=f"bill:{bill.id}:{due_date.isoformat()}",
            type=models.NotificationType.bill_due,
            severity=models.NotificationSeverity.warning if days_until <= 1 else models.NotificationSeverity.info,
            title=f"{bill.name} due {('today' if days_until == 0 else f'in {days_until} days')}",
            message=f"${float(bill.amount):,.2f} for {bill.name} is due on {due_date.strftime('%b %d')}.",
            related_entity_type="recurring_bill",
            related_entity_id=bill.id,
        )
        if note:
            created.append(note)
    return created


def check_large_transactions(db: Session, household_id: str) -> list[models.Notification]:
    created = []
    threshold = settings.large_transaction_threshold
    since = date.today() - timedelta(days=2)
    txns = (
        db.query(models.Transaction)
        .join(models.Account)
        .filter(
            models.Account.household_id == household_id,
            models.Transaction.direction == models.TransactionDirection.debit,
            models.Transaction.amount >= threshold,
            models.Transaction.date >= since,
        )
        .all()
    )
    for txn in txns:
        note = _create_if_new(
            db,
            household_id,
            dedupe_key=f"large_txn:{txn.id}",
            type=models.NotificationType.large_transaction,
            severity=models.NotificationSeverity.info,
            title=f"Large transaction: ${float(txn.amount):,.2f}",
            message=f"{txn.name} on {txn.date.strftime('%b %d')} was ${float(txn.amount):,.2f}.",
            related_entity_type="transaction",
            related_entity_id=txn.id,
        )
        if note:
            created.append(note)
    return created


def check_idle_cash_opportunities(db: Session, household_id: str) -> list[models.Notification]:
    created = []
    threshold = settings.idle_cash_investment_threshold
    period_label = date.today().strftime("%Y-%m")
    savings_accounts = (
        db.query(models.Account)
        .filter(
            models.Account.household_id == household_id,
            models.Account.type == models.AccountType.savings,
            models.Account.current_balance >= threshold,
        )
        .all()
    )
    for account in savings_accounts:
        note = _create_if_new(
            db,
            household_id,
            dedupe_key=f"idle_cash:{account.id}:{period_label}",
            type=models.NotificationType.investment_opportunity,
            severity=models.NotificationSeverity.info,
            title=f"Idle cash in {account.name}",
            message=(
                f"{account.name} has ${float(account.current_balance):,.2f}, above your "
                f"${threshold:,.2f} idle-cash threshold. Once your emergency fund is covered, "
                f"consider moving the excess into an investment or high-yield account."
            ),
            related_entity_type="account",
            related_entity_id=account.id,
        )
        if note:
            created.append(note)
    return created


def check_credit_alerts(db: Session, household_id: str) -> list[models.Notification]:
    created = []
    period_label = date.today().strftime("%Y-%m")
    profiles = (
        db.query(models.CreditProfile)
        .join(models.User)
        .filter(models.User.household_id == household_id)
        .all()
    )
    for profile in profiles:
        if profile.utilization_pct is not None and float(profile.utilization_pct) > 30:
            note = _create_if_new(
                db,
                household_id,
                dedupe_key=f"credit_util:{profile.user_id}:{period_label}",
                type=models.NotificationType.credit_alert,
                severity=models.NotificationSeverity.warning,
                title=f"High credit utilization for {profile.user.full_name}",
                message=(
                    f"{profile.user.full_name}'s reported utilization is {float(profile.utilization_pct):.0f}%, "
                    "above the 30% level that most scoring models penalize. Paying down balances "
                    "before the statement closes date can help."
                ),
                related_entity_type="credit_profile",
                related_entity_id=profile.id,
            )
            if note:
                created.append(note)

        last_two = (
            db.query(models.CreditScoreHistory)
            .filter(models.CreditScoreHistory.user_id == profile.user_id)
            .order_by(models.CreditScoreHistory.recorded_date.desc())
            .limit(2)
            .all()
        )
        if len(last_two) == 2 and (last_two[1].score - last_two[0].score) >= 15:
            note = _create_if_new(
                db,
                household_id,
                dedupe_key=f"credit_drop:{profile.user_id}:{last_two[0].recorded_date.isoformat()}",
                type=models.NotificationType.credit_alert,
                severity=models.NotificationSeverity.warning,
                title=f"Credit score drop for {profile.user.full_name}",
                message=(
                    f"{profile.user.full_name}'s score fell from {last_two[1].score} to {last_two[0].score}. "
                    "Check for new derogatory marks, hard inquiries, or a spike in utilization."
                ),
                related_entity_type="credit_profile",
                related_entity_id=profile.id,
            )
            if note:
                created.append(note)
    return created


def run_all_checks(db: Session, household_id: str) -> list[models.Notification]:
    created: list[models.Notification] = []
    created += check_budget_overages(db, household_id)
    created += check_goal_milestones(db, household_id)
    created += check_upcoming_bills(db, household_id)
    created += check_large_transactions(db, household_id)
    created += check_idle_cash_opportunities(db, household_id)
    created += check_credit_alerts(db, household_id)
    db.commit()
    for note in created:
        db.refresh(note)
    return created
