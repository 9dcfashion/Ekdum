import { describe, expect, it } from "vitest";
import { auditActionLabel, collectAuditIds, isAuditGroup, summariseChange } from "./audit";

const ROLE_A = "11111111-1111-4111-8111-111111111111";
const ROLE_B = "22222222-2222-4222-8222-222222222222";

describe("audit helpers", () => {
  it("labels known actions and humanises unknown ones", () => {
    expect(auditActionLabel("member.deactivated")).toBe("Staff member deactivated");
    expect(auditActionLabel("thing.was_done")).toBe("Thing was done");
  });

  it("knows the filter groups", () => {
    expect(isAuditGroup("member")).toBe(true);
    expect(isAuditGroup("member.%")).toBe(false);
  });

  it("summarises before → after with names for ids", () => {
    const text = summariseChange({ role_id: ROLE_A }, { role_id: ROLE_B, user_id: ROLE_A }, { [ROLE_A]: "Cashier", [ROLE_B]: "Manager" });
    expect(text).toBe("Role: Cashier → Manager · User: Cashier");
  });

  it("formats booleans and money, and hides secrets", () => {
    expect(summariseChange({ is_active: true }, { is_active: false })).toBe("Is active: yes → no");
    expect(summariseChange(null, { total_paise: 123450, public_token: "abc" })).toBe("Total: ₹1,234.50");
  });

  it("collects ids to look up", () => {
    expect(collectAuditIds([{ before: { role_id: ROLE_A }, after: { role_id: ROLE_B, note: "x" } }])).toEqual([ROLE_A, ROLE_B]);
  });
});
