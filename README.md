# EkDum

**Poora dhandha, ekdum sorted.** A shop operating panel for Indian retailers, powered by NineAgents.

Phase 1: GST billing and POS, purchases, inventory, staff roles, digital receipts,
a courier dispatch log and an owner dashboard. Next.js 16 + Supabase.

## Quick start

```bash
pnpm install
cp .env.example .env.local      # then fill in your Supabase keys
pnpm dev                        # http://localhost:3000
```

Before the app can do anything it needs a Supabase project with the schema loaded.
The step-by-step guide is in [docs/RUNBOOK.md](docs/RUNBOOK.md). Until the keys are
set, the app shows a setup page at `/setup`.

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Run the app locally |
| `pnpm build` / `pnpm start` | Production build / serve it |
| `pnpm typecheck` | TypeScript, no emit |
| `pnpm lint` | ESLint |
| `pnpm test` | Unit tests + database tests (in-memory Postgres; no Docker needed) |
| `pnpm test:coverage` | The same with coverage for `lib/gst` and `lib/money` |
| `pnpm test:e2e` | Playwright end-to-end tests (needs a running app and a Supabase project) |
| `pnpm db:bundle` | Rebuild `supabase/ekdum_schema.sql` from `supabase/migrations/` |

## Documents

- [docs/RUNBOOK.md](docs/RUNBOOK.md): set up, run, deploy, operate
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): how the code is organised and why
- [docs/COMPLIANCE_NOTES.md](docs/COMPLIANCE_NOTES.md): every GST assumption and what still needs a CA's sign-off
- [MASTER_PROMPT_PHASE1.md](MASTER_PROMPT_PHASE1.md): the product specification
