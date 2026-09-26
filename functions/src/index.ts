import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { defineSecret, defineString } from "firebase-functions/params";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { todayIn } from "./dates.js";
import { householdIdForUser, runChecksForHousehold } from "./household.js";
import { createLinkToken, createPlaidClient, linkItem, syncHousehold } from "./plaidSync.js";

initializeApp();
const db = getFirestore();

// Set in functions/.env (see functions/.env.example); the secret with
// `firebase functions:secrets:set PLAID_SECRET`.
const plaidClientId = defineString("PLAID_CLIENT_ID", { default: "" });
const plaidEnv = defineString("PLAID_ENV", { default: "sandbox" });
const plaidSecret = defineSecret("PLAID_SECRET");
// The household's time zone, so "today" (for bills due and the like) matches your calendar.
const timeZone = defineString("TIME_ZONE", { default: "America/New_York" });

const plaidEnabled = () => plaidClientId.value() !== "";
const plaid = () => createPlaidClient(plaidClientId.value(), plaidSecret.value(), plaidEnv.value());

async function callerHousehold(request: CallableRequest): Promise<string> {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in first");
  const householdId = await householdIdForUser(db, request.auth.uid);
  if (!householdId) throw new HttpsError("failed-precondition", "Create or join a household first");
  return householdId;
}

function requirePlaid(): void {
  if (!plaidEnabled()) {
    throw new HttpsError("failed-precondition", "Plaid isn't configured yet. Set PLAID_CLIENT_ID and PLAID_SECRET for the functions.");
  }
}

/** Runs the notification checks now for the caller's household. */
export const runChecks = onCall(async (request) => {
  const householdId = await callerHousehold(request);
  // The browser sends its own date, so "today" is the caller's today.
  const today = typeof request.data?.today === "string" ? request.data.today : todayIn(timeZone.value());
  return runChecksForHousehold(db, householdId, today);
});

export const plaidStatus = onCall(async (request) => {
  await callerHousehold(request);
  return { enabled: plaidEnabled(), environment: plaidEnv.value() };
});

export const plaidCreateLinkToken = onCall({ secrets: [plaidSecret] }, async (request) => {
  await callerHousehold(request);
  requirePlaid();
  return { link_token: await createLinkToken(plaid(), request.auth!.uid) };
});

export const plaidExchangePublicToken = onCall({ secrets: [plaidSecret] }, async (request) => {
  const householdId = await callerHousehold(request);
  requirePlaid();
  const { public_token, institution_name } = request.data ?? {};
  if (typeof public_token !== "string") throw new HttpsError("invalid-argument", "public_token is required");
  return { account_ids: await linkItem(db, plaid(), householdId, public_token, institution_name ?? null) };
});

export const plaidSync = onCall({ secrets: [plaidSecret] }, async (request) => {
  const householdId = await callerHousehold(request);
  requirePlaid();
  await syncHousehold(db, plaid(), householdId);
});

/** Every hour: sync every household's banks, then run its notification checks. */
export const hourlySyncAndChecks = onSchedule({ schedule: "every 60 minutes", secrets: [plaidSecret] }, async () => {
  const today = todayIn(timeZone.value());
  const households = await db.collection("households").select().get();
  for (const household of households.docs) {
    try {
      if (plaidEnabled()) await syncHousehold(db, plaid(), household.id);
      await runChecksForHousehold(db, household.id, today);
    } catch (error) {
      logger.error(`Sync/notification check failed for household ${household.id}`, error);
    }
  }
});
