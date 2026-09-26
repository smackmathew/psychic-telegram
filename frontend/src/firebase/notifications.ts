import { doc, getDoc, getDocs, limit, orderBy, query, where, writeBatch, type DocumentSnapshot } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import type { Notification } from "../types";
import { db, functions } from "./app";
import { toDateString } from "./dates";
import { commit, householdCollection, isoString, snapshotData } from "./session";

// Notifications are created by the notification checks, which run in Cloud Functions (see
// functions/src/notificationRules.ts) every hour and when someone presses "Check now". The
// app only reads them and marks them read.

function toNotification(snap: DocumentSnapshot): Notification {
  const d = snapshotData(snap);
  return {
    id: snap.id,
    type: d.type,
    severity: d.severity,
    title: d.title,
    message: d.message,
    is_read: d.is_read,
    related_entity_type: d.related_entity_type ?? null,
    related_entity_id: d.related_entity_id ?? null,
    created_at: isoString(d.created_at),
  };
}

const runChecksCallable = httpsCallable<{ today: string }, Notification[]>(functions, "runChecks");

export const NotificationsApi = {
  /** The 50 most recent, newest first. */
  list: async (unreadOnly = false): Promise<Notification[]> => {
    const notifications = householdCollection("notifications");
    const snap = await getDocs(
      unreadOnly
        ? query(notifications, where("is_read", "==", false), orderBy("created_at", "desc"), limit(50))
        : query(notifications, orderBy("created_at", "desc"), limit(50)),
    );
    return snap.docs.map(toNotification);
  },

  markRead: async (id: string): Promise<Notification> => {
    const ref = doc(householdCollection("notifications"), id);
    const batch = writeBatch(db);
    batch.update(ref, { is_read: true });
    await commit(batch);
    return toNotification(await getDoc(ref));
  },

  markAllRead: async (): Promise<void> => {
    const unread = await getDocs(query(householdCollection("notifications"), where("is_read", "==", false)));
    const batch = writeBatch(db);
    unread.docs.forEach((d) => batch.update(d.ref, { is_read: true }));
    await commit(batch);
  },

  /** Runs the checks now; returns the notifications that were created. */
  runChecks: async (): Promise<Notification[]> => {
    // Send the browser's date, so "due today" means today where you are.
    const result = await runChecksCallable({ today: toDateString(new Date()) });
    return result.data;
  },
};
