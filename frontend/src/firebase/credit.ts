import { doc, getDoc, getDocs, query, serverTimestamp, where, writeBatch, type DocumentSnapshot } from "firebase/firestore";
import type {
  BorrowingCapacityOut,
  BorrowingCapacityRequest,
  CreditBureau,
  CreditProfile,
  CreditRecommendationsOut,
  CreditScoreHistoryPoint,
} from "../types";
import { db } from "./app";
import { computeBorrowingCapacity } from "./borrowingCapacity";
import { buildRecommendations, scoreBand } from "./creditAdvisor";
import { toDateString } from "./dates";
import { isLiabilityAccount } from "./finance";
import { HouseholdApi } from "./household";
import { AccountsApi } from "./ledger";
import { commit, householdCollection, isoString, snapshotData } from "./session";

// Each member's latest credit snapshot is stored at credit_profiles/{their user ID}, and
// every update also adds an entry to credit_score_history for the score chart.

function toProfile(snap: DocumentSnapshot): CreditProfile {
  const d = snapshotData(snap);
  return {
    id: snap.id,
    user_id: snap.id,
    bureau: d.bureau,
    score: d.score,
    utilization_pct: d.utilization_pct ?? null,
    on_time_payment_pct: d.on_time_payment_pct ?? null,
    credit_age_years: d.credit_age_years ?? null,
    num_hard_inquiries_12mo: d.num_hard_inquiries_12mo ?? null,
    num_open_accounts: d.num_open_accounts ?? null,
    num_derogatory_marks: d.num_derogatory_marks ?? null,
    updated_at: isoString(d.updated_at),
  };
}

type ProfileInput = Partial<Omit<CreditProfile, "id" | "user_id" | "updated_at">> & { recorded_date?: string };

function inRange(value: number | null | undefined, min: number, max: number, integer: boolean): boolean {
  return value == null || (value >= min && value <= max && (!integer || Number.isInteger(value)));
}

function validate(payload: ProfileInput): void {
  if (payload.score == null || !inRange(payload.score, 300, 850, true)) {
    throw new Error("Score must be a whole number from 300 to 850");
  }
  if (!inRange(payload.utilization_pct, 0, 100, false) || !inRange(payload.on_time_payment_pct, 0, 100, false)) {
    throw new Error("Percentages must be between 0 and 100");
  }
  if (!inRange(payload.credit_age_years, 0, Infinity, false)) throw new Error("Credit age can't be negative");
  for (const count of [payload.num_hard_inquiries_12mo, payload.num_open_accounts, payload.num_derogatory_marks]) {
    if (!inRange(count, 0, Infinity, true)) throw new Error("Counts must be whole numbers of 0 or more");
  }
}

async function requireMember(userId: string): Promise<void> {
  const member = await getDoc(doc(householdCollection("members"), userId));
  if (!member.exists()) throw new Error("Household member not found");
}

async function getProfile(userId: string): Promise<CreditProfile | null> {
  const snap = await getDoc(doc(householdCollection("credit_profiles"), userId));
  return snap.exists() ? toProfile(snap) : null;
}

export const CreditApi = {
  listProfiles: async (): Promise<CreditProfile[]> => {
    const snap = await getDocs(householdCollection("credit_profiles"));
    return snap.docs.map(toProfile);
  },

  /**
   * Replaces a member's credit snapshot (factors left out are cleared) and records the score
   * in their history, dated `recorded_date` or today. Any member can update anyone's.
   */
  upsertProfile: async (userId: string, payload: ProfileInput): Promise<CreditProfile> => {
    validate(payload);
    await requireMember(userId);
    const bureau: CreditBureau = payload.bureau ?? "other";
    const ref = doc(householdCollection("credit_profiles"), userId);

    const batch = writeBatch(db);
    batch.set(ref, {
      bureau,
      score: payload.score,
      utilization_pct: payload.utilization_pct ?? null,
      on_time_payment_pct: payload.on_time_payment_pct ?? null,
      credit_age_years: payload.credit_age_years ?? null,
      num_hard_inquiries_12mo: payload.num_hard_inquiries_12mo ?? null,
      num_open_accounts: payload.num_open_accounts ?? null,
      num_derogatory_marks: payload.num_derogatory_marks ?? null,
      updated_at: serverTimestamp(),
    });
    batch.set(doc(householdCollection("credit_score_history")), {
      user_id: userId,
      bureau,
      score: payload.score,
      recorded_date: payload.recorded_date || toDateString(new Date()),
      created_at: serverTimestamp(),
    });
    await commit(batch);
    return toProfile(await getDoc(ref));
  },

  /** Oldest first. */
  history: async (userId: string): Promise<CreditScoreHistoryPoint[]> => {
    await requireMember(userId);
    const snap = await getDocs(query(householdCollection("credit_score_history"), where("user_id", "==", userId)));
    return snap.docs
      .map((d) => ({ id: d.id, bureau: d.data().bureau, score: d.data().score, recorded_date: d.data().recorded_date }))
      .sort((a, b) => a.recorded_date.localeCompare(b.recorded_date));
  },

  recommendations: async (userId: string): Promise<CreditRecommendationsOut> => {
    await requireMember(userId);
    const profile = await getProfile(userId);
    if (!profile) throw new Error("No credit profile on file yet for this person");
    return {
      user_id: userId,
      score: profile.score,
      score_band: scoreBand(profile.score),
      recommendations: buildRecommendations(profile),
    };
  },

  /**
   * Estimates what the household could borrow, from its income (unless overridden), the
   * minimum payments on its credit card and loan accounts plus any extra debt, its checking
   * and savings balances (unless overridden), and the best credit score among its members.
   */
  borrowingCapacity: async (payload: BorrowingCapacityRequest = {}): Promise<BorrowingCapacityOut> => {
    const [household, accounts, profiles] = await Promise.all([HouseholdApi.get(), AccountsApi.list(), CreditApi.listProfiles()]);

    const debtFromAccounts = accounts
      .filter((a) => isLiabilityAccount(a.type))
      .reduce((sum, a) => sum + (a.monthly_payment ?? 0), 0);
    const liquidBalances = accounts
      .filter((a) => a.type === "checking" || a.type === "savings")
      .reduce((sum, a) => sum + a.current_balance, 0);

    return computeBorrowingCapacity({
      annualGrossIncome: payload.annual_gross_income || household.annual_gross_income || 0,
      monthlyDebtPayments: debtFromAccounts + (payload.extra_monthly_debt ?? 0),
      cashReserves: payload.cash_reserves_override ?? liquidBalances,
      bestCreditScore: profiles.length ? Math.max(...profiles.map((p) => p.score)) : null,
      interestRatePct: payload.interest_rate_pct ?? 6.5,
      termYears: payload.term_years ?? 30,
      downPaymentPct: payload.down_payment_pct ?? 20,
    });
  },
};
