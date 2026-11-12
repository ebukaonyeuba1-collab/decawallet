# Provider integration checklist

Before enabling any live adapter, verify everything below against the provider's **current official documentation and sandbox**. The shipped adapters are stubs on purpose.

## Contract every adapter must meet

1. **Idempotent creation.** Send our `ref` (for example `DCA-XXXXXXXXXX`) as the provider's client reference or idempotency key. A retry must never create a second payout.
2. **Lookup by our `ref`.** `getOperationStatus(ref)` must work even if we never stored the provider's id (this is how ambiguous timeouts recover).
3. **Status translation in one place.** Map provider statuses to `pending | processing | success | failed | reversed | not_found`. Treat unknown or "processing" states as pending, never as failed.
4. **Webhook verification exactly as documented** (header names, algorithm, tolerance). Verify the raw body. Implement `verifyWebhook` to return the event id, our `ref` and/or the provider reference.
5. **Server-side verification.** The webhook is only a hint. `getOperationStatus` / `getDeposit` / `getCard` supply the truth and the amount.
6. **Definitive vs ambiguous errors.** Throw `ProviderRejected` only when the provider clearly refused (no money moved). Any timeout or 5xx must throw a normal error so the transaction stays pending.
7. **Secrets** come from environment variables only and are used only on the server.

## Per provider

**Obiex (crypto wallets, swaps, NGN rails):** obtain sandbox keys and docs from Obiex. Confirm deposit address generation per network, confirmation counts and webhook events for deposits, withdrawals and swaps. Confirm how RFQ quote ids are executed and their expiry (our quote TTL is 30 seconds). Confirm fees and minimums and replace `catalog.ts`.

**Card issuer:** confirm KYC data required to issue, funding model (pre-funded vs just-in-time), spend and decline webhooks, card controls, delivery tracking events, and how card details are displayed securely (prefer the issuer's secure widget so PAN/CVV never touch DECA).

**Bills aggregator:** confirm customer validation for meters and smartcards, requery endpoint, token delivery for prepaid electricity, refund and reversal behaviour, and wallet float requirements.

## Test plan for each adapter (sandbox)

Success, failure, long pending, duplicate webhook, out of order webhook, webhook with wrong signature, provider timeout after request accepted, late reversal, and a stuck transaction. The scenarios in `tests/core.test.ts` show the expected behaviour for each.
