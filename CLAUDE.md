# Repo guide — bmai-shopify-app

**Busymate AI for Shopify** — the official Shopify App Store app whose AI backend is the
Busymate AI white-label agent (**bro**). Installing it turns a Shopify store into **one
Busymate AI tenant**. This is a **client** of the Busymate AI + Shopify plumbing, not a
new AI stack. It is also an **open reference** for connecting any platform to Busymate AI
(see [`docs/EXTENDING.md`](docs/EXTENDING.md)).

This file orients humans and AI coding assistants working in this repo. Contributor
workflow lives in [`CONTRIBUTING.md`](CONTRIBUTING.md).

## The one hard invariant — all-ops-via-MCP

This app reaches Busymate AI **only** through official contracts: the Busymate AI **MCP
tenant tools** (provision / publish / branding / usage), the **connector protocol** (MCP
JSON-RPC 2.0 + OAuth 2.1), and the white-label embed. **Never** a backdoor database or
storage write. If an operation has no MCP tool, expose the tool on the Busymate AI side —
don't reach around it. `app/bmai.server.ts` is the ONLY module that talks to Busymate AI.

## Stack

Shopify CLI 3 · **React Router 7** (`@shopify/shopify-app-react-router`, NOT Remix) ·
Polaris + App Bridge · Prisma + Postgres (the app's OWN DB) · theme app extension ·
Shopify Billing API · **`api_version 2026-07`** (Admin GraphQL).

## Layout

```
shopify.app.toml            app config: scopes, compliance_topics, webhooks, api_version
app/shopify.server.ts       shopifyApp(): managed auth + sessionStorage + afterAuth hook
app/bmai.server.ts          THE Busymate AI seam — MCP provision lifecycle + connector register + teardown
app/routes/app*.tsx         embedded admin UI (Polaris/App Bridge)
app/routes/webhooks.*.tsx   GDPR compliance (3) + app/uninstalled + scopes_update + KB freshness
app/routes/mcp.$.tsx        the per-store Shopify Admin MCP connector transport
app/routes/identity.tsx     App-Proxy-verified logged-in customer → ES256 launch JWT
app/mcp/**                  connector: transport + auth (actor-token verify) + Admin GraphQL client + tools (real, 4 tiers)
app/lib/**                  tenantSlug · identity(JWKS) · storefrontIdentity · usageBilling · ingest · mgmtArgs · fieldCipher · billingSync
extensions/storefront-assistant/  theme app-embed block mounting the widget (×14 locales)
prisma/schema.prisma        Session · ShopTenant · BillingState · LaunchKey
docs/                       ARCHITECTURE · PROVISIONING · EXTENDING · LISTING
listing/                    localized-ready App Store copy (×14 plan)
CHECKLIST.md                Built-for-Shopify compliance status
```

## Conventions

- **Fail-closed** — an unverifiable delegation token, missing shop, or missing credential
  is a refusal, never an assumed success. No fake `{ok:true}`.
- **all-ops-via-MCP** — see the invariant above.
- **i18n-everywhere** — user-facing text is localized (extension locales + listing);
  no English-only surface.
- **Confirm-gate every write** connector tool; the highest-risk (refund/return/cancel) are
  `adminOnly` (kept off the free-text LLM path). A refund cap escalates above-cap → human.
- **Connector tools are REAL** — `app/mcp/tools/*` issue live Admin GraphQL (2026-07):
  products (search/get/collections), orders scoped to the launch-JWT customer via
  `orderLookup.ts` (a customer only sees their own orders), and the writes
  refundCreate/returnCreate/orderCancel/orderUpdate/draftOrderCreate. The connector
  registers `delegation_mode:'signed_actor_token'` + the delegated tools ONLY when the
  host can verify the actor token (`BMAI_SUPPORT_ACTOR_MASTER` set == `/api/bmai/status`
  `actorVerifier`); else it stays read-only `none`.
- **Encryption at rest** — credential/PII columns (`Session.accessToken` + `email`,
  `BmaiCredential.refreshToken`) are AES-256-GCM encrypted via `app/lib/fieldCipher.ts`
  + the `EncryptedSessionStorage` decorator; `APP_ENCRYPTION_KEY` in the host env
  (unset ⇒ dev no-op). See `docs/DATA-RETENTION.md`.
- **Mgmt-call shape is shared** — `set_tenant_branding` / `publish_tenant_runtime` args
  are built ONLY by `app/lib/mgmtArgs.ts` (proof-of-shop + `confirm:true`), so
  provisioning, the settings save and KB re-ingest can't drift out of the shape the
  bmai edge verifies.
- **Public naming** — merchant- and customer-facing copy says **"Busymate AI"** / **"bro"**,
  never internal codenames. Enforced by `test/naming.test.ts`.
- **Every change ships a test** — `test/**`, `npm test`. Assert the denied/failure path too.

## Commands

`npm run dev` (shopify app dev · needs Partner auth) · `npm test` · `npm run typecheck`
· `npm run lint` · `npm run build` · `npm run deploy` (shopify app deploy) ·
`npx prisma migrate deploy`.

## Owner/deploy-gated (cannot be done from a code session)

Create the Partner app (client_id/secret), the Busymate AI provisioning credential, the
app host + DNS + TLS, the ES256 launch key, the billing plan, and the listing
assets/translations. See [`SETUP.md`](SETUP.md) and [`CHECKLIST.md`](CHECKLIST.md).
