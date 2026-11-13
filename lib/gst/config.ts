/**
 * Compliance constants. Every value here is an assumption recorded in
 * docs/COMPLIANCE_NOTES.md and must be verified by the business's CA.
 */

/**
 * CGST Rule 46 proviso: for an unregistered recipient, the invoice must carry
 * name, address and place of delivery (with state name and code) when the
 * taxable value of the supply is ₹50,000 or more.
 */
export const UNREGISTERED_RECIPIENT_DETAILS_THRESHOLD_PAISE = 50_000_00;

/**
 * GSTR-1 "B2C Large": inter-state supplies to unregistered persons with an
 * invoice value above this amount are reported invoice-wise. ₹1,00,000 from
 * 1 August 2024 (was ₹2,50,000). Stored for future GSTR-1 export.
 */
export const B2C_LARGE_THRESHOLD_PAISE = 1_00_000_00;

/** Server rejects an online bill whose client totals differ from its own recomputation at all. */
export const TOTAL_MISMATCH_TOLERANCE_PAISE = 0;

export const GST_SCHEMES = ["regular", "composition", "unregistered"] as const;
export type GstScheme = (typeof GST_SCHEMES)[number];

export const DOCUMENT_TYPES = ["tax_invoice", "bill_of_supply", "cash_memo"] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const DOCUMENT_TITLES: Record<DocumentType, string> = {
  tax_invoice: "Tax Invoice",
  bill_of_supply: "Bill of Supply",
  cash_memo: "Cash Memo",
};

export const COMPOSITION_DECLARATION =
  "Composition taxable person, not eligible to collect tax on supplies.";
