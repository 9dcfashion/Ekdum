# EkDum · Runbook

How to set up, run, deploy and operate EkDum. Written so a new developer can go
from a fresh clone to a deployed app.

## 1. What you need

- Node.js 22 LTS or newer (20.9+ works) and pnpm (`npm i -g pnpm`)
- A Supabase account
- Later, for production: Vercel, Resend (email), and optionally a Meta WhatsApp Business account

## 2. First-time setup (about 15 minutes)

### 2.1 Create the Supabase project

1. supabase.com → New project. **Region: Mumbai (ap-south-1).** Keep the database password safe.
2. Wait until the project is ready.

### 2.2 Load the schema

1. Supabase dashboard → **SQL Editor** → New query.
2. Open `supabase/ekdum_schema.sql` from this repo, copy everything, paste, **Run**.
   It runs inside one transaction: if anything fails nothing is applied, and you can fix and re-run.
   Run it **once** on a fresh project.
3. You should see "Success. No rows returned". Check **Table Editor**: about 35 tables, each with the RLS shield on.

> `ekdum_schema.sql` is generated from `supabase/migrations/` by `pnpm db:bundle`.
> Never change the database by hand in the dashboard. Add a new migration file, bundle, and run only the new file.

### 2.3 Environment variables

```bash
cp .env.example .env.local
```

Fill in from Supabase → **Project Settings → API**:

| Variable | Where it comes from |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | "anon" / publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | "service_role" / secret key. **Server only. Never commit it, never prefix it with `NEXT_PUBLIC_`.** |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` locally; your real URL in production (no trailing slash) |
| `JOBS_SECRET` | Any long random string: `openssl rand -hex 32` |

Leave `EMAIL_PROVIDER=mock` and `WHATSAPP_PROVIDER=mock` for now: receipts and invites are
printed in the terminal running `pnpm dev` instead of being sent.

### 2.4 Auth settings

Supabase → **Authentication → URL Configuration**:

- **Site URL**: `http://localhost:3000`
- **Redirect URLs**: add `http://localhost:3000/auth/confirm` (and later `https://YOUR-DOMAIN/auth/confirm`)

Supabase → **Authentication → Sign In / Providers → Email**:

- Email provider enabled, password sign-in on.
- **Confirm email**: keep it **on** for production. For quick local testing you may turn it off,
  so signup goes straight to onboarding. With it on, Supabase's built-in mailer sends the
  confirmation link (it is rate limited to a few emails per hour; set up custom SMTP, e.g. Resend's
  SMTP, under Authentication → Emails → SMTP Settings before real use).

### 2.5 Run

```bash
pnpm install
pnpm dev
```

Open http://localhost:3000.

## 3. First run: what to check by hand

1. **Sign up** at `/signup`. If "Confirm email" is on, click the link in the email.
2. **Onboarding** (7 steps): business + GST details (try the sample GSTIN `27AAPFU0939F1ZV`:
   it validates and fills state and PAN), branding (upload a logo, pick a colour, watch the preview),
   bank/UPI (the QR appears), first outlet, invoice settings (prefix `A`), invite staff (optional;
   the invite link is printed in the dev terminal and can be copied), add a product or two.
3. **Dashboard** opens with the getting-started checklist.
4. **Products → New**: add a product with HSN, GST rate, price including tax, opening stock.
5. **Billing (POS)**: search or scan, add to cart, F9 to pay, split cash + UPI, post.
6. **Print**: the thermal view opens the print dialog; the A4 PDF downloads.
7. **Sales → the bill**: delivery status, public link `/i/…` (open it in a private window), PDF.
8. **Inventory**: stock went down by what you sold; the ledger shows the sale.
9. **Purchases → New**: enter a vendor bill, attach a photo, post → stock goes up.
10. **Sales → bill → Credit note**: return one item; stock comes back; the note has its own number.
11. **Staff**: invite a cashier, accept the invite in another browser, confirm they only see POS and their own bills.

### Demo data (optional)

After signing up: open `supabase/seed.sql`, change the email near the top to your login email,
paste it into the SQL Editor and run it. You get "Sharma General Store (Demo)" in the business
switcher with 50 products, customers, vendors, purchases, five days of sales and shipments.

## 4. Tests

```bash
pnpm typecheck
pnpm lint
pnpm test            # unit + database tests; needs nothing running
pnpm test:coverage
```

The database tests (`supabase/tests`) execute the real migration files in PGlite
(Postgres compiled to WebAssembly) with a small stand-in for Supabase's roles and
`auth.uid()`. They prove tenant isolation, role and outlet restrictions, posting,
numbering, cancellation, credit notes, purchases, stock, the receipt outbox and reports.
PGlite is single-connection, so "concurrent" allocation is exercised with interleaved
transactions; a true multi-connection race test needs a real Postgres.

End-to-end (Playwright) tests need the app running against a real Supabase project
with **Confirm email turned off**:

```bash
pnpm exec playwright install chromium     # once
E2E_BASE_URL=http://localhost:3000 pnpm test:e2e
```

## 5. Deploying

### 5.1 Vercel

1. Push the repository to GitHub (the owner does this; see section 9) and import it in Vercel.
2. Framework preset: Next.js. Build command `pnpm build`. Node 22.
3. Add **all** variables from `.env.example` under Project → Settings → Environment Variables.
   `NEXT_PUBLIC_APP_URL` must be the production URL. `SUPABASE_SERVICE_ROLE_KEY`, `JOBS_SECRET`,
   `RESEND_API_KEY`, `META_WA_ACCESS_TOKEN` are secrets: mark them Sensitive.
4. Deploy. Region: choose **Mumbai (bom1)** for functions so the app sits next to the database.
5. In Supabase Auth → URL Configuration, set the Site URL to the production URL and add
   `https://YOUR-DOMAIN/auth/confirm` to the redirect URLs.

### 5.2 Receipt retries (pg_cron + pg_net)

Receipts are sent right after a bill is posted. Failed sends are retried by a database
schedule that calls the app every minute. Set it up **after** the app is deployed:

1. Supabase → Database → Extensions: enable **pg_cron** and **pg_net** (the script also tries to).
2. SQL Editor, run once, with your real values:
   ```sql
   select vault.create_secret('https://YOUR-DOMAIN', 'ekdum_app_url');
   select vault.create_secret('THE_SAME_VALUE_AS_JOBS_SECRET', 'ekdum_jobs_secret');
   ```
3. Run `supabase/ekdum_scheduler.sql`.
4. Check: `select jobname, schedule, active from cron.job;` shows `ekdum-notification-outbox`.
   Until both secrets exist the job does nothing, so the order of steps 2 and 3 does not matter.

Retries back off 2, 4, 8, 16 minutes and stop after 5 attempts. Failed jobs are shown on the
bill's page (with Resend) and counted on the dashboard.

Manual trigger (useful for debugging):

```bash
curl -X POST https://YOUR-DOMAIN/api/jobs/notifications -H "Authorization: Bearer $JOBS_SECRET"
```

### 5.3 Email (Resend)

1. resend.com → add and verify your sending domain (DNS records).
2. Create an API key.
3. Set `EMAIL_PROVIDER=resend`, `RESEND_API_KEY=…`, `EMAIL_FROM="EkDum <bills@your-domain>"`.
4. Post a bill with an email address and check the delivery status on the bill page.

### 5.4 WhatsApp (Meta Cloud API)

This takes days, not minutes, because Meta reviews the business and the template.

1. **Meta Business account** at business.facebook.com. Complete **Business Verification**
   (Security Centre): legal name, address, GST certificate or other proof.
2. **Create an app** at developers.facebook.com (type: Business) and add the **WhatsApp** product.
3. **Add a phone number** that is not already on WhatsApp (or migrate it), verify it by OTP,
   set the display name (Meta reviews it).
4. **Create the message template** in WhatsApp Manager → Message templates:
   - Category: **Utility**. Language: English (`en`). Name: e.g. `invoice_receipt`.
   - **Header**: Document.
   - **Body** (four variables, in this order):
     `Hi {{1}}, thank you for shopping at {{2}}. Your bill {{3}} for {{4}} is attached.`
   - **Button**: Visit website, **Dynamic URL**: `https://YOUR-DOMAIN/i/{{1}}`
   - Submit and wait for approval.
5. **Permanent access token**: Business Settings → System users → create a system user, assign the
   app and the WhatsApp account, generate a token with `whatsapp_business_messaging` and
   `whatsapp_business_management`.
6. Set:
   ```
   WHATSAPP_PROVIDER=meta
   META_WA_PHONE_NUMBER_ID=…        # from WhatsApp → API setup (the ID, not the phone number)
   META_WA_ACCESS_TOKEN=…           # the system-user token
   META_WA_INVOICE_TEMPLATE_NAME=invoice_receipt
   META_WA_TEMPLATE_LANGUAGE=en
   ```
   `META_GRAPH_VERSION` is optional; set it when Meta retires the default version.
7. Messages go only to customers with the WhatsApp opt-in ticked. The PDF in the header is fetched
   by Meta from `https://YOUR-DOMAIN/api/invoices/{id}/pdf?token=…`, so it only works on a public URL
   (not localhost).

A BSP (Gupshup, Interakt, AiSensy …) can be used instead by adding another class that
implements `WhatsAppProvider` in `lib/providers/whatsapp.ts`.

## 6. Operating

### Printers

Thermal printing uses the browser's print dialog. On the billing computer: install the
printer's driver, then in the print dialog choose the thermal printer, paper width 80 mm
(or 58 mm), margins **None**, and turn off headers and footers. In Chrome you can start it
with `--kiosk-printing` to skip the dialog. Barcode scanners need no setup: they behave like a keyboard.

### POS devices and offline billing

Settings → POS devices → "Register this device" gives that browser its own bill number
prefix (for example `C1`). Only registered devices can bill offline. Bills made offline are
queued on the device and sync when the connection returns. **Do not clear the browser's site
data on a billing device while it shows pending bills**: unsynced bills live only there.

### Adding a new financial year

Nothing to do. On 1 April (IST) each series rolls over automatically and numbering restarts at 1.

### Changing the schema

1. Add `supabase/migrations/<timestamp>_<name>.sql`. New tables need `enable row level security`,
   policies, and grants (see the grants migration: new functions are not callable through the API
   until granted).
2. `pnpm test` (the migration test fails if a table has no RLS, a foreign key has no index, or a
   security-definer function has no fixed `search_path`).
3. Run the new file in the SQL Editor (or `supabase db push` if you adopt the Supabase CLI), then `pnpm db:bundle`.
4. Types: `lib/types/db.ts` is hand-written. With the CLI you can generate types instead:
   `pnpm dlx supabase gen types typescript --project-id <ref> > lib/types/database.ts`.

### Backups

Supabase takes daily backups on paid plans; enable Point-in-Time Recovery for production.
Owners can export their own data as CSV from Settings → Data export.

## 7. Security checklist before going live

- [ ] Supabase project is in Mumbai; RLS shield shows on every table.
- [ ] `SUPABASE_SERVICE_ROLE_KEY` exists only in server environment variables.
- [ ] "Confirm email" is on; custom SMTP is configured; leaked-password protection is on (Auth settings).
- [ ] `JOBS_SECRET` is long and random; the scheduler's Vault secret matches it.
- [ ] Site URL and redirect URLs in Supabase Auth list only your domains.
- [ ] `NEXT_PUBLIC_APP_URL` is the HTTPS production URL.
- [ ] A CA has reviewed `docs/COMPLIANCE_NOTES.md`.
- [ ] Legal pages (privacy, terms) have been replaced with reviewed text.

## 8. Troubleshooting

| Symptom | Likely cause |
|---|---|
| Every page redirects to `/setup` | `.env.local` keys missing or the dev server was not restarted |
| "permission denied for table …" in the browser | The schema script did not finish, or a later migration is missing its grants |
| Signup works but no email arrives | Supabase's built-in mailer is rate limited; check Auth → Logs, or turn "Confirm email" off locally |
| Confirmation link says it expired | The redirect URL is not in the allow list, or the link was opened twice |
| "No invoice number series is set up for this outlet" | Add a series in Settings → Invoice series |
| Bill posts but no receipt | Provider is `mock` (look in the server log), or the customer has not opted in to WhatsApp |
| Receipts never retry | The scheduler is not set up (5.2) or the Vault secrets are wrong |
| Logo does not show | The `logos` bucket must be public (the schema script creates it that way) |
| PDF shows "Rs." instead of ₹ | Intended: the built-in PDF font has no rupee glyph |

## 9. Source control

This working tree is not a git repository yet, by the owner's choice. To connect GitHub:

```bash
git init
git add .
git commit -m "EkDum Phase 1"
git branch -M main
git remote add origin git@github.com:YOUR-ORG/ekdum.git
git push -u origin main
```

`.gitignore` already excludes `.env*` (except `.env.example`), `node_modules` and build output.
Check `git status` before the first commit to be sure no secret file is staged.
