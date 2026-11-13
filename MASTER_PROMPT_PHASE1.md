# MASTER PROMPT — EkDum · Phase 1 (Shop OS for Indian retailers)

> **Before pasting:** review section 18 (Open decisions) and change any defaults you disagree with. Everything below this line is the prompt.

---

## 1. Your role and ground rules

You are a senior full-stack engineer building a production-grade, multi-tenant SaaS for Indian shop owners. You are working with a human lead who reviews every milestone.

**Non-negotiable rules:**

1. **Never run `git commit`, `git push`, `git rebase`, `git reset`, create branches, or touch git history in any way.** Leave all changes uncommitted for human review.
2. Work **one milestone at a time** (section 16). At the end of each milestone, **stop** and produce the handoff report (section 17). Do not start the next milestone until the human says so.
3. Start with **Milestone 0**: read this whole prompt, then reply with (a) your implementation plan, (b) any contradictions or gaps you found, and (c) questions. Do not write feature code before that plan is approved.
4. All database changes go through **Supabase migration files** in `supabase/migrations/`. Never change the schema by hand in the dashboard. Regenerate TypeScript types after every migration.
5. **Row Level Security is on for every table**, with no exceptions. Never expose the service-role key to the browser.
6. **Do not invent GST/tax rules.** Where this prompt is silent or you are unsure, choose the safest option, make it configurable, and record it in `docs/COMPLIANCE_NOTES.md` for the human to verify.
7. Before calling a milestone done, run typecheck, lint and tests, and make sure they pass.
8. Use the **latest stable** versions of the libraries listed and check their current docs. Do not rely on memory for APIs that may have changed (Next.js, Supabase SSR, Serwist, the WhatsApp Cloud API).
9. Keep secrets in `.env.local`. Maintain `.env.example` with every variable documented.
10. If a requirement is ambiguous and cheap to change later, choose a sensible default and note it. If it is expensive to change later (schema shape, money representation, numbering), ask.

---

## 2. Product context

EkDum is a **one-stop operating panel for Indian shop owners** who run a physical store and want to grow online. The long-term vision is that billing, inventory, purchases, staff, dispatch, Google Business Profile, Shopify and reviews all live in **one dashboard**.

**Phase 1 is the foundation**: a reliable GST billing + POS system with purchases, inventory, staff roles, digital receipts, a courier dispatch log, and an end-of-day owner dashboard. It must be good enough that a shop can **replace its current billing software with it**.

**Users:**
- **Owner**: sets up the business, sees everything, manages staff.
- **Manager**: runs day-to-day operations.
- **Cashier**: bills customers at the counter, often on a shared tablet or PC with a barcode scanner and thermal printer.
- **Dispatch staff**: record courier handovers, usually on a phone.

**Target market:** India only. Prices in INR, timezone Asia/Kolkata, GST regime, English UI (keep strings in a translation-ready structure for Hindi later).

---

## 3. Phase 1 scope

**In scope**
- Marketing landing page, signup, login
- Onboarding wizard (business profile, GST details, branding, bank/UPI, first outlet, invoice settings)
- Multi-outlet data model, staff accounts, roles and permissions
- Product catalog (HSN, GST rate, units, barcode), categories, CSV import
- Customers and vendors
- Purchase bill entry (with bill photo/PDF attachment) that updates stock
- Inventory: stock ledger, adjustments, low-stock alerts
- POS billing: B2C retail and B2B GST invoices, split payments, discounts
- Tax invoice / bill of supply / cash memo depending on the business's GST scheme
- Invoice PDF (A4) and thermal print (58mm / 80mm)
- Cancellation and credit notes (returns)
- Receipt delivery by email and WhatsApp, plus a public invoice link
- Courier / shipment log with receipt photo, tracking number and status
- Owner dashboard and basic reports with CSV export
- Offline-capable POS (PWA)

**Out of scope for Phase 1 (but design the data model so these are easy to add)**
- Google Business Profile integration (reviews, posts)
- Shopify sync
- AI extraction of purchase bills (keep the attachment + draft flow ready for it)
- GSTR-1 JSON export (but store everything GSTR-1 needs: B2B / B2CL / B2CS classification, HSN summary, credit notes)
- E-invoice IRN and e-way bills
- Shipping aggregator integrations
- Payment gateway / online payments
- Subscription billing for EkDum itself

---

## 4. Tech stack

| Concern | Choice |
|---|---|
| Framework | Next.js (latest stable), App Router, TypeScript strict mode |
| Database / Auth / Storage | Supabase (Postgres, Auth, Storage, RLS, pg_cron, pg_net). Project region: **Mumbai (ap-south-1)** |
| Supabase client | `@supabase/ssr` for cookie-based auth in Server Components, Server Actions and Route Handlers |
| UI | Tailwind CSS + shadcn/ui, lucide-react icons |
| Forms and validation | React Hook Form + Zod. Share Zod schemas between client and server |
| Client data | TanStack Query for client-side fetching where Server Components are not a fit |
| Money math | `decimal.js` (never use JS floats for money) |
| Offline | Serwist (service worker) + Dexie (IndexedDB) |
| PDF | `@react-pdf/renderer`, rendered server-side |
| Email | Resend + React Email (behind a provider interface) |
| WhatsApp | Meta WhatsApp Cloud API (behind a provider interface, with a mock provider for development) |
| Charts | Recharts (or shadcn charts) |
| Testing | Vitest (unit), Playwright (e2e), Supabase local for RLS integration tests |
| Tooling | ESLint, Prettier, pnpm |
| Hosting | Vercel (app) + Supabase Cloud (Mumbai) |

---

## 5. Architecture and project structure

```
/app
  /(marketing)          landing, pricing, about, legal pages
  /(auth)               login, signup, forgot-password, accept-invite
  /onboarding           multi-step wizard
  /app                  authenticated shell (sidebar + business/outlet switcher)
    /dashboard
    /pos                full-screen billing UI
    /sales              list, detail, cancel, credit notes
    /purchases          list, new, detail
    /products           list, new/edit, import, categories
    /inventory          stock levels, adjustments, ledger
    /customers
    /vendors
    /shipments
    /reports
    /staff              members, roles, invites
    /settings           business, outlets, invoice, devices, notifications
  /i/[token]            public invoice view (no auth, noindex)
  /api
    /pos/sync           offline sync endpoint
    /jobs/notifications outbox processor (secret-protected)
    /invoices/[id]/pdf  PDF stream (auth or token)
/lib
  /supabase             server/browser/admin clients
  /gst                  tax engine, GSTIN validation, state codes, amount-in-words
  /money                paise helpers, INR formatting
  /auth                 session, active business, permission checks
  /providers            email + whatsapp interfaces and implementations
  /pdf                  invoice templates
  /offline              Dexie schema, sync queue
/components
/supabase
  /migrations
  /seed.sql
  /tests                RLS and RPC tests
/docs
  ARCHITECTURE.md
  COMPLIANCE_NOTES.md
  RUNBOOK.md
```

**Conventions**
- Prefer Server Components and Server Actions. Every Server Action: validate the input with Zod, check permissions on the server, then write.
- Multi-table writes that must be atomic (posting an invoice, posting a purchase, stock adjustments, credit notes) go through **Postgres functions (RPC)** that run in one transaction.
- The active business and outlet are stored in a cookie and **re-validated against membership on every request**.
- Use route protection middleware (or `proxy.ts` on newer Next.js versions, check the docs) for auth redirects, but never treat it as the only security layer. RLS is the real guard.

---

## 6. Multi-tenancy, auth, roles and permissions

**Tenancy**
- Every business-owned row has a `business_id`. Outlet-specific rows also have an `outlet_id`.
- Helper SQL functions (`security definer`, `stable`, with a fixed `search_path`):
  - `is_member(business_id uuid) → boolean`
  - `has_perm(business_id uuid, perm text) → boolean`
  - `can_access_outlet(outlet_id uuid) → boolean`
- RLS policies use these helpers. Write RLS integration tests proving that:
  - a user from business A cannot read or write anything in business B
  - a cashier cannot see purchase cost prices or other cashiers' sales when `sales.view_own` is their only sales permission
  - a user restricted to outlet X cannot see outlet Y's data

**Auth**
- Supabase Auth with email + password and email verification. Magic link optional.
- One user can belong to several businesses. Show a business switcher.
- **Staff invites:** the owner enters name, email, role and outlet access. Create an `invitations` row and send an invite email via a server-side admin call. The `/accept-invite` page sets a password and creates the membership.
- An owner can deactivate a member. Deactivation must take effect immediately (membership `is_active = false`, checked inside `is_member`).

**Permission keys** (stored as text, grouped in the UI):

```
dashboard.view
sales.create  sales.view_own  sales.view_all  sales.cancel  sales.credit_note
sales.discount  (with max_discount_percent on the role)
sales.price_override
products.view  products.manage  products.view_cost
inventory.view  inventory.adjust
customers.view  customers.manage
vendors.manage
purchases.view  purchases.create  purchases.post
shipments.view  shipments.create  shipments.update
reports.view  reports.export
staff.manage
settings.manage
```

**System roles** (seeded per business, not deletable; owners can also create custom roles):
- **Owner**: all permissions. The business must always have at least one active owner.
- **Manager**: everything except `staff.manage` and `settings.manage`.
- **Cashier**: `sales.create`, `sales.view_own`, `products.view`, `customers.view`, `customers.manage`, `shipments.create`, `inventory.view`.
- **Dispatch**: `shipments.view`, `shipments.create`, `shipments.update`, `sales.view_all`.

---

## 7. Data model

Design notes:
- **Money is stored as integer paise in `bigint` columns** (e.g. `total_paise`). Tax rates are stored as `numeric(5,2)`. Quantities are stored as `numeric(12,3)`.
- Every table has `id uuid default gen_random_uuid()`, `created_at`, `updated_at`, and `created_by` where relevant.
- Use Postgres enums or check constraints for status fields.
- Add indexes for every foreign key and for common filters (business_id + date, phone, tracking number, invoice number).
- Posted financial documents are **immutable**. Changes happen through cancellation or credit notes, never through UPDATE/DELETE of amounts.

**Core tables** (the minimum; extend where needed and explain why):

- `profiles`: user_id, full_name, phone
- `businesses`: legal_name, trade_name, gst_scheme (`regular` | `composition` | `unregistered`), gstin (nullable), pan, state_code, address fields, pincode, phone, email, logo_path, brand_color, bank_name, bank_account_name, bank_account_number, ifsc, upi_id, invoice_terms, invoice_footer, round_off_enabled, allow_negative_stock, onboarding_step, onboarding_completed_at
- `outlets`: business_id, name, address fields, state_code, gstin (defaults to the business GSTIN; can differ for an outlet in another state), phone, is_active
- `roles`: business_id, name, is_system, max_discount_percent
- `role_permissions`: role_id, permission
- `business_members`: business_id, user_id, role_id, is_active, all_outlets boolean
- `member_outlets`: member_id, outlet_id
- `invitations`: business_id, email, role_id, outlet_ids, token_hash, expires_at, accepted_at
- `gst_rates`: rate, label, is_active. Seed it with currently notified GST rates. **Do not hardcode slabs in code.** GST rates were rationalised in 2025, so verify the current list and record your source in COMPLIANCE_NOTES.
- `units`: GST UQC codes (NOS, PCS, KGS, GMS, LTR, MTR, BOX, SET, PAC, DOZ, etc.), seeded
- `product_categories`: business_id, name, parent_id
- `products`: business_id, name, sku, barcode, category_id, hsn_code, unit_code, gst_rate, cess_rate (default 0), sale_price_paise, price_includes_tax, mrp_paise, purchase_price_paise, track_inventory, low_stock_threshold, is_active. Unique (business_id, sku) and (business_id, barcode) where not null.
- `stock_levels`: product_id, outlet_id, quantity. **Maintained only by trigger from `stock_movements`.**
- `stock_movements`: business_id, outlet_id, product_id, quantity_delta, movement_type (`opening` | `purchase` | `sale` | `sale_return` | `adjustment` | `sale_cancel`), source_table, source_id, note, created_by
- `customers`: business_id, name, phone (unique per business when present), email, gstin, billing address fields, state_code, whatsapp_opt_in, whatsapp_opt_in_at
- `vendors`: business_id, name, gstin, phone, email, address fields, state_code
- `purchase_bills`: business_id, outlet_id, vendor_id, vendor_invoice_number, vendor_invoice_date, place_of_supply_state, status (`draft` | `posted` | `cancelled`), subtotal_paise, cgst_paise, sgst_paise, igst_paise, cess_paise, round_off_paise, total_paise, payment_status (`unpaid` | `partial` | `paid`), attachment_paths text[], notes. Unique (vendor_id, vendor_invoice_number, financial_year).
- `purchase_bill_items`: purchase_bill_id, product_id, description, hsn_code, quantity, unit_code, rate_paise, discount_paise, taxable_paise, gst_rate, cgst_paise, sgst_paise, igst_paise, cess_paise, total_paise
- `purchase_payments`: purchase_bill_id, amount_paise, mode, paid_on, reference
- `pos_devices`: business_id, outlet_id, name, device_key_hash, last_seen_at, is_active
- `invoice_series`: business_id, outlet_id, pos_device_id (nullable), document_type, prefix, financial_year, next_number, is_active
- `sales_invoices`: business_id, outlet_id, series_id, invoice_number, financial_year, document_type (`tax_invoice` | `bill_of_supply` | `cash_memo`), invoice_date (IST), customer_id (nullable), customer snapshot fields (name, phone, gstin, address, state), supply_type (`b2b` | `b2c`), place_of_supply_state, is_inter_state, reverse_charge (default false), subtotal_paise, discount_paise, taxable_paise, cgst_paise, sgst_paise, igst_paise, cess_paise, round_off_paise, total_paise, amount_in_words, status (`posted` | `cancelled`), cancelled_at, cancel_reason, public_token (unique, random), client_uuid (unique; used as the idempotency key for offline sync), created_by, source (`pos_online` | `pos_offline` | `back_office`)
- `sales_invoice_items`: invoice_id, product_id, description, hsn_code, quantity, unit_code, unit_price_paise, price_includes_tax, discount_paise, taxable_paise, gst_rate, cgst_paise, sgst_paise, igst_paise, cess_paise, total_paise
- `sales_payments`: invoice_id, mode (`cash` | `upi` | `card` | `bank_transfer` | `credit`), amount_paise, reference
- `credit_notes` + `credit_note_items`: linked to the original invoice, with their own series and numbering, a reason, and an optional restock flag that creates `sale_return` stock movements
- `notification_jobs`: business_id, channel (`email` | `whatsapp`), template, recipient, payload jsonb, related_table, related_id, status (`queued` | `sending` | `sent` | `failed`), attempts, next_attempt_at, last_error, provider_message_id
- `courier_partners`: business_id, name, tracking_url_template (e.g. `https://example.com/track?awb={awb}`), is_active
- `shipments`: business_id, outlet_id, invoice_id (nullable), customer_id (nullable), recipient snapshot (name, phone, address fields, pincode, state), courier_partner_id, tracking_number, shipped_on, package_count, weight_grams (optional), declared_value_paise (optional), receipt_photo_paths text[], status (`booked` | `picked_up` | `in_transit` | `delivered` | `rto` | `cancelled`), notes, created_by
- `shipment_events`: shipment_id, status, note, created_by, created_at
- `audit_log`: business_id, actor_id, action, entity, entity_id, before jsonb, after jsonb, created_at. Write entries for cancellations, credit notes, stock adjustments, price overrides, role and permission changes, and member deactivation.

**Views / RPCs for reporting:** daily sales summary, payment-mode split, top products, sales by staff, HSN summary, low stock, pending shipments. Group dates in `Asia/Kolkata`, not UTC.

---

## 8. GST and invoicing rules

Implement the tax engine in `/lib/gst` as **pure, heavily unit-tested functions**. The client uses them for live totals. The server **recomputes** totals with the same functions and rejects any mismatch above ₹0.01.

**8.1 Document type by GST scheme**
- `regular` → **Tax Invoice**, with tax charged
- `composition` → **Bill of Supply**, with no tax charged. Print "Composition taxable person, not eligible to collect tax on supplies."
- `unregistered` → **Invoice / Cash Memo**, no GST fields and no GSTIN shown
- If a regular-scheme invoice has only exempt or nil-rated items, it should become a Bill of Supply. Make this configurable and note it in COMPLIANCE_NOTES.

**8.2 Place of supply and tax split**
- Walk-in retail sale → place of supply = the outlet's state
- B2B sale → the customer's state (from their GSTIN's first 2 digits, or their billing state)
- Goods shipped to a customer in another state → the delivery address state
- The cashier can override the place of supply with a reason, which is logged in the audit log
- Same state as the outlet's GSTIN state → **CGST + SGST** (half the rate each). Different state → **IGST** (full rate)

**8.3 Line calculation** (all money in paise, intermediate math in decimal.js, round half-up to the paisa)
- **Price excludes tax:** `taxable = qty × unit_price − discount`; `tax = round(taxable × rate / 100)`
- **Price includes tax** (typical for retail/MRP): `gross = qty × unit_price − discount`; `tax = round(gross − gross / (1 + rate/100))`; `taxable = gross − tax`. This guarantees `taxable + tax = gross` exactly.
- Intra-state: `cgst = floor(tax / 2)` paise, `sgst = tax − cgst` (so odd paise are never lost)
- Cess: computed on the taxable value at `cess_rate`, default 0
- Invoice totals are the sum of the lines. If `round_off_enabled`, round the grand total to the nearest rupee and store the difference in `round_off_paise`
- Discounts: per line (amount or %), plus an optional bill-level discount distributed across lines in proportion to their value **before** tax is computed. Enforce the role's `max_discount_percent`.

**8.4 Invoice numbering**
- Unique within the financial year for that GSTIN. Consecutive. **Maximum 16 characters**. Only `A–Z`, `0–9`, `-` and `/` allowed.
- Default format: `{PREFIX}/{FY}/{SEQ}`, e.g. `C1/2627/00042`. Validate the length when the prefix is configured.
- Financial year: April 1 to March 31, computed in IST. Series reset each FY.
- **Server-allocated series** (back-office billing): allocate with an RPC that locks the series row (`SELECT … FOR UPDATE`) inside the posting transaction, so there are no gaps or duplicates under concurrency.
- **Device series** (POS): each registered POS device gets its own series (a distinct prefix, e.g. `C1`, `C2`). Only that device issues numbers in its series, both online and offline. The device keeps a local counter. The server validates uniqueness on sync and flags any gap for the owner.
- Cancelled invoices keep their number. Numbers are never reused.

**8.5 What the printed invoice must contain** (based on CGST Rule 46; verify against the current rule text and record the result in COMPLIANCE_NOTES)
- Supplier: name, address, GSTIN, state name and code
- Document title (Tax Invoice / Bill of Supply / Cash Memo), invoice number, date
- Recipient: name, address and GSTIN for registered recipients. For unregistered recipients above the value threshold set in the rule, name, address and state are required. Make the threshold a config constant.
- Per line: description, HSN code, quantity, unit, rate, discount, taxable value, tax rate, and tax amount split by CGST/SGST/IGST/cess
- Place of supply (state name and code), whether reverse charge applies (default "No")
- Totals, round-off, amount in words (Indian system: lakh, crore)
- Bank details, UPI QR code (generated from `upi_id` and the amount), terms, footer, "Authorised Signatory"
- Business logo and brand colour
- HSN digits shown: configurable (4 or 6) per business

**8.6 Corrections**
- Posted invoices cannot be edited
- **Cancel**: requires `sales.cancel` and a reason. Reverses stock with `sale_cancel` movements. Default policy: only allowed on the same day; make it configurable.
- **Credit note**: requires `sales.credit_note`. Supports full or partial returns, has its own numbering series, references the original invoice, and optionally restocks items.

**8.7 Validation helpers** (with unit tests)
- GSTIN format and **checksum validation** (15 characters: 2-digit state code + PAN + entity code + `Z` + check character computed with the standard mod-36 algorithm). Derive state code and PAN from it.
- State and UT code list, including special codes (e.g. 97 Other Territory)
- PAN format, IFSC format, Indian pincode, and Indian mobile number (normalise to `+91XXXXXXXXXX`)
- Amount in words, Indian system: "Rupees One Lakh Twenty-Three Thousand Four Hundred Fifty-Six and Fifty Paise Only"

---

## 9. Module specifications

### 9.1 Onboarding wizard
Steps (progress saved after every step, so the user can resume):
1. **Business details**: legal name, trade name, GST scheme, GSTIN (validated live; auto-fills state and PAN), address, pincode, phone, email
2. **Branding**: logo upload (crop to square, compress), brand colour, live invoice preview
3. **Payment details**: bank account, IFSC, UPI ID (shown as a QR code on invoices)
4. **First outlet**: prefilled from the business address
5. **Invoice settings**: series prefix, default print format (A4 / 80mm / 58mm), round-off, terms and conditions, footer note
6. **Invite staff**: optional, can be skipped
7. **Add products**: manual entry, CSV import, or skip

Finish on the dashboard with a "Getting started" checklist (add products, make the first bill, invite staff, set up the printer).

### 9.2 Staff and roles
- Members list with role, outlet access, status and last active time
- Invite / resend / revoke invites, change role, deactivate
- Role editor: grouped permission toggles, max discount %
- Guard: the last active Owner cannot be removed or demoted

### 9.3 Products and categories
- Fast list with search (name / SKU / barcode), filters (category, low stock, inactive)
- Create/edit form with HSN, GST rate (picked from `gst_rates`), unit (from `units`), inclusive/exclusive price, MRP, purchase price (hidden without `products.view_cost`), opening stock per outlet
- **CSV import**: downloadable template, row-level validation with an error report, preview before committing, upsert by SKU
- Barcode: accept a scanned value. Optionally generate internal barcodes and print labels (stretch goal).

### 9.4 Customers and vendors
- Customers: quick-add from POS by phone number; B2B fields with GSTIN validation; purchase history; WhatsApp opt-in flag with timestamp
- Vendors: full details with GSTIN validation; purchase history; outstanding payable amount

### 9.5 Purchases
- New purchase bill: pick or create a vendor, enter the vendor's invoice number and date, add lines (pick a product or create one inline), compute tax (same engine; place of supply decides CGST/SGST vs IGST), attach photos/PDFs of the bill
- Save as **draft** or **post**. Posting creates `purchase` stock movements and locks the document.
- Record payments against the bill; show payment status
- Keep the "attach bill → draft → review → post" flow clean. In Phase 2, AI will fill the draft from the attachment.

### 9.6 Inventory
- Stock by outlet, low-stock list, full movement ledger per product
- Stock adjustment with a required reason (damage, theft, recount, other); logged in the audit log
- `allow_negative_stock` business setting. If enabled, warn but allow the sale. If disabled, block it.

### 9.7 POS billing (the most important screen)
- **Full-screen**, keyboard-first on desktop, touch-friendly on tablet
- Barcode scanner support: scanners type into the focused field and send Enter. Scanning an item already in the cart increases its quantity.
- Product search with keyboard navigation. Keyboard shortcuts: e.g. F2 search, F4 customer, F8 discount, F9 pay, Esc clear. Show a shortcut legend.
- Cart: change quantity, per-line discount, price override (requires permission), remove line
- Customer: optional for B2C walk-ins (phone lookup / quick-add); required with GSTIN for B2B. Toggle B2C/B2B.
- Live totals with the tax breakdown
- **Payment dialog**: split payments across modes, cash tendered and change due, UPI QR for the exact amount, "credit" (amount due from customer) only when a customer is selected
- After posting: print (thermal or A4, per the device's default), send on WhatsApp (if the customer has opted in, with a checkbox to capture opt-in), send by email, new bill
- Hold / park a bill and resume it later (stored locally)
- Every posted invoice also creates its stock movements and queues its notifications in **one RPC transaction**

### 9.8 Invoice output
- **A4 PDF** with `@react-pdf/renderer`: one professional master template filled from business and outlet settings
- **Thermal print**: a dedicated print route with `@page` CSS for 58mm and 80mm widths, monospace-friendly layout, logo optional; printed through the browser print dialog
- **Public invoice page** `/i/[token]`: read-only invoice view with a PDF download, the business logo and contact details. `noindex`, rate-limited, unguessable 32-byte token, and revocable by the owner.

### 9.9 Receipt delivery (email + WhatsApp)
- Use a **transactional outbox**: the invoice RPC inserts `notification_jobs`, and a processor sends them
- Processor: `/api/jobs/notifications`, protected by a shared secret. It is triggered right after posting and also by a **pg_cron + pg_net** schedule every minute for retries. Use exponential backoff and stop after 5 attempts.
- **Email** (Resend): branded email with the PDF attached and the public link
- **WhatsApp** (Meta Cloud API): an approved **utility template** with the invoice PDF as a document header and a button linking to `/i/[token]`. Only send to customers who have opted in, and store the opt-in.
- Define `EmailProvider` and `WhatsAppProvider` interfaces. Provide `ResendEmailProvider`, `MetaWhatsAppProvider` and `ConsoleMockProvider` (the default in development).
- Show delivery status on the invoice detail page, with a "resend" action
- Document the WhatsApp setup steps (Meta business verification, phone number, template approval) in RUNBOOK.md

### 9.10 Shipments / courier log
- **Mobile-first** screen for dispatch staff
- Create a shipment from an invoice (prefills customer and address) or standalone
- Fields: courier partner, tracking number, recipient details, package count, notes, **receipt photo** (`<input accept="image/*" capture="environment">`, compressed in the browser before upload; multiple photos allowed)
- Status updates create `shipment_events`. Show a status timeline.
- Clickable tracking link built from the partner's `tracking_url_template`
- Lists: pending pickup, in transit, delivered, RTO. Search by tracking number, customer phone or invoice number.
- Manage courier partners in settings

### 9.11 Owner dashboard
All figures in IST, filterable by outlet and date range (Today / Yesterday / 7 days / 30 days / custom):
- Total sales, invoice count, average bill value, total tax collected
- Payment-mode split
- Sales trend chart
- Top products by revenue and by quantity
- Sales by staff member
- Purchases total for the period
- Low-stock items
- Pending shipments and shipments stuck for more than X days
- Recent cancellations and credit notes
- Failed notification count
- Reserve an empty, clearly labelled slot for "Google reviews" (Phase 2). Don't build fake data for it.

### 9.12 Reports (CSV export for each)
- Sales register (invoice-wise)
- Item-wise sales
- HSN-wise summary
- Purchase register
- Stock summary and movement report
- Payment-mode summary
- Shipment report
- Credit notes register

### 9.13 Settings
- Business profile, branding, bank/UPI, invoice settings and preview, outlets, invoice series, POS devices (register, rename, deactivate), courier partners, notification settings, data export

### 9.14 Landing page
- Hero, problem → solution, feature sections (billing, inventory, purchases, staff, dispatch, dashboard), "coming soon" for Google, Shopify and AI bill scanning, how it works in 3 steps, pricing placeholder, FAQ, CTA, footer with legal pages
- Fast and SEO-friendly: metadata, OpenGraph tags, sitemap
- Original, distinctive design. Don't copy any competitor's look.
- Brand voice: **EkDum, powered by NineAgents**. Use a Hinglish-friendly, GenZ-but-trustworthy tone with the tagline "Poora dhandha, ekdum sorted." Show "Powered by NineAgents" in the footer and on the login/signup pages.

---

## 10. Offline POS (PWA)

- Serwist service worker. The POS route and its assets are cached for offline use.
- Dexie stores: product catalog snapshot (for that outlet, including prices and tax), customers cache, device series state, parked bills, and a **pending invoices queue**
- Show a clear online/offline indicator, the number of pending bills, and the last sync time
- **Offline billing flow:** compute totals locally with the same `/lib/gst` engine → assign the next number from the device's local series → save to the queue → print. When the connection returns, sync.
- **Sync:** POST batches to `/api/pos/sync` with `client_uuid` as the idempotency key. The server recomputes totals, validates the number against the device series, posts through the same RPC, and returns per-invoice results. Retry failures; show conflicts to the user and never silently drop them.
- The catalog refreshes on login, every N minutes while online, and on demand
- Prices used offline are the prices on the bill. The server accepts them (the customer has already been billed) but logs any price that differs from the product master.
- Notifications for offline bills are queued when the bill syncs

---

## 11. File storage

Supabase Storage buckets, with paths always starting with `{business_id}/` and storage RLS policies based on membership:
- `logos`: public read
- `purchase-attachments`: private
- `shipment-receipts`: private
- `invoice-pdfs`: private (generated PDFs; served through signed URLs or the public-token route)

Compress images in the browser before upload. Enforce file type and size limits on the server.

---

## 12. Security and compliance

- RLS on every table and storage bucket. Use security-definer functions only where needed, with a fixed `search_path` and their own permission checks.
- Server Actions and Route Handlers re-check permissions. Never trust client-side role flags.
- Rate-limit auth endpoints, the public invoice page and the sync endpoint.
- Write audit log entries for every sensitive action listed in section 7.
- Never log full bank account numbers or tokens. Mask the account number in the UI except in settings.
- Add CSP and other security headers.
- Data export for the owner (CSV of all core entities).
- `docs/COMPLIANCE_NOTES.md` lists every GST / legal assumption, its source, and the date it was verified.

---

## 13. UX and UI guidelines

- Clean, professional and fast. Use the Indian number format via `Intl.NumberFormat('en-IN')` (e.g. ₹1,23,456.00) and DD/MM/YYYY dates in IST.
- Responsive layouts. POS is optimised for desktop and tablet; shipments for phones; dashboard for all sizes.
- Every list has search, filters, pagination or virtualisation, and empty states with a clear next action.
- Use optimistic UI only where it is safe. Never use it for posting invoices.
- Accessible: keyboard navigation, focus states, labels, sufficient contrast.
- Toasts for success and failure. Confirmation dialogs for destructive actions.
- Loading skeletons. No layout shift on the POS screen.

---

## 14. Testing and quality

- **Unit (Vitest):** the GST engine (inclusive/exclusive prices, intra/inter-state, odd-paise splits, bill discounts, round-off, cess, zero-rated items), invoice number formatting and FY calculation, GSTIN checksum, amount in words, Indian money formatting. Aim for very high coverage on `/lib/gst` and `/lib/money`.
- **Database (Supabase local):** RLS tests across two businesses and several roles; RPC tests for posting invoices and purchases, concurrent number allocation, cancellation, credit notes and stock consistency.
- **E2E (Playwright):** signup → onboarding → add product → POS bill → PDF and print view → notification job queued → dashboard updated; purchase posting increases stock; offline bill → reconnect → synced; shipment created with a photo and status updated.
- Seed script with a demo business, 50 products, customers, vendors, and a few days of sales.

---

## 15. Environment variables (document all in `.env.example`)

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_APP_URL=
JOBS_SECRET=
RESEND_API_KEY=
EMAIL_FROM=
WHATSAPP_PROVIDER=mock            # mock | meta
META_WA_PHONE_NUMBER_ID=
META_WA_ACCESS_TOKEN=
META_WA_INVOICE_TEMPLATE_NAME=
META_WA_TEMPLATE_LANGUAGE=en
```

---

## 16. Milestones

Stop after each milestone and produce the handoff report (section 17).

**M0 — Plan and scaffold**
Read this whole prompt. Reply with your plan, the risks you see and your questions. After approval: scaffold Next.js, Tailwind, shadcn/ui, ESLint/Prettier, Vitest, Playwright, Supabase local, folder structure, base layout, and the `docs/` files.
*Done when:* the app runs locally, the test runners work, and Supabase local is up.

**M1 — Auth, tenancy, onboarding, staff**
Auth pages, profiles, businesses, outlets, roles, permissions, memberships, invites, the onboarding wizard, the business/outlet switcher, RLS helpers and policies, the audit log table.
*Done when:* a new user can sign up, complete onboarding and invite a cashier who logs in with restricted access. RLS tests pass.

**M2 — Master data**
Units, GST rates, categories, products (with opening stock), CSV import, customers, vendors, validation helpers in `/lib/gst`.
*Done when:* products can be created and imported, GSTINs are validated, and unit tests pass.

**M3 — Inventory and purchases**
Stock ledger and trigger, stock levels, adjustments, purchase bills (draft/post), attachments, payments.
*Done when:* posting a purchase increases stock correctly and the ledger reconciles with stock levels.

**M4 — POS and invoicing**
GST engine, invoice series and allocation, the POS screen, the posting RPC, payments, A4 PDF, thermal print views, invoice list/detail, cancellation, credit notes.
*Done when:* B2C and B2B bills compute correctly (intra and inter-state), concurrent allocation never duplicates a number, cancellation and credit notes reverse stock, and the PDF contains every required field.

**M5 — Receipts and the public invoice page**
Outbox, processor, pg_cron schedule, email and WhatsApp providers (mock + real), opt-in capture, delivery status and resend, the `/i/[token]` page.
*Done when:* posting a bill queues jobs, the mock provider "sends" them, retries work, and the public link renders.

**M6 — Shipments**
Courier partners, shipment create/list/detail, photo upload, status timeline, tracking links, search.
*Done when:* dispatch staff can log a shipment from a phone with a photo and update its status.

**M7 — Dashboard and reports**
Reporting views/RPCs, the dashboard, all reports with CSV export, outlet and date filters, IST correctness.
*Done when:* dashboard figures match the raw data in tests, including across the IST midnight boundary.

**M8 — Offline POS**
Serwist, Dexie, the device registration and series flow, the offline queue, the sync endpoint, conflict UI.
*Done when:* bills made offline sync correctly after reconnecting, with no duplicates and no lost bills (e2e test).

**M9 — Landing page and hardening**
Landing page, legal page placeholders, security headers, rate limits, a full e2e pass, performance pass, RUNBOOK completed, demo seed data.
*Done when:* all tests are green and the runbook lets a new developer deploy to Vercel + Supabase Cloud.

---

## 17. Handoff report format (end of every milestone)

1. **Summary**: what was built
2. **Files changed / added**, grouped by area
3. **Migrations** added, with a one-line purpose for each
4. **How to test manually**: step by step
5. **Test results**: typecheck, lint, unit, DB and e2e
6. **Decisions made** and why
7. **Compliance assumptions** added to COMPLIANCE_NOTES.md
8. **Known issues / TODOs**
9. **Questions for the human**

Remember: **do not commit or push.** Leave the working tree for review.

---

## 18. Open decisions (defaults in brackets; the human may override)

- Product name: **EkDum**, powered by NineAgents (decided). Tagline: "Poora dhandha, ekdum sorted." Domain: [to be confirmed; use `NEXT_PUBLIC_APP_URL` everywhere and never hardcode a domain]
- Staff login: [email + password only in Phase 1; a quick PIN switch on shared POS devices is a stretch goal]
- Negative stock: [allowed with a warning]
- Cancellation window: [same day only]
- WhatsApp: [Meta Cloud API directly, behind the provider interface, so a BSP such as Gupshup/Interakt/AiSensy can be swapped in]
- Email: [Resend]
- HSN digits on invoices: [4, configurable to 6]
- Default print format: [80mm thermal at POS, A4 for back-office and PDFs]
- Round-off: [on, to the nearest rupee]
- One GSTIN per business, with outlets in other states allowed their own GSTIN: [yes]
