import type { CreditProfile, CreditRecommendation } from "../types";

export function scoreBand(score: number): string {
  if (score >= 800) return "Exceptional";
  if (score >= 740) return "Very Good";
  if (score >= 670) return "Good";
  if (score >= 580) return "Fair";
  return "Poor";
}

type ProfileFactors = Pick<
  CreditProfile,
  | "score"
  | "utilization_pct"
  | "on_time_payment_pct"
  | "credit_age_years"
  | "num_hard_inquiries_12mo"
  | "num_open_accounts"
  | "num_derogatory_marks"
>;

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 } as const;

/** Rule-based suggestions for improving a score, most important first. */
export function buildRecommendations(profile: Partial<ProfileFactors> & { score: number }): CreditRecommendation[] {
  const recs: CreditRecommendation[] = [];
  const { utilization_pct, on_time_payment_pct, num_derogatory_marks, num_hard_inquiries_12mo, credit_age_years, num_open_accounts } =
    profile;

  if (utilization_pct != null) {
    if (utilization_pct > 30) {
      recs.push({
        title: "Pay down revolving balances",
        detail:
          `Utilization is ${Math.round(utilization_pct)}%. Amounts owed make up ~30% of a ` +
          "FICO score, and scores are penalized once utilization crosses ~30%. Paying balances " +
          "before the statement closing date (not just the due date) usually helps fastest.",
        priority: "high",
      });
    } else if (utilization_pct > 10) {
      recs.push({
        title: "Push utilization under 10%",
        detail: "You're in reasonable shape, but the very best scores typically keep utilization under 10%.",
        priority: "medium",
      });
    }
  }

  if (on_time_payment_pct != null && on_time_payment_pct < 100) {
    recs.push({
      title: "Set up autopay for at least the minimum due",
      detail:
        "Payment history is the single largest factor (~35%) in most credit scores. Even one " +
        "30-day-late payment can cause a significant drop.",
      priority: "high",
    });
  }

  if (num_derogatory_marks) {
    recs.push({
      title: "Resolve derogatory marks",
      detail:
        `${num_derogatory_marks} derogatory mark(s) on file. Paying off collections, ` +
        "negotiating a pay-for-delete, or disputing inaccurate items can meaningfully raise your score.",
      priority: "high",
    });
  }

  if (num_hard_inquiries_12mo != null && num_hard_inquiries_12mo > 2) {
    recs.push({
      title: "Slow down on new credit applications",
      detail:
        `${num_hard_inquiries_12mo} hard inquiries in the last 12 months. Each one has a ` +
        "small, temporary impact, but several in a short window signal risk to lenders.",
      priority: "medium",
    });
  }

  if (credit_age_years != null && credit_age_years < 3) {
    recs.push({
      title: "Keep your oldest accounts open",
      detail: "Average account age is still building. Closing your oldest card can shorten your history and hurt scores.",
      priority: "low",
    });
  }

  if (num_open_accounts != null && num_open_accounts < 2) {
    recs.push({
      title: "Build a healthy credit mix over time",
      detail:
        "Lenders like to see a track record across a couple of account types (e.g. a card plus an installment loan), managed responsibly.",
      priority: "low",
    });
  }

  if (profile.score < 670) {
    recs.push({
      title: "Consider a secured card or credit-builder loan",
      detail:
        "If you're rebuilding, a secured card or credit-builder loan reported to all three bureaus is one of the fastest, lowest-risk ways to add positive history.",
      priority: "medium",
    });
  }

  if (recs.length === 0) {
    recs.push({
      title: "You're in great shape",
      detail: "No red flags in what you've entered. Keep utilization low, pay on time, and avoid unnecessary new accounts.",
      priority: "low",
    });
  }

  // Array.prototype.sort is stable, so recommendations of equal priority keep their order.
  return recs.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
}
