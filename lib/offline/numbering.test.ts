import { describe, expect, it } from "vitest";
import { fixtureDevice, uuidOf } from "./fixtures";
import { bumpPast, compareNumbers, issueNumber, NumberingError, peekNumber, reconcileCounters, release, reserve, RESERVATION_MAX_AGE_MS, takeForQueue } from "./numbering";

describe("device bill numbers", () => {
  it("formats PREFIX/FY/SEQ padded to five digits", () => {
    expect(peekNumber("C1", {}, "2026-11-13").number).toBe("C1/2627/00001");
    expect(peekNumber("c1", { "2627": 42 }, "2026-11-13").number).toBe("C1/2627/00042");
    expect(peekNumber("A", { "2627": 123456 }, "2026-11-13").number).toBe("A/2627/123456");
  });

  it("issues consecutive numbers and advances only that year's counter", () => {
    const first = issueNumber("C1", {}, "2026-11-13");
    const second = issueNumber("C1", first.counters, "2026-11-13");
    expect([first.issue.number, second.issue.number]).toEqual(["C1/2627/00001", "C1/2627/00002"]);
    expect(second.counters).toEqual({ "2627": 3 });
  });

  it("starts again at 00001 when the financial year changes on 1 April (IST)", () => {
    const counters = { "2627": 918 };
    expect(peekNumber("C1", counters, "2027-03-31").number).toBe("C1/2627/00918");
    const april = issueNumber("C1", counters, "2027-04-01");
    expect(april.issue).toEqual({ number: "C1/2728/00001", fy: "2728", sequence: 1 });
    // Last year's counter is untouched, so a late bill dated in March still continues that series.
    expect(april.counters).toEqual({ "2627": 918, "2728": 2 });
  });

  it("refuses to issue a number longer than 16 characters", () => {
    // ABCD/2627/ leaves 6 digits.
    expect(peekNumber("ABCD", { "2627": 999_999 }, "2026-11-13").number).toBe("ABCD/2627/999999");
    expect(() => peekNumber("ABCD", { "2627": 1_000_000 }, "2026-11-13")).toThrow(NumberingError);
  });
});

describe("reconciling with the server", () => {
  it("takes the larger of local and server per year, never moving backwards", () => {
    const merged = reconcileCounters({ "2627": 10, "2526": 400 }, [
      { fy: "2627", next: 25 },
      { fy: "2526", next: 300 },
      { fy: "2728", next: 3 },
    ]);
    expect(merged).toEqual({ "2627": 25, "2526": 400, "2728": 3 });
  });

  it("ignores rows that make no sense", () => {
    expect(reconcileCounters({ "2627": 5 }, [{ fy: "26-27", next: 99 }, { fy: "2627", next: 0 }, { fy: "2627", next: Number.NaN }])).toEqual({ "2627": 5 });
  });

  it("moves past a number that turned out to be taken", () => {
    expect(bumpPast({ "2627": 7 }, "C1/2627/00009")).toEqual({ "2627": 10 });
    expect(bumpPast({ "2627": 20 }, "C1/2627/00009")).toEqual({ "2627": 20 });
    expect(bumpPast({ "2627": 7 }, "not a number")).toEqual({ "2627": 7 });
  });
});

describe("reservations for online posts", () => {
  const date = "2026-11-13";

  it("gives the same bill the same number on every retry", () => {
    const a = reserve(fixtureDevice(), uuidOf(1), date, 1000);
    const again = reserve(a.device, uuidOf(1), date, 2000);
    const other = reserve(again.device, uuidOf(2), date, 3000);
    expect(a.issue.number).toBe("C1/2627/00001");
    expect(again.issue.number).toBe("C1/2627/00001");
    expect(other.issue.number).toBe("C1/2627/00002");
    expect(other.device.counters).toEqual({ "2627": 3 });
  });

  it("issues a fresh number when asked to, or when the year has changed since", () => {
    const a = reserve(fixtureDevice(), uuidOf(1), "2027-03-31", 1000);
    const fresh = reserve(a.device, uuidOf(1), "2027-03-31", 1001, { fresh: true });
    expect(fresh.issue.number).toBe("C1/2627/00002");
    const nextYear = reserve(fresh.device, uuidOf(1), "2027-04-01", 1002);
    expect(nextYear.issue.number).toBe("C1/2728/00001");
  });

  it("steps the counter back when a rejected bill held the last number, leaving no gap", () => {
    const a = reserve(fixtureDevice(), uuidOf(1), date, 1000);
    const released = release(a.device, uuidOf(1), false);
    expect(released.counters).toEqual({ "2627": 1 });
    expect(released.reservations).toEqual({});
  });

  it("does not step back when a later number was issued, or when the number was used", () => {
    const a = reserve(fixtureDevice(), uuidOf(1), date, 1000);
    const b = reserve(a.device, uuidOf(2), date, 1001);
    expect(release(b.device, uuidOf(1), false).counters).toEqual({ "2627": 3 });
    expect(release(a.device, uuidOf(1), true).counters).toEqual({ "2627": 2 });
  });

  it("forgets reservations of bills abandoned more than a day ago", () => {
    const a = reserve(fixtureDevice(), uuidOf(1), date, 0);
    const later = reserve(a.device, uuidOf(2), date, RESERVATION_MAX_AGE_MS + 1);
    expect(Object.keys(later.device.reservations)).toEqual([uuidOf(2)]);
    // The abandoned number is not reused: the server may have it.
    expect(later.issue.number).toBe("C1/2627/00002");
  });

  it("uses the held number when the bill goes to the queue instead", () => {
    const a = reserve(fixtureDevice(), uuidOf(1), date, 1000);
    const queued = takeForQueue(a.device, uuidOf(1), date);
    expect(queued.issue.number).toBe("C1/2627/00001");
    expect(queued.device.reservations).toEqual({});
    expect(queued.device.counters).toEqual({ "2627": 2 });
    expect(takeForQueue(queued.device, uuidOf(2), date).issue.number).toBe("C1/2627/00002");
  });
});

describe("ordering", () => {
  it("sorts by financial year, then sequence (numerically)", () => {
    const sorted = ["C1/2728/00001", "C1/2627/00010", "C1/2627/00002", "C1/2627/100000"].sort(compareNumbers);
    expect(sorted).toEqual(["C1/2627/00002", "C1/2627/00010", "C1/2627/100000", "C1/2728/00001"]);
  });
});
