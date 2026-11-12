# DECA

DECA is the rebuilt ACEDXTRADES exchange app, built from the "ACEDXTRADES App Revamp PRD". It focuses on speed, clarity, trust and habit: every action ends in a clear **pending, successful or failed** state, and every fee and rate is shown before you confirm.

**It runs in sandbox mode by default. All providers are simulated and no real money can move.**

Stack: Next.js 15 (App Router) + React 19, TypeScript, Tailwind CSS 4, PostgreSQL (embedded PGlite for local dev), zod. No ORM: money code uses explicit SQL.

## What is built (PRD section 7)

| PRD area | Where |
| --- | --- |
| Onboarding (4 steps, guided first transaction, KYC explanation) | `/onboarding` |
| Home dashboard (balance, Deposit / Withdraw / Swap / Bills one tap away, status, recent activity) | `/app` |
| Wallet with available, incoming (pending) and on hold (pending) balances | `/app/wallet` |
| Crypto deposit, withdraw (crypto and NGN bank), swap with locked quote | `/app/deposit`, `/app/withdraw`, `/app/swap` |
| Airtime, data, electricity, cable, saved beneficiaries | `/app/bills` |
| Gift cards with instructions, status tracker (Submitted, Reviewed, Paid), review time | `/app/giftcards` |
| Virtual and physical cards: funding, limits, freeze, delivery tracking, history | `/app/cards` |
| Activity, receipts (printable), live status | `/app/activity` |
| Profile, KYC tiers, security (password, devices), support | `/app/profile`, `/app/support` |
| Admin: gift card review queue, transaction monitoring, reconciliation flags | `/admin` |

## Quick start (local)

Requires Node 20.9 or newer.

```bash
npm install
cp .env.example .env.local      # placeholders are fine for local development
npm run db:seed                 # creates admin and demo users, prints passwords
npm run dev                     # http://localhost:3000
```

With `DATABASE_URL` empty, DECA uses an embedded Postgres (PGlite) in `./.data`, migrated automatically. No Docker or database install needed. Delete `./.data` to reset.

Seeded accounts (sandbox only): `admin@example.com` (admin) and `demo@example.com` (funded with fake NGN and USDT). Passwords come from `SEED_ADMIN_PASSWORD` / `SEED_DEMO_PASSWORD`, or are generated and printed once.

Useful commands:

```bash
npm test              # 11 tests: ledger, idempotency, concurrency, webhooks, reversals, swaps
npm run typecheck
npm run db:verify     # asserts every wallet balance equals the sum of its ledger entries
npm run db:migrate    # applies db/migrations to DATABASE_URL (production)
```

## Deploy to Vercel

1. **Database.** Create a Postgres database (Vercel Postgres/Neon, Supabase, etc.) and copy its connection string.
2. **Import** the repository into Vercel (framework: Next.js, defaults are fine).
3. **Environment variables** (Project Settings, Environment Variables). Generate secrets with `openssl rand -base64 32`:
   - `DATABASE_URL` (required in production, the app refuses to start without it)
   - `SESSION_SECRET`, `ENCRYPTION_KEY` (must decode to exactly 32 bytes), `CRON_SECRET`
   - `APP_URL` (your production URL)
   - Leave `DECA_MODE=sandbox` and `ALLOW_LIVE_MONEY=false`.
4. **Run migrations** once from your machine: `DATABASE_URL="..." npm run db:migrate`. Then optionally `DATABASE_URL="..." SEED_ADMIN_EMAIL=you@yourdomain.com npm run db:seed` to create the admin (production seeding skips the demo user and uses a random password it prints once).
5. **Deploy.** `vercel.json` registers a cron that calls `/api/cron/reconcile` every 5 minutes (Vercel sends `CRON_SECRET` as a bearer token automatically). Note: sub-daily cron schedules need a Vercel plan that allows them; the app also reconciles lazily whenever a user opens Wallet, Activity or a receipt.
6. **Webhooks.** When you connect real providers, point them at `https://YOUR_DOMAIN/api/webhooks/crypto`, `/cards` and `/bills`.

Gift card images are stored in Postgres (limit 3 images, 1 MB each) so the app works with no extra services. For production scale, move them to private object storage (for example Vercel Blob) behind the same authenticated route.

## What is simulated

| Area | Sandbox behaviour |
| --- | --- |
| Crypto deposit addresses | Fake `SBX-...` addresses (can never receive real funds). "Simulate deposit" in the Deposit screen fires a signed webhook through the real handler. |
| Withdrawals, bank payouts, bills | Mock provider with realistic async lifecycle: pending, processing, then success, failed or reversed after a few seconds. |
| Swap rates | Simulated prices with small drift (`src/lib/rates.ts`). Quote lock and expiry logic is real. |
| Cards | Mock issuer. Physical delivery stages advance over about 100 seconds. Card PAN/CVV are never stored. "Simulate purchase" tests limits and freeze. |
| KYC | Mock verifier. Phone OTP is shown on screen. |
| Fees, limits, bank list, gift card rates | Placeholder values in `src/lib/catalog.ts`. Replace with your commercial terms and the provider's bank list. |

Deterministic sandbox triggers (use them to test failure paths):

- Crypto address ending `0000` or `1111`: withdrawal **fails** (funds returned). Ending `9999`: succeeds then is **reversed**.
- Bank account, phone, meter or smartcard number ending `0000`: **fails**. Ending `9999`: **reversed** after success.
- BVN ending `0000`: verification fails.
- Admin transaction page: force any outcome and deliver a signed webhook.

## What needs provider credentials

The PRD names Obiex and "card partners". Findings from official public pages (endpoint-level docs are gated, so adapters are **stubs and nothing was guessed**):

- **Obiex**: advertises REST with bearer auth, sandbox access, wallets, swaps with RFQ price locking, NGN on and off ramps, real-time webhooks. Get sandbox credentials and the Postman docs from Obiex, then finish `src/lib/providers/obiex.ts`.
- **Card issuer**: the PRD does not name one. Sudo Africa publicly offers a virtual and physical card issuing API with a sandbox and is a candidate. Finish `src/lib/providers/card-partner.ts` for whichever partner you sign.
- **Bills aggregator**: not named in the PRD. Pick one with a good sandbox and a requery endpoint, then finish `src/lib/providers/bills-aggregator.ts`.
- **KYC (BVN/NIN)** and **SMS**: not implemented beyond mocks.

Each adapter implements an interface in `src/lib/providers/types.ts`, so swapping providers touches one file. See `docs/PROVIDERS.md` for the integration checklist.

## Safety design

- **Live money is off by default.** `DECA_MODE=live` requires `ALLOW_LIVE_MONEY=true`, forbids the mock provider, and the shipped live adapters are stubs, so live mode cannot work until you finish and review them.
- **Server is authoritative.** The browser only displays balances. Prices, fees, limits, plan prices and account names are computed or resolved server-side. Quotes are single use and expire.
- **Ledger.** Balances change only through `src/lib/ledger.ts`: every change writes an immutable entry, the database rejects negative balances, wallets are row locked in a stable order, and `npm run db:verify` proves balances equal ledger sums. Money is integer minor units (no floats).
- **State machine.** `applyStatusTx` is the only place a transaction changes status. It is idempotent, ignores stale updates, handles **duplicate** (same status replayed), **delayed** (reconcile and cron), **failed** (funds released) and **reversed** (refund or clawback) events, and flags contradictions (for example success after failure) for a human instead of moving money.
- **Idempotency.** Money endpoints accept `Idempotency-Key`. The client keeps the same key after ambiguous failures, so retries cannot double spend. Reusing a key for a different request is rejected.
- **Webhooks.** HMAC over the raw body with timestamp window, constant-time compare, event-id dedupe, and the provider is **re-queried** for the true status and amount. The payload's claims are never trusted. Failures return 500 before the event id is stored, so provider retries still work.
- **Provider calls happen after commit**, never inside an open database transaction. If a provider call is ambiguous, the transaction stays pending and reconciliation asks the provider by our reference.
- **Other controls**: scrypt password hashing, hashed session tokens in httpOnly cookies, login throttling, same-origin check on mutations, zod validation on every input, AES-256-GCM for gift card codes, audited admin reveal, BVN stored only as a keyed hash plus last 4, security headers, no secrets in client code, `.env.example` has placeholders only.

## Remaining decisions and launch dependencies

1. **Regulatory.** Operating a crypto exchange in Nigeria requires SEC VASP registration/licensing, and card programmes need their own sponsor and compliance approvals. Confirm your licensing position before any live launch.
2. **Providers.** Sign Obiex, the card partner, the bills aggregator and a KYC/SMS vendor; finish and security review the live adapters; run their sandboxes against `docs/PROVIDERS.md`.
3. **Commercials.** Real fees, FX/gift card rates, KYC tier limits, card limits and physical card pricing (currently placeholders; physical cards are free in the sandbox).
4. **Two factor authentication**, email verification and password reset email (needs an email provider) are not built.
5. **Admin hardening.** Add a second approver for large gift card payouts, admin 2FA and IP allowlisting. Currently a reviewer cannot review their own submission and every action is audited.
6. **Rate limiting** beyond login throttling (use Vercel Firewall or an edge limiter) and monitoring/alerting on `reconciliation_flags`.
7. **Gift card images** to object storage; Play Store and App Store packaging (this is a responsive web app; wrap it as a PWA or native shell if the stores are required).
8. **Dependency note.** `npm audit` reports a PostCSS advisory bundled inside Next 15. It affects build time processing of untrusted CSS, which this app does not do. Plan an upgrade to Next 16 after testing.
9. **Not in scope per PRD:** DeFi/staking, NFTs, lending, international expansion.

## Project layout

```
db/migrations/        SQL schema (22 tables)
src/lib/ledger.ts     the only code that changes balances
src/lib/transactions.ts   state machine, reconciliation, idempotency
src/lib/webhooks.ts   secure webhook pipeline
src/lib/providers/    interfaces, sandbox mock, live adapter stubs
src/lib/services/     account, crypto, bills, gift cards, cards
src/app/              pages and API routes
tests/core.test.ts    financial correctness tests
```
