# EkDum · Compliance notes

Every GST or legal assumption built into the product, where it lives, its source,
and how well it has been verified. **None of this is tax advice.** Have a Chartered
Accountant confirm each "To verify" item before the first real invoice is issued.

Verification levels used below:

- **Checked (secondary)**: confirmed on 12 Nov 2026 against several secondary sources
  (tax-software and news sites), not against the notification text itself.
- **Not re-verified**: built from general knowledge of the rules; no source was checked in this build.
- **Design choice**: not a legal rule; a product decision that affects compliance.

## 1. GST rates

| # | Assumption | Where | Source | Status |
|---|---|---|---|---|
| 1.1 | Main slabs after the September 2025 rationalisation (effective 22 Sep 2025, 56th GST Council): **0%, 5%, 18%, 40%**. The 12% and 28% slabs were removed. | `gst_rates` seed in `supabase/migrations/…_master_data.sql` | Secondary: tallysolutions.com/gst/gst-rates-2026-key-changes, cleartax.in/s/gst-rates, business-standard.com (22 Sep 2025) | Checked (secondary). **To verify** against the CBIC rate notifications. |
| 1.2 | Special rates kept active: **0.25%** (rough precious stones), **1.5%** (cut and polished diamonds), **3%** (gold, silver, jewellery). | same | General knowledge | Not re-verified. **To verify.** |
| 1.3 | **12% and 28%** are seeded as *inactive* so old purchase bills and history can still be recorded. They are not offered for new products. | same | Design choice | n/a |
| 1.4 | Rates are data, not code. An owner cannot edit `gst_rates` from the app; a new rate needs a migration. | RLS on `gst_rates` | Design choice | n/a |
| 1.5 | The product does not know which rate applies to which item. The shop picks the rate and HSN for each product. | Product form | Design choice | The shop and its CA are responsible for classification. |
| 1.6 | **Cess** is calculated as a percentage of the taxable value (`cess_rate`, default 0). Specific (per-unit) cess is not supported. Compensation cess was largely withdrawn in the 2025 changes. | `lib/gst/engine.ts` | General knowledge | **To verify** whether any item you sell still carries cess. |

## 2. Which document is issued

| # | Assumption | Where | Status |
|---|---|---|---|
| 2.1 | Regular scheme → **Tax Invoice** with tax charged. | `resolveDocumentType` in `lib/gst/document.ts`; enforced again in `post_sales_invoice` | Not re-verified (Section 31 CGST Act). |
| 2.2 | Composition scheme → **Bill of Supply**, no tax charged, with the line "Composition taxable person, not eligible to collect tax on supplies." | `COMPOSITION_DECLARATION` in `lib/gst/config.ts` | Not re-verified (Rule 49 and Rule 5(1)(f)). **To verify** the exact wording. |
| 2.3 | Unregistered business → **Cash Memo** with no GST fields and no GSTIN. | same | Design choice. |
| 2.4 | A regular-scheme bill with **only** nil-rated/exempt lines becomes a Bill of Supply. Configurable per business (`bos_for_exempt_only`, default on). | Settings → Invoice | Not re-verified. **To verify.** |
| 2.5 | A bill mixing taxable and exempt items is issued as a single Tax Invoice (an "invoice-cum-bill of supply" under Rule 46A for unregistered recipients). The title printed is "Tax Invoice". | same | **To verify** whether your CA wants the "Invoice-cum-Bill of Supply" title. |
| 2.6 | A database constraint stops any non-tax document from carrying tax amounts. | `sales_invoices_no_tax_unless_tax_invoice` | Design choice. |
| 2.7 | Reverse charge is always "No". RCM sales are out of scope for Phase 1. | `post.ts` | Limitation. |

## 3. Place of supply and tax split

| # | Assumption | Where | Status |
|---|---|---|---|
| 3.1 | Walk-in retail sale: place of supply = the outlet's state. | `resolvePlaceOfSupply` | Not re-verified (Section 10 IGST Act). |
| 3.2 | B2B sale: the customer's GSTIN state (first two digits), else their billing state. | same | Not re-verified. |
| 3.3 | Goods shipped to another state: the delivery state. | same | Not re-verified. |
| 3.4 | The cashier may override the place of supply with a reason; the override is written to the audit log. | POS + `post_sales_invoice` | Design choice. |
| 3.5 | Seller state = state of the outlet's GSTIN (the outlet's own GSTIN if it has one, else the business GSTIN), else the outlet address state. | `sellerStateCode` | Design choice. |
| 3.6 | Same state → CGST + SGST at half the rate each. Different state → IGST at the full rate. | engine | Not re-verified. |
| 3.7 | For Union Territories without a legislature the second half should be labelled **UTGST**, not SGST. The product always prints "SGST". | PDF / print | **Known gap. To verify** if you operate in such a UT. |
| 3.8 | Code 97 "Other Territory" is offered as a place of supply. Exports and SEZ supplies are not supported. | `lib/gst/states.ts` | Limitation. |

## 4. Calculation and rounding

| # | Rule | Status |
|---|---|---|
| 4.1 | All amounts are integer paise. Intermediate math uses decimal.js; rounding is half-up to the paisa. | Design choice. |
| 4.2 | Price excluding tax: `taxable = qty × price − discount`, `tax = round(taxable × rate / 100)`. | As specified. |
| 4.3 | Price including tax: `tax = round(gross − gross / (1 + rate/100))`, `taxable = gross − tax`. Guarantees taxable + tax = the price the customer sees. | As specified. |
| 4.4 | Intra-state: `CGST = floor(tax / 2)`, `SGST = tax − CGST`. When the tax is an odd number of paise, SGST is one paisa more than CGST. | As specified. **To verify** that a one-paisa difference between CGST and SGST is acceptable to your CA (the alternative is rounding each half separately, which can change the total by a paisa). |
| 4.5 | Tax is computed **per line** and summed, not on the invoice total. | Design choice; common practice. |
| 4.6 | Bill-level discount is spread over the lines in proportion to their value before tax; leftover paise go to the lines with the largest fractions so the parts always add up. | Design choice. |
| 4.7 | Round-off: the grand total is rounded to the nearest rupee (half-up) and the difference is shown as "Round off". Configurable; on by default. | Not re-verified (Section 170 rounds tax amounts; rounding the invoice total is trade practice). |
| 4.8 | The server recomputes every bill with the same engine and rejects any difference from what the cashier saw (zero tolerance). | `lib/sales/post.ts` |

## 5. Invoice numbering (Rule 46(b))

| # | Assumption | Status |
|---|---|---|
| 5.1 | Consecutive serial number, unique for a financial year, **at most 16 characters**, only letters, digits, hyphen and slash. Format `{PREFIX}/{FY}/{SEQ}`, e.g. `A/2627/00042`. | Not re-verified against the rule text. **To verify** the 16-character limit and allowed characters. |
| 5.2 | Uniqueness is enforced per business + supplier GSTIN + financial year. | Design choice. |
| 5.3 | Financial year is 1 April to 31 March in IST; series restart at 1 each year. | As specified. |
| 5.4 | Tax invoices and bills of supply share one series per outlet. Credit notes have their own series. | Design choice. **To verify** whether your CA wants a separate series for bills of supply. |
| 5.5 | Each POS device has its own series (prefix) so it can number bills offline. A gap in a device series (a number never synced) is recorded in the audit log, not hidden. | As specified. |
| 5.6 | Cancelled bills keep their number; numbers are never reused. A bill that fails to post does not consume a number. | As specified. |
| 5.7 | Starting number can be set above 1 for shops moving from other software mid-year. | Design choice. |

## 6. Invoice contents (Rule 46)

Printed on the A4 PDF: supplier name, address, GSTIN, state name and code; document
title; number; date; recipient name, address, GSTIN, state; per line description, HSN,
quantity, unit, rate, discount, taxable value, tax rate and tax amounts by CGST/SGST/IGST/cess;
place of supply (state name and code); reverse charge (No); totals; round-off; amount in
words; bank details; UPI QR; terms; footer; "Authorised Signatory".

| # | Assumption | Status |
|---|---|---|
| 6.1 | For an **unregistered** recipient, name, address and place of delivery with state name and code are required when the taxable value is **₹50,000 or more**. Constant: `UNREGISTERED_RECIPIENT_DETAILS_THRESHOLD_PAISE`. | Checked (secondary: CBIC rule page listing, gstzen.in). **To verify** the exact wording. Enforced on the server (`lib/sales/post.ts`): an online tax invoice at or above the threshold is refused until name, address and state are filled; an offline bill (already printed) is accepted with a warning. |
| 6.1a | **Manual items** (billed at the counter without being in the product list): the cashier must pick a GST rate from `gst_rates` (no rate is preselected the first time) and the server rejects any rate not in that table. HSN is **optional** for manual items so billing is never blocked. A tax invoice line without HSN may not meet Rule 46 for your turnover band. | POS → "Not in list" (F6); `lib/sales/post.ts` | Design choice. **To verify** with your CA whether staff must always enter HSN; if so, make the HSN field required in `components/pos/manual-item-dialog.tsx`. |
| 6.1c | **Quick billing items** (Settings → Quick billing items) carry a GST rate, HSN and unit set by the shop. The ready-made **jewellery** set uses **GST 3% and HSN 7117** (imitation jewellery) because the shop asked for it and its existing bill uses it; the rate typed at the counter is **before GST** by default, as on that bill. Items are billed as manual lines (no stock). | `lib/quick-items/packs.ts` | **To verify** with the shop's CA that 7117 at 3% is the right classification for what it sells (precious-metal jewellery is HSN 7113). |
| 6.1b | The server takes each catalog line's GST and cess rate from the product master: an online bill whose rate differs is refused ("refresh the catalog"); an offline bill is accepted and flagged. | `lib/sales/post.ts` | Design choice. |
| 6.2 | HSN digits printed: 4 by default, configurable to 6 or 8 per business. | Checked (secondary: Notification 78/2020-CT as summarised by tax sites): 4 digits up to ₹5 crore turnover, 6 above. **To verify** for your turnover, and whether HSN is optional on your B2C bills. |
| 6.3 | No physical or digital signature is applied; the PDF prints "Authorised Signatory". | **To verify** whether you need to sign printed invoices. |
| 6.4 | E-invoicing (IRN/QR) is **not** supported. | Out of scope. **If your turnover is above the e-invoicing threshold, B2B invoices from this product are not valid tax invoices.** |
| 6.5 | E-way bills are not generated. | Out of scope. |
| 6.6 | The dynamic B2C QR code mandated for very large taxpayers is not the same as the UPI QR printed here. | Out of scope. |

## 7. Corrections

| # | Assumption | Status |
|---|---|---|
| 7.1 | Posted invoices can never be edited (enforced by database triggers). | As specified. |
| 7.2 | Cancellation: needs a reason and permission; allowed only on the same IST day by default (`cancel_window_days`: 0 = same day, n = within n days, empty = no limit). Stock is put back. | Design choice. **To verify** your policy; cancelling after the return period for that month has been filed should be done by credit note instead. |
| 7.3 | Credit notes (Section 34): full or partial, own series, linked to the original invoice, optional restock. Amounts are pro-rated from the original line; the last return of a line credits exactly what remains. | Not re-verified. |
| 7.4 | The time limit for issuing a credit note with tax adjustment (30 November following the financial year) is **not** enforced. | **Known gap.** |
| 7.5 | Debit notes are not supported. | Out of scope. |

## 8. Data kept for GSTR-1 (export is out of scope)

Stored per invoice: B2B/B2C, customer GSTIN, place of supply, inter/intra-state, taxable
value and tax by head; per line: HSN, unit (UQC), rate, quantity. Credit notes carry the same.

| # | Assumption | Status |
|---|---|---|
| 8.1 | **B2C Large** = inter-state B2C invoices above **₹1,00,000** (from 1 Aug 2024; earlier ₹2,50,000). Constant `B2C_LARGE_THRESHOLD_PAISE`, not yet used by any screen. | Checked (secondary: Notification 12/2024-CT as summarised by taxguru.in, tallysolutions help). |
| 8.2 | Units are GST UQC codes (`units` table). | Not re-verified against the official UQC list. **To verify.** |
| 8.3 | The HSN and sales-register reports are working reports, not a return. | n/a |

## 9. Identifier validation

| # | Rule | Status |
|---|---|---|
| 9.1 | GSTIN: 15 characters = 2-digit state code + 10-character PAN + entity code + `Z` + check character (mod-36). Unit-tested, including the sample `27AAPFU0939F1ZV`. | Not re-verified against an official algorithm document. A GSTIN that passes is well-formed; **it is not checked against the GST portal**, so it can still be cancelled or belong to someone else. |
| 9.2 | The 14th character is assumed to be `Z`. | **To verify**: some special registrations may differ. |
| 9.3 | State codes 01–38 plus 97 (Other Territory) and 99 (Centre Jurisdiction); 25 kept as a legacy code; 28 (old Andhra Pradesh) not accepted. | Not re-verified. |
| 9.4 | PAN `AAAAA9999A`, IFSC `AAAA0XXXXXX`, PIN 6 digits not starting with 0, mobile 10 digits starting 6–9 stored as `+91…`. | Format checks only. |

## 10. Messaging and privacy

| # | Assumption | Status |
|---|---|---|
| 10.1 | WhatsApp receipts are sent only to customers who opted in; the opt-in and its timestamp are stored; consent is re-checked when the message is actually sent. | As specified. **To verify** against Meta's current opt-in policy and Indian law (DPDP Act 2023). |
| 10.2 | Receipts use a WhatsApp **utility** template that must be approved by Meta. | See RUNBOOK. |
| 10.3 | Email receipts go to an address typed at the counter; there is no separate email opt-in. | **To verify.** |
| 10.4 | The public invoice link `/i/{token}` uses a 256-bit random token, is not indexed, is rate limited and can be revoked by the owner. Anyone with the link can see that bill. | Design choice. |
| 10.5 | Customer data (name, phone, email, address, GSTIN) is personal data. Retention and deletion policies are not implemented beyond manual deletion. | **Known gap** for DPDP compliance. |
| 10.6 | Data region: the Supabase project must be created in Mumbai (ap-south-1). The app does not check this. | See RUNBOOK. |

## 11. Purchases

| # | Assumption | Status |
|---|---|---|
| 11.1 | Purchase tax is computed with the same engine, then a manual round-off lets the total match the vendor's printed bill. The vendor's bill is the legal document. | Design choice. |
| 11.2 | CGST+SGST vs IGST on a purchase is derived from the vendor's state vs ours, and can be flipped manually. | Design choice. |
| 11.3 | Input tax credit eligibility, blocked credits, RCM purchases and GSTR-2B matching are not handled. | Out of scope. |
| 11.4 | A vendor invoice number can be entered once per vendor per financial year. | As specified. |
