import {
  collection,
  doc,
  type DocumentData,
  type DocumentSnapshot,
  type Timestamp,
  type WriteBatch,
} from "firebase/firestore";
import { db } from "./app";

// The signed-in user's household, set at sign-in. Every data call is scoped to it.
let currentHouseholdId: string | null = null;

export function setCurrentHousehold(householdId: string | null): void {
  currentHouseholdId = householdId;
}

export function householdId(): string {
  if (!currentHouseholdId) {
    throw new Error("Not signed in to a household");
  }
  return currentHouseholdId;
}

export function householdDoc() {
  return doc(db, "households", householdId());
}

export function householdCollection(name: string) {
  return collection(db, "households", householdId(), name);
}

/** Document data with pending server timestamps filled in with a local estimate. */
export function snapshotData(snap: DocumentSnapshot): DocumentData {
  return snap.data({ serverTimestamps: "estimate" }) ?? {};
}

export function isoString(value: Timestamp | null | undefined): string {
  return (value ? value.toDate() : new Date()).toISOString();
}

/**
 * Commits a batch. Online, waits for the server so errors (such as a rejected write) reach
 * the caller. Offline, returns right away: the write is already applied to the local cache
 * and syncs when the connection returns, so the UI shouldn't sit waiting on it.
 */
export async function commit(batch: WriteBatch): Promise<void> {
  const pending = batch.commit();
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    pending.catch((error) => console.error("Offline change was rejected when it synced", error));
    return;
  }
  await pending;
}
