import { signOut } from "firebase/auth";
import { describe, expect, it } from "vitest";
import { auth } from "../src/firebase/app";
import { AuthApi, HouseholdApi } from "../src/firebase/household";
import { AccountsApi } from "../src/firebase/ledger";
import { createAccount, signUpNewHousehold } from "./helpers";

describe("sign-up and households", () => {
  it("creates a household for a new user", async () => {
    const { user } = await signUpNewHousehold("Alex");
    expect(user.full_name).toBe("Alex");

    const household = await HouseholdApi.get();
    expect(household.name).toBe("Test Household");
    expect(household.invite_code).toMatch(/^[A-Z2-9]{8}$/);
    expect((await HouseholdApi.members()).map((m) => m.full_name)).toEqual(["Alex"]);
  });

  it("lets a partner join with the invite code and share the same data", async () => {
    const { user: alex, email: alexEmail } = await signUpNewHousehold("Alex");
    const { invite_code } = await HouseholdApi.get();
    const account = await createAccount({ name: "Joint checking" });

    const sam = await AuthApi.signup({
      full_name: "Sam",
      email: `sam${Date.now()}@example.com`,
      password: "password123",
      invite_code: invite_code.toLowerCase(), // codes are case-insensitive
    });
    expect(sam.household_id).toBe(alex.household_id);
    expect((await AccountsApi.list()).map((a) => a.id)).toEqual([account.id]);
    expect((await HouseholdApi.members()).map((m) => m.full_name).sort()).toEqual(["Alex", "Sam"]);

    // And Alex sees what Sam adds.
    await createAccount({ name: "Sam's savings", type: "savings" });
    await AuthApi.login(alexEmail, "password123");
    expect((await AccountsApi.list()).map((a) => a.name)).toEqual(["Joint checking", "Sam's savings"]);
  });

  it("rejects an invalid invite code but leaves the account able to finish setup", async () => {
    const email = `nobody${Date.now()}@example.com`;
    await expect(
      AuthApi.signup({ full_name: "Nobody", email, password: "password123", invite_code: "WRONGCODE" }),
    ).rejects.toThrow("Invalid invite code");

    expect(await AuthApi.login(email, "password123")).toBeNull(); // signed in, no household yet
  });

  it("gives friendly errors for bad logins and duplicate emails", async () => {
    const { email } = await signUpNewHousehold();
    await expect(AuthApi.login(email, "wrong-password")).rejects.toThrow("Incorrect email or password");
    await expect(
      AuthApi.signup({ full_name: "Again", email, password: "password123", household_name: "Dup" }),
    ).rejects.toThrow("Email already registered");
  });

  it("updates the household name and income", async () => {
    await signUpNewHousehold();
    const updated = await HouseholdApi.update({ name: "Renamed", annual_gross_income: 150000.5 });
    expect(updated.name).toBe("Renamed");
    expect(updated.annual_gross_income).toBe(150000.5);
  });

  it("scopes data to the signed-in household", async () => {
    await signUpNewHousehold("Alex");
    await createAccount({ name: "Alex's account" });
    await signOut(auth);

    await signUpNewHousehold("Other");
    expect(await AccountsApi.list()).toEqual([]);
  });
});
