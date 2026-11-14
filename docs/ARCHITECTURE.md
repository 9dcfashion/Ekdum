# EkDum · Architecture

Phase 1 of EkDum: GST billing + POS, purchases, inventory, staff roles, receipts,
shipments and an owner dashboard for Indian shops. Multi-tenant SaaS.

## Stack

| Concern | Choice |
|---|---|
| Framework | Next.js 16 (App Router, Turbopack, React 19, React Compiler), TypeScript strict |
| Database / Auth / Storage | Supabase (Postgres + RLS, Auth, Storage, pg_cron, pg_net) |
| Supabase client | `@supabase/ssr` (cookie sessions) |
| UI | Tailwind CSS v4, shadcn/ui (Radix), lucide-react |
| Forms | React Hook Form + Zod 4 (schemas shared by client and server) |
| Money | integer paise + `decimal.js` |
| PDF | `@react-pdf/renderer` (server) |
| Offline | Serwist service worker + Dexie (IndexedDB) |
| Tests | Vitest (unit + database via PGlite), Playwright (e2e) |

`cacheComponents` is **off**: every authenticated page is rendered per request.
A billing app must never show stale stock or sales, and nothing here benefits from a static shell.

## Folder map

```
app/
  (marketing)/            landing + legal pages (public)
  (auth)/                 login, signup, forgot/reset password, accept-invite
  auth/confirm/           landing route for Supabase email links
  onboarding/             7-step setup wizard
  app/                    everything behind sign-in (force-dynamic)
    (shell)/              pages with sidebar + top bar
      dashboard/ sales/ purchases/ products/ inventory/ customers/
      vendors/ shipments/ reports/ staff/ settings/
    pos/                  full-screen billing (no shell)
  i/[token]/              public invoice page (no auth, noindex)
  api/
    pos/sync/             offline sync endpoint
    jobs/notifications/   outbox processor (Bearer JOBS_SECRET)
    invoices/[id]/pdf/    invoice PDF (session, or ?token= public token)
components/
  ui/                     shadcn primitives (do not edit by hand)
  shared/                 PageHeader, EmptyState, Field, list controls, ConfirmDialog, StatusBadge …
  app/                    shell: sidebar, switchers, user menu
  <feature>/              feature components (pos, invoice, …)
lib/
  supabase/               server / browser / admin clients, session proxy
  auth/                   context (user, business, outlet, permissions), permission keys
  gst/                    tax engine, GSTIN, states, numbering, amount in words  (pure, unit tested)
  money/  dates/          paise helpers, INR formatting, IST dates, financial year
  validation/             Zod schemas shared by forms and Server Actions
  sales/post.ts           the single code path that turns a sale into an invoice
  providers/              EmailProvider / WhatsAppProvider + mock, Resend, Meta, Evolution
  notifications/          outbox worker
  pdf/  invoices/         invoice templates and loaders
  offline/                Dexie schema, sync queue
  actions.ts              runAction(), ActionResult, DB error mapping
supabase/
  migrations/             the schema, in order. Never edit the database by hand.
  ekdum_schema.sql        all migrations bundled into one file (pnpm db:bundle)
  seed.sql                demo data
  tests/                  RLS + RPC tests (PGlite; no Docker needed)
proxy.ts                  session refresh + optimistic auth redirects
```

## Security model

1. **RLS is the guard.** Every table has RLS enabled (a test fails the build otherwise).
   Policies call three `security definer` helpers: `is_member(business)`,
   `has_perm(business, perm)`, `can_access_outlet(outlet)`. Deactivating a member
   takes effect on the next query because `is_active` is checked inside them.
2. **Three clients.**
   - `lib/supabase/server` — the user's session; RLS applies. Default for everything.
   - `lib/supabase/browser` — same, in Client Components (uploads, a few live queries).
   - `lib/supabase/admin` — service role, bypasses RLS. `server-only`. Used only for:
     posting invoices and saving purchase bills (after the server has recomputed them),
     invitations, the notification worker, the public invoice page, rate limits.
3. **Financial writes go through Postgres functions** so they are atomic:
   `post_sales_invoice`, `cancel_sales_invoice`, `create_credit_note`,
   `record_sale_collection`, `save_purchase_bill`, `post_purchase_bill`,
   `cancel_purchase_bill`, `adjust_stock`, `set_opening_stock`.
   Tables holding posted documents have **no** insert/update/delete grant for
   signed-in users, and triggers make posted rows immutable even for the table owner.
4. **Server-only RPCs** (`post_sales_invoice`, `save_purchase_bill`, `accept_invitation`,
   notification worker functions, `check_rate_limit`) are granted to `service_role` only
   and take the acting user as `p_actor`; the function still checks that user's permissions.
5. **Cost prices** live in `product_costs`, not `products`, because RLS filters rows, not columns.
6. Cookies `ekdum_business` / `ekdum_outlet` are hints. `loadContext()` re-validates them
   against live membership on every request.
7. `proxy.ts` only refreshes the session and redirects signed-out users. It is never the only check.

## Conventions

### Pages (Server Components)

```tsx
export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requirePage("products.view");      // redirects if not allowed
  const sp = await searchParams;                        // params/searchParams are Promises in Next 16
  const { data } = await ctx.supabase.from("products").select("*").eq("business_id", ctx.business.id);
  …
}
```

- `ctx.business`, `ctx.outlet` (active outlet), `ctx.outlets`, `ctx.can("perm")`, `ctx.user`, `ctx.role`.
- Always filter by `business_id` (and `outlet_id` where relevant) even though RLS would also do it:
  it keeps queries on the right indexes and makes intent obvious.
- List filters live in the URL (`lib/list.ts`: `param`, `pageParam`, `pageRange`, `PAGE_SIZE`;
  `components/shared/list-controls.tsx`: `SearchInput`, `FilterSelect`, `FilterDate`, `Pagination`).
- Every list has an `EmptyState` with a next action.

### Server Actions

```ts
"use server";
export async function saveThingAction(input: unknown) {
  return runAction(thingSchema, input, { perm: "things.manage" }, async (data, ctx) => {
    const row = unwrap(await ctx.supabase.from("things").insert({ ...data, business_id: ctx.business.id }).select("id").single());
    revalidatePath("/app/things");
    return row;
  });
}
```

- `runAction` = signed in → Zod validate → permission check → run. It returns
  `ActionResult<T>` (`{ ok: true, data } | { ok: false, error, fieldErrors }`) and never throws to the client.
- `unwrap()` turns a Supabase error into a readable `ActionError`. Throw `new ActionError("…")` for business rules.
- A `"use server"` file may export **only async functions** (no constants, no types with values).
- Client side: `const { run, pending } = useAction(); run(() => saveThingAction(values), { success: "Saved", onSuccess })`.
- Never use optimistic UI for posting documents.

### Forms

React Hook Form + `zodResolver(schema)`; type the form with `z.input<typeof schema>`.
Schemas live in `lib/validation/*` and are imported by both the form and the action.
Money fields are typed as rupee strings in forms (`MoneyInput`) and converted with
`rupeesRequired()` / `rupeesToPaise()`; the database only ever sees integer paise.

### Money, quantities, dates

- Money: integer **paise** everywhere (`bigint` columns, `number` in TS). Format with `formatINR(paise)`.
  Never do float math on money; use `lib/money` and `lib/gst`.
- Quantities: `numeric(12,3)`; pass as strings to the engine. Format with `formatQty`.
- Dates: business dates are IST calendar dates (`YYYY-MM-DD`). `istDateString()`, `formatDate()` (DD/MM/YYYY),
  `formatDateTime()`, `financialYear()`. In SQL: `ist_today()`, `ist_date(ts)`, `financial_year(date)`.

### GST engine (`lib/gst`)

Pure functions. The POS computes live totals with `computeInvoice()`; `lib/sales/post.ts`
recomputes with the same function on the server and rejects any difference; the offline
queue uses it with no network. Rates and units come from the `gst_rates` and `units`
tables, never from constants in code.

## Posting a sale

```
POS / back office / offline sync
   └─ saleInputSchema (lib/validation/sales.ts)
        └─ postInvoice(ctx, data, source)            lib/sales/post.ts
             ├─ permission + outlet access
             ├─ place of supply, intra/inter-state, document type
             ├─ computeInvoice() and compare with the client's totals
             ├─ verify the POS device secret (if a device series is used)
             └─ rpc post_sales_invoice (one transaction)
                  ├─ idempotency on client_uuid
                  ├─ allocate number (row lock) or validate the device's number
                  ├─ invoice + items + payments
                  ├─ stock movements (+ negative-stock rule)
                  ├─ notification_jobs (outbox)
                  └─ audit log (price override, discount, place of supply)
```

### Numbering

`{PREFIX}/{FY}/{SEQ}` (max 16 chars), e.g. `A/2627/00042`. Unique per
(business, seller GSTIN, financial year). Two kinds of series:

- **Server series** (one per outlet): allocated inside the posting transaction under `SELECT … FOR UPDATE`.
- **Device series** (one per registered POS device): the device issues numbers from a local counter,
  online and offline; the server validates prefix, year and uniqueness, and logs gaps to the audit log.

Series roll over automatically on 1 April (IST). Cancelled bills keep their number.

## Cross-module contracts

| What | Where | Notes |
|---|---|---|
| Post a sale | `postInvoice(ctx, data, source)` in `lib/sales/post.ts` | returns `PostResult` |
| Process the outbox | `processDueNotifications(limit)` in `lib/notifications/process.ts` | call inside `after()` right after posting |
| Invoice PDF | `GET /api/invoices/{id}/pdf` (session) or `?token={public_token}` | `?download=1` forces download |
| Thermal / A4 print view | `/app/sales/{id}/print?format=thermal_80|thermal_58|a4` | opens the browser print dialog |
| Public invoice | `/i/{public_token}` | no auth, noindex, rate limited, revocable |
| Delivery status + resend | `<DeliveryStatus invoiceId={…} />` in `components/invoice/delivery-status.tsx` | Server Component |
| Sale detail | `/app/sales/{id}` | |
| Product CSV import | `/app/products/import` | |
| New shipment from invoice | `/app/shipments/new?invoice={id}` | |
| Photos of items given | `<SalePhotoUploader businessId invoiceId />` (`components/sales/sale-photo-uploader.tsx`), `<SalePhotos ctx invoiceId cancelled />` | table `sales_invoice_photos`, bucket `sale-photos/{business}/{invoice}/…`; add: `sales.create` on a visible posted bill; remove: `sales.cancel` (audited) |
| Quick billing items | table `quick_items` (managed in `/app/settings/quick-items`, `lib/quick-items/*`; ready-made sets in `lib/quick-items/packs.ts`); loaded into `PosSettings.quickItems` by `app/app/pos/page.tsx` | tapped at the POS → qty + rate → billed through `addManualItem` (no stock) |
| Manual items (not in product list) | `addManualItem()` in `lib/pos/cart.ts`; line has `product_id = null` | no stock movement; GST rate checked against `gst_rates` on the server |

## Offline POS

Serwist caches the POS route and its assets. Dexie holds a catalog snapshot for the
outlet, a customers cache, the device's series counter, parked bills and the pending
invoice queue. Offline bills are computed with `lib/gst`, numbered from the device
series, queued, printed, and later POSTed in batches to `/api/pos/sync`, which runs the
same `postInvoice()`. `client_uuid` makes retries safe. Conflicts are shown, never dropped.

## Testing

- `pnpm test` — unit tests for `lib/gst`, `lib/money`, `lib/dates`, and database tests
  (`supabase/tests`) that run the real migrations in PGlite with a shim for the Supabase
  roles, `auth.uid()` and storage. Covers tenant isolation, role and outlet restrictions,
  posting, numbering, cancellation, credit notes, purchases, stock, outbox and reports.
- `pnpm test:e2e` — Playwright flows against a running app + Supabase project.
