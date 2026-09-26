import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  type User as FirebaseUser,
} from "firebase/auth";
import { arrayUnion, collection, doc, getDoc, getDocs, serverTimestamp, writeBatch } from "firebase/firestore";
import type { CategoryType, Household, User } from "../types";
import { auth, db } from "./app";
import { fromCentsOrNull, toCentsOrNull } from "./money";
import { commit, householdCollection, householdDoc, householdId, setCurrentHousehold, snapshotData } from "./session";

const DEFAULT_CATEGORIES: [string, CategoryType][] = [
  ["Salary", "income"],
  ["Bonus", "income"],
  ["Investment Income", "income"],
  ["Other Income", "income"],
  ["Groceries", "expense"],
  ["Dining Out", "expense"],
  ["Housing", "expense"],
  ["Utilities", "expense"],
  ["Transportation", "expense"],
  ["Insurance", "expense"],
  ["Healthcare", "expense"],
  ["Childcare", "expense"],
  ["Entertainment", "expense"],
  ["Shopping", "expense"],
  ["Subscriptions", "expense"],
  ["Travel", "expense"],
  ["Debt Payments", "expense"],
  ["Savings Transfer", "expense"],
  ["Investment Contribution", "expense"],
  ["Miscellaneous", "expense"],
];

// No 0/O or 1/I, so a code read aloud or copied by hand comes through intact.
const INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function newInviteCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => INVITE_ALPHABET[b % INVITE_ALPHABET.length]).join("");
}

export class AuthError extends Error {}

function friendlyAuthError(error: unknown): Error {
  const code = (error as { code?: string })?.code;
  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return new AuthError("Incorrect email or password");
    case "auth/email-already-in-use":
      return new AuthError("Email already registered");
    case "auth/weak-password":
      return new AuthError("Password must be at least 8 characters");
    case "auth/admin-restricted-operation":
      return new AuthError("Sign-up is turned off for this app");
    default:
      return error instanceof Error ? error : new Error(String(error));
  }
}

/**
 * Loads the signed-in user's profile and scopes data calls to their household.
 * Returns null when the user has an account but hasn't created or joined a household yet.
 */
export async function loadProfile(firebaseUser: FirebaseUser): Promise<User | null> {
  const pointer = await getDoc(doc(db, "users", firebaseUser.uid));
  const hid = pointer.data()?.household_id as string | undefined;
  if (!hid) {
    setCurrentHousehold(null);
    return null;
  }
  const member = await getDoc(doc(db, "households", hid, "members", firebaseUser.uid));
  setCurrentHousehold(hid);
  return {
    id: firebaseUser.uid,
    email: firebaseUser.email ?? "",
    full_name: (member.data()?.full_name as string | undefined) ?? firebaseUser.email ?? "",
    household_id: hid,
  };
}

function currentFirebaseUser(): FirebaseUser {
  if (!auth.currentUser) throw new AuthError("Not signed in");
  return auth.currentUser;
}

/** Creates a household with the signed-in user as its first member, plus the default categories. */
export async function createHousehold(fullName: string, householdName?: string): Promise<User> {
  const user = currentFirebaseUser();
  const inviteCode = newInviteCode();
  const householdRef = doc(collection(db, "households"));
  const batch = writeBatch(db);
  batch.set(householdRef, {
    name: householdName?.trim() || `${fullName}'s Household`,
    member_ids: [user.uid],
    invite_code: inviteCode,
    annual_gross_income_cents: null,
    created_at: serverTimestamp(),
  });
  batch.set(doc(db, "invites", inviteCode), { household_id: householdRef.id });
  batch.set(doc(db, "users", user.uid), { household_id: householdRef.id });
  batch.set(doc(householdRef, "members", user.uid), { full_name: fullName, email: user.email ?? "" });
  for (const [name, type] of DEFAULT_CATEGORIES) {
    batch.set(doc(collection(householdRef, "categories")), {
      name,
      type,
      icon: null,
      is_default: true,
    });
  }
  await commit(batch);
  return (await loadProfile(user))!;
}

/** Adds the signed-in user to the household that owns `inviteCode`. */
export async function joinHousehold(fullName: string, inviteCode: string): Promise<User> {
  const user = currentFirebaseUser();
  const code = inviteCode.trim().toUpperCase();
  const invite = await getDoc(doc(db, "invites", code));
  const hid = invite.data()?.household_id as string | undefined;
  if (!hid) throw new AuthError("Invalid invite code");

  const householdRef = doc(db, "households", hid);
  const batch = writeBatch(db);
  batch.update(householdRef, { member_ids: arrayUnion(user.uid), join_code: code });
  batch.set(doc(db, "users", user.uid), { household_id: hid });
  batch.set(doc(householdRef, "members", user.uid), { full_name: fullName, email: user.email ?? "" });
  await commit(batch);
  return (await loadProfile(user))!;
}

export const AuthApi = {
  /** Signs in. Resolves to null if the account has no household yet. */
  login: async (email: string, password: string): Promise<User | null> => {
    try {
      const { user } = await signInWithEmailAndPassword(auth, email, password);
      return await loadProfile(user);
    } catch (error) {
      throw friendlyAuthError(error);
    }
  },

  /** Creates the account, then creates a household or joins one with an invite code. */
  signup: async (payload: {
    full_name: string;
    email: string;
    password: string;
    household_name?: string;
    invite_code?: string;
  }): Promise<User> => {
    try {
      await createUserWithEmailAndPassword(auth, payload.email, payload.password);
    } catch (error) {
      throw friendlyAuthError(error);
    }
    return setUpHousehold(payload);
  },

  logout: async (): Promise<void> => {
    setCurrentHousehold(null);
    await firebaseSignOut(auth);
  },
};

/** Finishes setup for a signed-in user with no household: joins one if given a code, else creates one. */
export function setUpHousehold(payload: { full_name: string; household_name?: string; invite_code?: string }): Promise<User> {
  return payload.invite_code?.trim()
    ? joinHousehold(payload.full_name, payload.invite_code)
    : createHousehold(payload.full_name, payload.household_name);
}

export const HouseholdApi = {
  get: async (): Promise<Household> => {
    const snap = await getDoc(householdDoc());
    const data = snapshotData(snap);
    return {
      id: snap.id,
      name: data.name,
      invite_code: data.invite_code,
      annual_gross_income: fromCentsOrNull(data.annual_gross_income_cents),
    };
  },

  update: async (payload: Partial<Pick<Household, "name" | "annual_gross_income">>): Promise<Household> => {
    const changes: Record<string, unknown> = {};
    if (payload.name !== undefined) changes.name = payload.name;
    if (payload.annual_gross_income !== undefined) {
      changes.annual_gross_income_cents = toCentsOrNull(payload.annual_gross_income);
    }
    const batch = writeBatch(db);
    batch.update(householdDoc(), changes);
    await commit(batch);
    return HouseholdApi.get();
  },

  members: async (): Promise<User[]> => {
    const snap = await getDocs(householdCollection("members"));
    return snap.docs.map((d) => ({
      id: d.id,
      email: d.data().email,
      full_name: d.data().full_name,
      household_id: householdId(),
    }));
  },
};
