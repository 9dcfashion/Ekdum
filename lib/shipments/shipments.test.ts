import { describe, expect, it } from "vitest";
import {
  buildTrackingUrl,
  daysOpen,
  daysOpenLabel,
  isReceiptPathFor,
  isStuck,
  needsConfirmation,
  nextStatuses,
  otherStatuses,
  resolveTab,
  shipmentStatusLabel,
  SHIPMENT_STATUSES,
  splitAddress,
} from "./index";

describe("buildTrackingUrl", () => {
  it("replaces {awb} with the tracking number", () => {
    expect(buildTrackingUrl("https://example.com/track?awb={awb}", "AB123")).toBe("https://example.com/track?awb=AB123");
    expect(buildTrackingUrl("http://example.com/t/{awb}/status", " 99 ")).toBe("http://example.com/t/99/status");
  });

  it("URL-encodes the tracking number", () => {
    expect(buildTrackingUrl("https://example.com/track?awb={awb}", "A B&x=1#/?")).toBe(
      "https://example.com/track?awb=A%20B%26x%3D1%23%2F%3F",
    );
  });

  it("replaces every placeholder", () => {
    expect(buildTrackingUrl("https://example.com/{awb}?n={awb}", "7")).toBe("https://example.com/7?n=7");
  });

  it("returns null when the template or number is missing", () => {
    expect(buildTrackingUrl(null, "AB123")).toBeNull();
    expect(buildTrackingUrl("", "AB123")).toBeNull();
    expect(buildTrackingUrl("https://example.com/track?awb={awb}", null)).toBeNull();
    expect(buildTrackingUrl("https://example.com/track?awb={awb}", "   ")).toBeNull();
    expect(buildTrackingUrl("https://example.com/track", "AB123")).toBeNull();
  });

  it("refuses anything that is not http or https", () => {
    expect(buildTrackingUrl("javascript:alert('{awb}')", "1")).toBeNull();
    expect(buildTrackingUrl(" JavaScript:alert({awb})", "1")).toBeNull();
    expect(buildTrackingUrl("data:text/html,{awb}", "1")).toBeNull();
    expect(buildTrackingUrl("ftp://example.com/{awb}", "1")).toBeNull();
    expect(buildTrackingUrl("//example.com/{awb}", "1")).toBeNull();
    expect(buildTrackingUrl("example.com/{awb}", "1")).toBeNull();
    expect(buildTrackingUrl("https://{awb}", "javascript:alert(1)")).toBeNull();
  });
});

describe("daysOpen", () => {
  it("counts whole calendar days", () => {
    expect(daysOpen("2026-11-12", "2026-11-12")).toBe(0);
    expect(daysOpen("2026-11-11", "2026-11-12")).toBe(1);
    expect(daysOpen("2026-10-31", "2026-11-05")).toBe(5);
    expect(daysOpen("2027-12-31", "2028-03-01")).toBe(61); // across a leap day
  });

  it("is never negative and tolerates bad input", () => {
    expect(daysOpen("2026-11-20", "2026-11-12")).toBe(0);
    expect(daysOpen(null, "2026-11-12")).toBe(0);
    expect(daysOpen("12/11/2026", "2026-11-12")).toBe(0);
  });

  it("labels", () => {
    expect(daysOpenLabel(0)).toBe("Today");
    expect(daysOpenLabel(1)).toBe("1 day");
    expect(daysOpenLabel(6)).toBe("6 days");
  });
});

describe("isStuck", () => {
  it("flags open shipments at or past the limit", () => {
    expect(isStuck("in_transit", "2026-11-07", 5, "2026-11-12")).toBe(true);
    expect(isStuck("booked", "2026-11-08", 5, "2026-11-12")).toBe(false);
    expect(isStuck("picked_up", "2026-11-01", 5, "2026-11-12")).toBe(true);
  });

  it("never flags finished shipments", () => {
    for (const status of ["delivered", "rto", "cancelled"]) {
      expect(isStuck(status, "2026-01-01", 5, "2026-11-12")).toBe(false);
    }
  });
});

describe("statuses", () => {
  it("next steps", () => {
    expect(nextStatuses("booked")).toEqual(["picked_up", "in_transit", "cancelled"]);
    expect(nextStatuses("picked_up")).toEqual(["in_transit", "delivered", "rto"]);
    expect(nextStatuses("in_transit")).toEqual(["delivered", "rto"]);
    expect(nextStatuses("delivered")).toEqual([]);
    expect(nextStatuses("rto")).toEqual([]);
    expect(nextStatuses("cancelled")).toEqual([]);
    expect(nextStatuses("nonsense")).toEqual([]);
  });

  it("next + other covers every status except the current one", () => {
    for (const status of SHIPMENT_STATUSES) {
      const all = [...nextStatuses(status), ...otherStatuses(status)].sort();
      expect(all).toEqual(SHIPMENT_STATUSES.filter((s) => s !== status).sort());
    }
  });

  it("confirmation", () => {
    expect(needsConfirmation("booked", "picked_up")).toBe(false);
    expect(needsConfirmation("in_transit", "delivered")).toBe(false);
    expect(needsConfirmation("booked", "cancelled")).toBe(true);
    expect(needsConfirmation("in_transit", "rto")).toBe(true);
    expect(needsConfirmation("delivered", "in_transit")).toBe(true);
  });

  it("labels", () => {
    expect(shipmentStatusLabel("picked_up")).toBe("Picked up");
    expect(shipmentStatusLabel("rto")).toBe("RTO (returned)");
    expect(shipmentStatusLabel("weird")).toBe("weird");
    expect(shipmentStatusLabel(null)).toBe("");
  });

  it("tabs", () => {
    expect(resolveTab("transit")).toBe("transit");
    expect(resolveTab("")).toBe("pending");
    expect(resolveTab("bogus")).toBe("pending");
  });
});

describe("splitAddress", () => {
  it("keeps a short address on one line", () => {
    expect(splitAddress("12 MG Road,\nPune")).toEqual({ line1: "12 MG Road, Pune", line2: "" });
    expect(splitAddress(null)).toEqual({ line1: "", line2: "" });
  });

  it("splits a long address at a comma or space", () => {
    const { line1, line2 } = splitAddress("Flat 4, Rose Villa, Station Road, Thane West", 20);
    expect(line1).toBe("Flat 4, Rose Villa");
    expect(line2.length).toBeLessThanOrEqual(20);
    expect(line2.startsWith("Station Road")).toBe(true);
  });

  it("hard-cuts text with no break", () => {
    const { line1, line2 } = splitAddress("x".repeat(50), 20);
    expect(line1).toHaveLength(20);
    expect(line2).toHaveLength(20);
  });
});

describe("isReceiptPathFor", () => {
  const biz = "0b0e7c1e-0000-4000-8000-000000000001";
  it("accepts only this business's receipts folder", () => {
    expect(isReceiptPathFor(biz, `${biz}/receipts/abc-photo.jpg`)).toBe(true);
    expect(isReceiptPathFor(biz, `other/receipts/abc.jpg`)).toBe(false);
    expect(isReceiptPathFor(biz, `${biz}/logos/abc.jpg`)).toBe(false);
    expect(isReceiptPathFor(biz, `${biz}/receipts/../../x.jpg`)).toBe(false);
  });
});
