-- DECA initial schema (PostgreSQL 14+).
-- Money columns are NUMERIC(38,0) holding integer minor units (kobo for NGN,
-- 1e-6 for USDT/USDC, 1e-8 for BTC/ETH). The application never uses floats.

create table users (
  id                 uuid primary key default gen_random_uuid(),
  email              text not null,
  password_hash      text not null,
  full_name          text not null,
  phone              text,
  phone_verified_at  timestamptz,
  phone_otp_hash     text,
  phone_otp_expires  timestamptz,
  phone_otp_attempts int not null default 0,
  role               text not null default 'user' check (role in ('user','admin')),
  status             text not null default 'active' check (status in ('active','restricted','closed')),
  kyc_tier           int  not null default 0 check (kyc_tier between 0 and 2),
  kyc_status         text not null default 'none' check (kyc_status in ('none','pending','verified','rejected')),
  kyc_reject_reason  text,
  bvn_hash           text,
  bvn_last4          text,
  onboarding_step    int  not null default 0,
  onboarded_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create unique index users_email_lower_idx on users (lower(email));

create table sessions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  token_hash  text not null unique,
  user_agent  text,
  ip          text,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);
create index sessions_user_idx on sessions (user_id);

create table auth_attempts (
  id          bigserial primary key,
  key         text not null,
  success     boolean not null,
  created_at  timestamptz not null default now()
);
create index auth_attempts_key_idx on auth_attempts (key, created_at desc);

-- One row per user per asset. Balances change ONLY through ledger posting.
--   available   spendable now
--   pending_in  incoming funds not yet spendable (e.g. unconfirmed deposit)
--   pending_out funds held for an outgoing operation that has not settled
create table wallets (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,
  asset        text not null,
  available    numeric(38,0) not null default 0 check (available   >= 0),
  pending_in   numeric(38,0) not null default 0 check (pending_in  >= 0),
  pending_out  numeric(38,0) not null default 0 check (pending_out >= 0),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (user_id, asset)
);

create table transactions (
  id               uuid primary key default gen_random_uuid(),
  ref              text not null unique,
  user_id          uuid not null references users(id),
  type             text not null check (type in
                    ('crypto_deposit','crypto_withdrawal','ngn_withdrawal','swap','bill_payment','giftcard_payout','card_funding')),
  status           text not null check (status in ('pending','processing','success','failed','reversed')),
  asset            text not null,
  amount           numeric(38,0) not null check (amount >= 0),
  fee              numeric(38,0) not null default 0 check (fee >= 0),
  counter_asset    text,
  counter_amount   numeric(38,0),
  rate             text,
  provider         text,
  provider_ref     text,
  idempotency_key  text,
  request_hash     text,
  meta             jsonb not null default '{}'::jsonb,
  failure_reason   text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  completed_at     timestamptz
);
create unique index transactions_idem_idx on transactions (user_id, idempotency_key) where idempotency_key is not null;
create unique index transactions_provider_ref_idx on transactions (provider, provider_ref) where provider_ref is not null;
create index transactions_user_created_idx on transactions (user_id, created_at desc);
create index transactions_status_idx on transactions (status, updated_at);

create table transaction_events (
  id            bigserial primary key,
  transaction_id uuid not null references transactions(id) on delete cascade,
  from_status   text,
  to_status     text not null,
  source        text not null,   -- user | provider | webhook | reconcile | admin | system
  note          text,
  created_at    timestamptz not null default now()
);
create index transaction_events_tx_idx on transaction_events (transaction_id, id);

-- Immutable audit trail of every balance movement.
create table ledger_entries (
  id                  bigserial primary key,
  wallet_id           uuid not null references wallets(id),
  transaction_id      uuid references transactions(id),
  op                  text not null,
  d_available         numeric(38,0) not null default 0,
  d_pending_in        numeric(38,0) not null default 0,
  d_pending_out       numeric(38,0) not null default 0,
  available_after     numeric(38,0) not null,
  pending_in_after    numeric(38,0) not null,
  pending_out_after   numeric(38,0) not null,
  created_at          timestamptz not null default now()
);
create index ledger_wallet_idx on ledger_entries (wallet_id, id);
create index ledger_tx_idx on ledger_entries (transaction_id);

create table webhook_events (
  id               uuid primary key default gen_random_uuid(),
  provider         text not null,
  event_id         text not null,
  signature_valid  boolean not null,
  payload          jsonb,
  outcome          text,
  received_at      timestamptz not null default now(),
  processed_at     timestamptz,
  unique (provider, event_id)
);

create table deposit_addresses (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  asset       text not null,
  network     text not null,
  address     text not null unique,
  memo        text,
  provider    text not null,
  created_at  timestamptz not null default now(),
  unique (user_id, asset, network)
);

-- Price-locked swap quotes. A quote can be consumed exactly once.
create table quotes (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  from_asset    text not null,
  to_asset      text not null,
  from_amount   numeric(38,0) not null,
  fee           numeric(38,0) not null,
  to_amount     numeric(38,0) not null,
  rate          text not null,
  expires_at    timestamptz not null,
  used_at       timestamptz,
  created_at    timestamptz not null default now()
);

create table beneficiaries (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references users(id) on delete cascade,
  category       text not null check (category in ('airtime','data','electricity','cable')),
  provider_code  text not null,
  identifier     text not null,
  label          text not null,
  created_at     timestamptz not null default now(),
  unique (user_id, category, provider_code, identifier)
);

create table gift_card_submissions (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references users(id),
  brand               text not null,
  country             text not null,
  currency            text not null,
  card_type           text not null check (card_type in ('ecode','physical')),
  face_value          numeric(38,0) not null,       -- minor units of `currency` (cents)
  code_encrypted      text,                         -- AES-256-GCM, never plaintext
  code_last4          text,
  indicative_rate     text not null,                -- NGN per 1 unit of currency
  indicative_payout   numeric(38,0) not null,       -- kobo
  status              text not null default 'submitted'
                       check (status in ('submitted','in_review','approved','paid','rejected')),
  payout_amount       numeric(38,0),                -- kobo, set by reviewer
  review_note         text,
  reviewer_id         uuid references users(id),
  est_review_minutes  int not null default 30,
  transaction_id      uuid references transactions(id),
  submitted_at        timestamptz not null default now(),
  reviewed_at         timestamptz,
  paid_at             timestamptz,
  updated_at          timestamptz not null default now()
);
create index gift_card_user_idx on gift_card_submissions (user_id, submitted_at desc);
create index gift_card_status_idx on gift_card_submissions (status, submitted_at);

create table gift_card_assets (
  id             uuid primary key default gen_random_uuid(),
  submission_id  uuid not null references gift_card_submissions(id) on delete cascade,
  mime           text not null,
  size           int not null,
  data           bytea not null,
  created_at     timestamptz not null default now()
);

create table gift_card_events (
  id             bigserial primary key,
  submission_id  uuid not null references gift_card_submissions(id) on delete cascade,
  to_status      text not null,
  actor_id       uuid references users(id),
  note           text,
  created_at     timestamptz not null default now()
);

-- Card PAN/CVV are NEVER stored. Only masked metadata and provider references.
create table cards (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references users(id),
  type            text not null check (type in ('virtual','physical')),
  status          text not null check (status in
                   ('active','frozen','pending_delivery','awaiting_activation','terminated')),
  provider        text not null,
  provider_ref    text not null,
  brand           text not null,
  last4           text not null,
  expiry_month    int  not null,
  expiry_year     int  not null,
  holder_name     text not null,
  balance         numeric(38,0) not null default 0 check (balance >= 0),   -- kobo, mirror of provider balance
  per_tx_limit    numeric(38,0) not null,
  daily_limit     numeric(38,0) not null,
  monthly_limit   numeric(38,0) not null,
  delivery        jsonb,
  frozen_at       timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (provider, provider_ref)
);
create index cards_user_idx on cards (user_id);

create table card_events (
  id          bigserial primary key,
  card_id     uuid not null references cards(id) on delete cascade,
  kind        text not null,
  detail      text,
  created_at  timestamptz not null default now()
);

create table card_transactions (
  id            uuid primary key default gen_random_uuid(),
  card_id       uuid not null references cards(id),
  user_id       uuid not null references users(id),
  kind          text not null check (kind in ('spend','funding','refund')),
  status        text not null check (status in ('approved','declined')),
  merchant      text,
  amount        numeric(38,0) not null,
  decline_reason text,
  provider_ref  text,
  created_at    timestamptz not null default now(),
  unique (card_id, provider_ref)
);
create index card_tx_card_idx on card_transactions (card_id, created_at desc);

create table support_tickets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  subject     text not null,
  body        text not null,
  transaction_id uuid references transactions(id),
  status      text not null default 'open' check (status in ('open','answered','closed')),
  created_at  timestamptz not null default now()
);

-- Anything a human should look at: stuck transactions, late success after a
-- failure, reversals that could not be fully recovered, and so on.
create table reconciliation_flags (
  id              bigserial primary key,
  transaction_id  uuid references transactions(id),
  kind            text not null,
  detail          text not null,
  created_at      timestamptz not null default now(),
  resolved_at     timestamptz,
  resolved_by     uuid references users(id)
);
create index flags_open_idx on reconciliation_flags (resolved_at) where resolved_at is null;
create unique index flags_unique_open_idx on reconciliation_flags (transaction_id, kind) where resolved_at is null;

create table audit_log (
  id          bigserial primary key,
  actor_id    uuid references users(id),
  action      text not null,
  entity      text not null,
  entity_id   text,
  detail      jsonb,
  created_at  timestamptz not null default now()
);

-- State for the SANDBOX provider only. It lets the simulator behave like a
-- real asynchronous provider across stateless serverless invocations.
create table mock_provider_ops (
  provider_ref   text primary key,
  kind           text not null,
  payload        jsonb not null default '{}'::jsonb,
  outcome        text not null default 'success',   -- success | fail | reversed
  delay_seconds  int  not null default 6,
  forced_status  text,
  forced_reason  text,
  created_at     timestamptz not null default now()
);
