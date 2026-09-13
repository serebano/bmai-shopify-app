# Billing — AI-resolution metering (#19 / devtools #2835)

App issue #19 / devtools #2835 closed the LAST gap the 2026-09-11 review found:
`usageBilling.ts` used to read `get_tenant_usage` as if it returned a
`{ resolutions, cursor }` pair; that tool actually returns tenant entity counts,
so usage was permanently unreadable and every batch held forever. This doc
records the fix as the single source of truth for the billing definition and
pipeline — read it before changing anything under `app/lib/{resolution,meter,
usage}*`.

## The definition (boss default, 2026-09-13)

> **A billable AI resolution is a visitor conversation the assistant answered
> that ended WITHOUT a human hand-off, and was NOT reopened by the same
> visitor within 24 hours.**

Implemented, pure and unit-tested, in `app/lib/resolutionDefinition.ts`
(`decideResolutions` / `RESOLUTION_DEFINITION`). It is also shown verbatim on
the merchant's Billing page (`app/routes/app.billing.tsx`) next to the
current-cycle count.

Three inputs decide each conversation, from a single MCP snapshot (no diffing
across runs needed — see "why one snapshot suffices" below):

| Signal | Source | Disqualifies when |
|---|---|---|
| Still live | `list_tenant_conversations` (`live`) | `live === true` — not ended yet |
| Human hand-off | `list_tenant_interventions`, ANY status (`listTenantInterventionsAll`) | any intervention row references the session — open, resolved, or declined all count; the Conversations-page inbox (`listTenantHandoffs`) only shows OPEN ones, a different, narrower read |
| Reopened within 24h | `list_tenant_conversations` (`lastActiveAt`) | `now − lastActiveAt < 24h` |

**Why one snapshot suffices for "not reopened within 24h":** `lastActiveAt`
only ever advances when another turn is added to that session. So "no activity
in the last 24h" (one read, one timestamp compare) and "not reopened within
24h of ending" (would need to diff two reads) are the same fact. A
conversation still inside the 24h window is not yet decidable and is simply
re-checked on the next scan — never guessed either way (fail-closed).

## The pipeline

```mermaid
flowchart LR
  MCP["list_tenant_conversations\nlist_tenant_interventions (all statuses)"] --> DEF["decideResolutions\n(resolutionDefinition.ts)"]
  DEF --> LEDGER{"already in\nMeteredResolution?"}
  LEDGER -- yes --> SKIP["not recounted"]
  LEDGER -- no --> BATCH["candidate batch\n(resolutionLedger.server.ts)"]
  BATCH --> METER["meterShop\n(usageBilling.ts) — allowance + cap math"]
  METER -- units > 0 --> OUTBOX["MeterDelivery outbox\n(meterOutbox.ts): prepare → claim → send → accept"]
  OUTBOX --> EVENTS["Shopify App Events\n(ai_resolution usage event)"]
  METER -- batch DONE --> COMMIT["commitCountedResolutions\n(saveCursor)"]
  COMMIT --> LEDGER
```

1. **Producer** (`app/lib/resolutionLedger.server.ts`, `readNewResolutions`):
   reads conversations + hand-offs via MCP, applies the definition, and drops
   any session already in the `MeteredResolution` ledger. Returns a *candidate*
   batch — it does **not** write yet.
2. **Idempotent commit boundary** (`MeteredResolution`, `@@unique([tenantId,
   sessionId])`): a session is permanently counted **at most once, ever**,
   however many times the rolling `list_tenant_conversations` window re-surfaces
   it. Committed only once a batch is DONE — see "retry safety" below.
3. **Allowance / cap math** (`usageBilling.meterShop`, unchanged by this
   change — still the tested pure function): counts resolutions against the
   plan's included allowance per cycle, computes billable overage units,
   clamps to the plan's monthly spend cap. The widget is never disabled.
4. **Durable delivery** (`app/lib/meterOutbox.ts`, `MeterDelivery` table): a
   billable batch is `prepare`d (immutable, per-shop-locked, one pending batch
   at a time — protects against overlapping timer + page-load metering),
   `claim`ed (30s DB-clock lease — protects against two concurrent workers),
   sent to **Shopify App Events** (`ai_resolution` usage event — this app bills
   under declarative **App Pricing**, which meters via App Events, not the
   legacy `AppUsageRecord`/`appUsageRecordCreate` API), then `accept`ed.
5. **Retries**: a batch held by a transient failure (App Events down, no
   active billing cycle, a concurrent claim) is never committed to the ledger,
   so it is safely re-derived next run — usually with the **identical**
   evidence hash as its cursor/idempotency key (`evidenceRefFor`, a content
   hash of the session-id set, not a wall-clock value), so a retry reuses the
   same Shopify idempotency key.
6. **Dead-letter, visible**: if the shop's billing/tenant/plan snapshot
   changed between `claim` and `accept` (e.g. the merchant changed plans
   mid-delivery), the delivery moves to `state = 'reconciliation'` — it blocks
   further batches for that shop until a human resolves it, and is surfaced as
   a critical banner on the Billing page (`listStuckDeliveries`). It is never
   auto-retried silently.

## Known limitation — `subscriptionId`

`PreparedMeterBatch.subscriptionId` exists to detect "the merchant's contract
changed under us" between `prepare` and `accept`. Declarative **App Pricing**
has no legacy `AppSubscriptionLineItem` id (`legacySubscriptionId` is null), so
this app substitutes the current billing cycle's `startTime` as the stability
identity — a plan/contract change normally rolls the cycle too, but a same-cycle
mid-period downgrade is not independently detected by this field alone (the
plan-handle mismatch inside `matches()` still catches the common case). Explicit
handling of a same-cycle plan change is a follow-up if it proves to matter in
practice.

## Env / ops

No new env vars. Reuses `SHOPIFY_APP_EVENTS_CLIENT_ID`/`_SECRET` (App Events),
`PARTNER_ORG_ID` + `PARTNER_API_*` (billing cycle), and the existing
`BILLING_METER_SECRET`-gated `POST /api/billing/meter` hourly timer (SETUP.md
§11). Migration: `prisma/migrations/20260913090000_metered_resolution_ledger`
(additive — `npx prisma migrate deploy`, same host runbook as SETUP.md §3b).

## Tests

- `test/resolutionDefinition.test.ts` — the definition itself (pure).
- `test/resolutionLedger.test.ts` — the producer: MCP → definition → idempotent
  candidate batch, retry-stable cursor, fail-closed on an unreadable MCP read.
- `test/meterOutbox.test.ts` — the delivery core (cherry-picked from the prior
  draft, PR #28 — see below), unchanged.
- `test/usageBilling.test.ts` — the allowance/cap pure logic, unchanged
  (`meterShop`'s tested behavior was not touched; only `liveMeterDeps()`, the
  production wiring, changed).

## Superseded: draft PR #28

PR #28 ("Prepared billing outbox foundation (unwired)") staged the
`MeterDelivery` outbox core as an intentionally-unwired draft, blocked on "no
qualifying AI-resolution producer" (#19). This change supplies that producer
and wires the outbox into `meterShop` for real. PR #28's outbox commits were
cherry-picked verbatim (`app/lib/meterOutbox.ts` is byte-identical to the
draft); its branch is superseded by this one and closed with a pointer here.
