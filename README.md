# Household Financial Dashboard

A private, two-person financial dashboard: accounts, transactions, budgets, savings/investment
goals, in-app notifications, bank/investment sync via Plaid, and a credit monitoring + borrowing
capacity module.

## Stack

It's a Firebase app:

- **Frontend** (`frontend/`): React + TypeScript (Vite), Tailwind CSS, TanStack Query, Recharts,
  react-plaid-link. Served by **Firebase Hosting**.
- **Data**: **Cloud Firestore**, read and written directly by the browser. `firestore.rules` limits
  each household's data to its members and validates what's written. The browser keeps an offline
  copy, so the app loads without a connection and syncs changes when it's back.
- **Sign-in**: **Firebase Authentication** (email and password).
- **Cloud Functions** (`functions/`, TypeScript): Plaid (linking banks and syncing them) and the
  notification checks, which run hourly and on "Check now". Plaid's secret and each bank's access
  token stay on the server; the browser never sees them.

Money is stored as whole cents (`*_cents` fields) so balances never drift from rounding.

## Features

- **Accounts**: manual accounts or bank/investment accounts linked live via Plaid.
- **Transactions**: manual entry or auto-imported from Plaid, with categorization.
- **Budgets**: per-category monthly limits with spend-so-far progress.
- **Goals**: savings / debt payoff / investment goals with milestone tracking (25/50/75/100%).
- **Recurring bills**: due-date tracking that raises a notification before a bill is due if no matching payment has posted.
- **Notifications** (in-app): budget overages, goal milestones, upcoming bills, large transactions,
  idle-cash investment nudges, bank-sync errors, and credit alerts. The checks run every hour in
  Cloud Functions; "Check now" also runs them on demand.
- **Credit & Loans**: manual/periodic credit-factor entry (score, utilization, on-time %, credit age,
  inquiries, derogatory marks) per household member, a score history chart, rule-based recommendations
  to improve the score, and a borrowing-capacity calculator that estimates mortgage, SBA-style business
  acquisition, and investment-property readiness from your income, debts, credit, and cash reserves.

  **This is not a credit bureau integration or financial advice.** A live score pull (e.g. Experian,
  Equifax, TransUnion) requires a paid third-party API (Array, Plaid's credit product, etc.) that isn't
  configured here - scores are entered manually (e.g. copied from a free monitoring site) or wired up
  later. The borrowing-capacity numbers are rule-of-thumb estimates (28/36 DTI guideline, standard
  amortization, typical down-payment norms), not a pre-approval.

## Putting it online

You need a Firebase project on the **Blaze** plan (Cloud Functions require it; for two people the
usage should stay within the free allowance), plus Node.js 22 on your computer.

1. **Set up the project** in the [Firebase console](https://console.firebase.google.com): create one or
   pick an existing one, then:
   - **Authentication** → Get started → **Email/Password** → enable.
   - **Firestore Database** → Create database (production mode; the rules come from this repo).
   - **Project settings** → General → Your apps → add a **Web app**, and copy its config values.
2. **Configure the web app**: copy `frontend/.env.example` to `frontend/.env.local` and fill in the
   values from step 1.
3. **Configure the functions**: copy `functions/.env.example` to `functions/.env` and set your
   `PLAID_CLIENT_ID`, `PLAID_ENV` (`sandbox` to try it with Plaid's test banks, `production` for real
   ones) and `TIME_ZONE`.
4. **Deploy**, from the repository root:
   ```bash
   (cd frontend && npm ci && npm run build)
   (cd functions && npm ci)
   npx --prefix frontend firebase login
   npx --prefix frontend firebase use --add          # pick your project
   npx --prefix frontend firebase functions:secrets:set PLAID_SECRET   # paste your Plaid secret
   npx --prefix frontend firebase deploy
   ```
   `firebase deploy` builds the web app and the functions first. It prints your app's address
   (`https://<project-id>.web.app`). After pulling changes, run `npm ci` in both folders again and
   redeploy.
5. **Create your household**: open the app, choose "Sign up", and create the household. The dashboard
   shows an **invite code**; your partner signs up with it to join the same household.
6. **Turn off sign-ups** once you've both joined, so nobody else can create an account:
   Authentication → Settings → User actions → uncheck "Enable create (sign-up)".
7. **Link your banks** on the Accounts page ("Link a bank account").

The notification checks and bank sync run every hour on their own; the Accounts and Notifications
pages also have buttons to run them now.

## Developing locally

Everything runs against the Firebase emulators on your computer, so you don't touch your real data.
The emulators need Java 11 or newer.

```bash
(cd functions && npm ci)
cd frontend && npm ci
npm run emulators         # terminal 1: Auth, Firestore and Functions emulators (UI at http://localhost:4000)
npm run dev:emulators     # terminal 2: the app at http://localhost:5173
```

To try Plaid locally, put `PLAID_CLIENT_ID` in `functions/.env` and `PLAID_SECRET=...` in
`functions/.secret.local` (git-ignored).

## Running the tests

```bash
cd frontend && npm test    # data layer, security rules and "Check now", against the emulators
cd functions && npm test   # notification rules and Plaid sync (with a stand-in for Plaid)
```

Both start the emulators themselves. GitHub Actions runs both suites on every push
(`.github/workflows/tests.yml`).

## Notable simplifications (MVP)

- Transfers between your own accounts (e.g. paying a credit card from checking) are recorded as two
  independent transactions and aren't automatically reconciled, so cash-flow totals can double-count
  transfers. Fine for balances/net worth (which are accurate), just a nuance for the income/expense totals.
- Credit scores and borrowing-capacity figures are estimates for household planning, not lending advice.
