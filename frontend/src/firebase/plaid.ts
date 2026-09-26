import { httpsCallable } from "firebase/functions";
import { functions } from "./app";

// Plaid runs in Cloud Functions (functions/src/plaidSync.ts): its secret and each bank's
// access token never reach the browser.

const call = <Req, Res>(name: string) => {
  const callable = httpsCallable<Req, Res>(functions, name);
  return async (data: Req) => (await callable(data)).data;
};

const status = call<void, { enabled: boolean; environment: string }>("plaidStatus");
const createLinkToken = call<void, { link_token: string }>("plaidCreateLinkToken");
const exchange = call<{ public_token: string; institution_name?: string }, { account_ids: string[] }>("plaidExchangePublicToken");
const sync = call<void, void>("plaidSync");

export const PlaidApi = {
  status: () => status(),
  createLinkToken: () => createLinkToken(),
  exchangePublicToken: (public_token: string, institution_name?: string) => exchange({ public_token, institution_name }),
  sync: () => sync(),
};
