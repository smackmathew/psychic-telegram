# Household Financial Dashboard

A private, two-person financial dashboard: accounts, transactions, budgets, savings/investment
goals, in-app notifications, bank/investment sync via Plaid, and a credit monitoring + borrowing
capacity module.

## Stack

- **Backend**: FastAPI + SQLAlchemy + Postgres, JWT auth, APScheduler for background sync/checks, Plaid SDK.
- **Frontend**: React + TypeScript (Vite), Tailwind CSS, TanStack Query, Recharts, react-plaid-link.

## Features

- **Accounts**: manual accounts or bank/investment accounts linked live via Plaid.
- **Transactions**: manual entry or auto-imported from Plaid, with categorization.
- **Budgets**: per-category monthly limits with spend-so-far progress.
- **Goals**: savings / debt payoff / investment goals with milestone tracking (25/50/75/100%).
- **Recurring bills**: due-date tracking that raises a notification before a bill is due if no matching payment has posted.
- **Notifications** (in-app): budget overages, goal milestones, upcoming bills, large transactions,
  idle-cash investment nudges, bank-sync errors, and credit alerts. A background job runs the rule
  engine automatically (see `SCHEDULER_INTERVAL_MINUTES`); "Check now" also triggers it on demand.
- **Credit & Loans**: manual/periodic credit-factor entry (score, utilization, on-time %, credit age,
  inquiries, derogatory marks) per household member, a score history chart, rule-based recommendations
  to improve the score, and a borrowing-capacity calculator that estimates mortgage, SBA-style business
  acquisition, and investment-property readiness from your income, debts, credit, and cash reserves.

  **This is not a credit bureau integration or financial advice.** A live score pull (e.g. Experian,
  Equifax, TransUnion) requires a paid third-party API (Array, Plaid's credit product, etc.) that isn't
  configured here - scores are entered manually (e.g. copied from a free monitoring site) or wired up
  later. The borrowing-capacity numbers are rule-of-thumb estimates (28/36 DTI guideline, standard
  amortization, typical down-payment norms), not a pre-approval.

## Running it locally

### Option A: Docker Compose (recommended)

```bash
cp backend/.env.example backend/.env   # fill in a real SECRET_KEY, optionally Plaid keys
docker compose up --build
```

Then create your two household accounts:

```bash
docker compose exec backend python -m app.seed \
  --household-name "Our Household" \
  --user1-name "Your Name" --user1-email you@example.com --user1-password "..." \
  --user2-name "Partner's Name" --user2-email partner@example.com --user2-password "..."
```

- Backend: http://localhost:8000 (docs at `/docs`)
- Frontend: http://localhost:5173

### Option B: Run manually

Backend:
```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # edit DATABASE_URL to point at your own Postgres
uvicorn app.main:app --reload
python -m app.seed --household-name "..." --user1-name "..." --user1-email "..." --user1-password "..." --user2-name "..." --user2-email "..." --user2-password "..."
```

Frontend:
```bash
cd frontend
npm install
npm run dev
```

## Enabling bank/investment sync (Plaid)

1. Create a free Plaid developer account and get a Client ID + **sandbox** secret.
2. Set `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV=sandbox` in `backend/.env`.
3. Restart the backend. The "Link a bank account" button on the Accounts page will now work
   (Plaid's sandbox lets you use test credentials like `user_good` / `pass_good`).
4. When ready for real accounts, apply for Production access in the Plaid dashboard and switch
   `PLAID_ENV=production` with your production secret.

Without Plaid keys, the app still works fully with manually-entered accounts and transactions.

## Notable simplifications (MVP)

- No database migrations yet - tables are created automatically on startup (`Base.metadata.create_all`).
  Add Alembic if you need to evolve the schema without dropping data later.
- Transfers between your own accounts (e.g. paying a credit card from checking) are recorded as two
  independent transactions and aren't automatically reconciled, so cash-flow totals can double-count
  transfers. Fine for balances/net worth (which are accurate), just a nuance for the income/expense totals.
- Credit scores and borrowing-capacity figures are estimates for household planning, not lending advice.
