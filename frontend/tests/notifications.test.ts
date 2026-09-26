// Goes through the real "Check now" path: the app calls the runChecks Cloud Function (in the
// Functions emulator), which writes notifications that the app then reads and marks read.
import { beforeEach, describe, expect, it } from "vitest";
import { dashboardSummary } from "../src/firebase/dashboard";
import { NotificationsApi } from "../src/firebase/notifications";
import { PlaidApi } from "../src/firebase/plaid";
import { GoalsApi } from "../src/firebase/planning";
import { createAccount, signUpNewHousehold } from "./helpers";

beforeEach(async () => {
  await signUpNewHousehold();
});

describe("notifications", () => {
  it("are created by Check now, and can be read one at a time or all at once", async () => {
    await createAccount({ name: "HYSA", type: "savings", current_balance: 15_000 });
    await GoalsApi.create({ name: "Trip", type: "savings", target_amount: 100, current_amount: 100 });

    const created = await NotificationsApi.runChecks();
    expect(created.map((n) => n.title).sort()).toEqual(["Goal complete: Trip!", "Idle cash in HYSA"]);
    expect(await NotificationsApi.runChecks()).toEqual([]); // each event is announced once

    expect((await dashboardSummary()).unread_notifications).toBe(2);
    const [first, second] = await NotificationsApi.list();
    expect((await NotificationsApi.markRead(first.id)).is_read).toBe(true);
    expect((await NotificationsApi.list(true)).map((n) => n.id)).toEqual([second.id]);

    await NotificationsApi.markAllRead();
    expect(await NotificationsApi.list(true)).toEqual([]);
    expect(await NotificationsApi.list()).toHaveLength(2);
  });

  it("lists newest first", async () => {
    await GoalsApi.create({ name: "Trip", type: "savings", target_amount: 100, current_amount: 30 });
    await NotificationsApi.runChecks();
    await createAccount({ name: "HYSA", type: "savings", current_balance: 15_000 });
    await NotificationsApi.runChecks();
    expect((await NotificationsApi.list()).map((n) => n.title)).toEqual(["Idle cash in HYSA", "25% of the way to Trip"]);
  });
});

describe("Plaid", () => {
  it("reports that it's off until the functions are given Plaid keys", async () => {
    expect(await PlaidApi.status()).toEqual({ enabled: false, environment: "sandbox" });
    await expect(PlaidApi.createLinkToken()).rejects.toThrow("Plaid isn't configured yet");
  });
});
