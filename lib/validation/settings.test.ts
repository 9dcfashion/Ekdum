import { describe, expect, it } from "vitest";
import { SIGNATORY_TITLES, brandingSchema, invoiceSettingsSchema } from "./onboarding";
import { courierSchema, invoicePrefsFormSchema, invoicePrefsSchema, seriesCreateSchema } from "./settings";

const prefs = {
  default_print_format: "thermal_80",
  round_off_enabled: true,
  invoice_terms: "",
  invoice_footer: " Thanks ",
  signatory_label: " Proprietor ",
  hsn_digits: "6",
  bos_for_exempt_only: true,
  cancel_window_mode: "same_day",
  cancel_window_days: "3",
  allow_negative_stock: false,
  stuck_shipment_days: "5",
};

describe("invoice settings", () => {
  it("maps the cancellation window to 0 / n / null", () => {
    expect(invoicePrefsSchema.parse(prefs).cancel_window_days).toBe(0);
    expect(invoicePrefsSchema.parse({ ...prefs, cancel_window_mode: "days", cancel_window_days: "7" }).cancel_window_days).toBe(7);
    expect(invoicePrefsSchema.parse({ ...prefs, cancel_window_mode: "no_limit" }).cancel_window_days).toBeNull();
  });

  it("needs a day count only in days mode", () => {
    expect(invoicePrefsSchema.safeParse({ ...prefs, cancel_window_mode: "days", cancel_window_days: "" }).success).toBe(false);
    expect(invoicePrefsSchema.safeParse({ ...prefs, cancel_window_mode: "days", cancel_window_days: "0" }).success).toBe(false);
    expect(invoicePrefsSchema.safeParse({ ...prefs, cancel_window_mode: "no_limit", cancel_window_days: "" }).success).toBe(true);
  });

  it("produces database columns only", () => {
    const out = invoicePrefsSchema.parse(prefs);
    expect(out).toEqual({
      default_print_format: "thermal_80",
      round_off_enabled: true,
      invoice_terms: null,
      invoice_footer: "Thanks",
      signatory_label: "Proprietor",
      hsn_digits: 6,
      bos_for_exempt_only: true,
      cancel_window_days: 0,
      allow_negative_stock: false,
      stuck_shipment_days: 5,
    });
    expect(invoicePrefsSchema.safeParse({ ...prefs, hsn_digits: "5" }).success).toBe(false);
  });

  it("requires a signature title of at most 40 characters", () => {
    expect(invoicePrefsSchema.safeParse({ ...prefs, signatory_label: "  " }).success).toBe(false);
    expect(invoicePrefsSchema.safeParse({ ...prefs, signatory_label: "x".repeat(41) }).success).toBe(false);
    expect(invoicePrefsSchema.parse({ ...prefs, signatory_label: "Managing Partner" }).signatory_label).toBe("Managing Partner");
  });

  it("accepts the form's own output again (the form sends validated values to the action)", () => {
    const formOutput = invoicePrefsFormSchema.parse({ ...prefs, cancel_window_mode: "days", cancel_window_days: "10" });
    expect(invoicePrefsSchema.parse(formOutput).cancel_window_days).toBe(10);
  });
});

describe("courier", () => {
  const base = { id: "", name: "DTDC", is_active: true };
  it("allows an empty tracking link", () => {
    expect(courierSchema.parse({ ...base, tracking_url_template: " " }).tracking_url_template).toBeNull();
  });
  it("requires http(s) and {awb}", () => {
    expect(courierSchema.safeParse({ ...base, tracking_url_template: "ftp://x/{awb}" }).success).toBe(false);
    expect(courierSchema.safeParse({ ...base, tracking_url_template: "https://x.example/track" }).success).toBe(false);
    expect(courierSchema.parse({ ...base, tracking_url_template: "HTTPS://x.example/t?n={awb}" }).tracking_url_template).toBe(
      "https://x.example/t?n={awb}",
    );
  });
});

describe("series", () => {
  it("normalises the prefix and start number", () => {
    const out = seriesCreateSchema.parse({
      outlet_id: "11111111-1111-4111-8111-111111111111",
      document_type: "invoice",
      prefix: " b2 ",
      start_number: "101",
      replace_current: true,
    });
    expect(out.prefix).toBe("B2");
    expect(out.start_number).toBe(101);
    expect(seriesCreateSchema.safeParse({ ...out, prefix: "TOOLONG" }).success).toBe(false);
    expect(seriesCreateSchema.safeParse({ ...out, start_number: "0" }).success).toBe(false);
  });
});

describe("branding", () => {
  it("keeps an optional line under the shop name, up to 120 characters", () => {
    const base = { logo_path: null, brand_color: "#E00000" };
    expect(brandingSchema.parse({ ...base, invoice_tagline: "  " }).invoice_tagline).toBeNull();
    expect(brandingSchema.parse(base).invoice_tagline).toBeNull();
    expect(brandingSchema.parse({ ...base, invoice_tagline: " Wholesale Dealer in: Fancy Jewellery " }).invoice_tagline).toBe(
      "Wholesale Dealer in: Fancy Jewellery",
    );
    expect(brandingSchema.safeParse({ ...base, invoice_tagline: "x".repeat(121) }).success).toBe(false);
  });

  it("asks for a signature title during onboarding", () => {
    const base = { prefix: "A", start_number: "1", default_print_format: "a4", round_off_enabled: true };
    expect(invoiceSettingsSchema.safeParse(base).success).toBe(false);
    expect(invoiceSettingsSchema.parse({ ...base, signatory_label: "Partner" }).signatory_label).toBe("Partner");
    expect(SIGNATORY_TITLES).toContain("Proprietor");
  });
});
