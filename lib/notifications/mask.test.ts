import { describe, expect, it } from "vitest";
import { isStuckJob, maskEmail, maskPhone, maskRecipient } from "./mask";

describe("recipient masking", () => {
  it("masks phone numbers", () => {
    expect(maskPhone("+919812343210")).toBe("98••••3210");
    expect(maskPhone("9812343210")).toBe("98••••3210");
    expect(maskPhone("12345")).toBe("•••••");
    expect(maskPhone(null)).toBe("");
  });
  it("masks email addresses", () => {
    expect(maskEmail("ravi.kumar@gmail.com")).toBe("r•••@gmail.com");
    expect(maskEmail("a@b.in")).toBe("a•••@b.in");
    expect(maskEmail("not-an-email")).toBe("•••");
    expect(maskEmail("")).toBe("");
  });
  it("picks the mask by channel", () => {
    expect(maskRecipient("email", "ravi@gmail.com")).toBe("r•••@gmail.com");
    expect(maskRecipient("whatsapp", "+919812343210")).toBe("98••••3210");
  });
});

describe("isStuckJob", () => {
  const now = Date.parse("2026-11-12T10:00:00Z");
  it("flags jobs that have been sending for over 10 minutes", () => {
    expect(isStuckJob({ status: "sending", locked_at: "2026-11-12T09:45:00Z" }, now)).toBe(true);
    expect(isStuckJob({ status: "sending", locked_at: "2026-11-12T09:55:00Z" }, now)).toBe(false);
    expect(isStuckJob({ status: "sending", locked_at: null }, now)).toBe(true);
    expect(isStuckJob({ status: "queued", locked_at: null }, now)).toBe(false);
  });
});
