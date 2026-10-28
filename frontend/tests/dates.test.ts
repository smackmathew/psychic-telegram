// Run in a US time zone: the date bugs these guard against don't show up in UTC, where CI runs.
process.env.TZ = "America/New_York";

import { describe, expect, it } from "vitest";
import { daysBetween, nextDueDate } from "../src/firebase/dates";
import { formatDate, ordinal } from "../src/utils/format";

describe("nextDueDate", () => {
  it.each([
    [12, "2026-03-10", "2026-03-12"], // later this month
    [10, "2026-03-10", "2026-03-10"], // due today
    [9, "2026-03-10", "2026-04-09"], // already passed: next month
    [1, "2026-12-15", "2027-01-01"], // rolls into next year
    [28, "2026-02-28", "2026-02-28"],
  ])("a bill due on day %d, seen on %s, is next due %s", (dueDay, today, expected) => {
    expect(nextDueDate(dueDay, today)).toBe(expected);
  });
});

describe("daysBetween", () => {
  it.each([
    ["2026-03-10", "2026-03-10", 0],
    ["2026-03-10", "2026-03-12", 2],
    ["2026-03-30", "2026-04-01", 2],
    ["2026-03-07", "2026-03-09", 2], // across the US daylight-saving change
    ["2026-03-12", "2026-03-10", -2],
  ])("from %s to %s is %d days", (from, to, expected) => {
    expect(daysBetween(from, to)).toBe(expected);
  });
});

describe("ordinal", () => {
  it.each([
    [1, "1st"], [2, "2nd"], [3, "3rd"], [4, "4th"], [11, "11th"], [12, "12th"], [13, "13th"],
    [21, "21st"], [22, "22nd"], [23, "23rd"], [28, "28th"],
  ])("%d -> %s", (n, expected) => {
    expect(ordinal(n)).toBe(expected);
  });
});

describe("formatDate", () => {
  it("reads a date-only string as a local date, not UTC midnight", () => {
    expect(formatDate("2026-03-10")).toBe("Mar 10, 2026");
    expect(formatDate("2026-01-01")).toBe("Jan 1, 2026");
  });

  it("still formats full timestamps", () => {
    expect(formatDate(new Date(2026, 2, 10, 15, 30).toISOString())).toBe("Mar 10, 2026");
  });
});
