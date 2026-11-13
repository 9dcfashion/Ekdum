import { describe, expect, it } from "vitest";
import { gstinCheckChar } from "@/lib/gst";
import { customerSchema, vendorSchema } from "./parties";

const first14 = "27AAPFU0939F1Z";
const GSTIN = first14 + gstinCheckChar(first14);

describe("customerSchema", () => {
  it("normalises phone and GSTIN and fills the state from the GSTIN", () => {
    const r = customerSchema.parse({ name: " Asha Traders ", phone: "98765 43210", gstin: GSTIN.toLowerCase(), state_code: "" });
    expect(r.name).toBe("Asha Traders");
    expect(r.phone).toBe("+919876543210");
    expect(r.gstin).toBe(GSTIN);
    expect(r.state_code).toBe("27");
    expect(r.whatsapp_opt_in).toBe(false);
    expect(r.email).toBeNull();
  });

  it("rejects a state that does not match the GSTIN", () => {
    const r = customerSchema.safeParse({ name: "A", gstin: GSTIN, state_code: "29" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].path).toEqual(["state_code"]);
  });

  it("rejects a GSTIN with a wrong check digit", () => {
    const bad = first14 + (GSTIN[14] === "A" ? "B" : "A");
    expect(customerSchema.safeParse({ name: "A", gstin: bad }).success).toBe(false);
  });

  it("needs a phone number for WhatsApp opt-in", () => {
    expect(customerSchema.safeParse({ name: "A", whatsapp_opt_in: true }).success).toBe(false);
    expect(customerSchema.safeParse({ name: "A", phone: "9876543210", whatsapp_opt_in: true }).success).toBe(true);
  });

  it("is stable when its own output is parsed again", () => {
    const once = customerSchema.parse({ name: "A", phone: "9876543210", pincode: "400001" });
    expect(customerSchema.parse(once)).toEqual(once);
  });
});

describe("vendorSchema", () => {
  it("defaults to active and accepts a landline", () => {
    const r = vendorSchema.parse({ name: "Mehta Wholesale", phone: "022-2345 6789" });
    expect(r.is_active).toBe(true);
    expect(r.phone).toBe("022-2345 6789");
    expect(r.state_code).toBeNull();
  });

  it("requires a name", () => {
    expect(vendorSchema.safeParse({ name: "  " }).success).toBe(false);
  });
});
