# Shopify App Store / Built-for-Shopify compliance checklist

Status legend: **[x]** scaffolded (structure + seam in place) · **[~]** partial
(shape wired, real impl TODO) · **[ ]** TODO · **🔒** owner-gated.

> This app is **verified-buildable + unit-tested** (`npm run typecheck | lint |
> test | build` all green — 84 tests / 12 files) but **NOT submittable yet**: the
> remaining blockers are all owner-gated (Partner app, provisioning credential,
> host, keys, listing). The exact owner steps are in **`SETUP.md`**.

## Build & tests (provable now, no owner creds)

- [x] `npm run typecheck` clean (unified `@shopify/shopify-api` via overrides)
- [x] `npm run lint` clean (typescript-eslint parser wired into the flat config)
- [x] `npm test` — 84 passing: provisioning seam · proof-of-shop + bmai OAuth token ·
  GDPR dispatch · billing gate · App-Proxy HMAC · connector transport/gates ·
  **actor-token verify (interop) · /api/bmai/status** · tenant slug · naming
- [x] `npm run build` — clean React Router 7 SSR build
- [x] `package-lock.json` committed (CI `npm ci` works)

## Installation & auth

- [x] **Managed installation** (token exchange, `unstable_newEmbeddedAuthStrategy`) — `app/shopify.server.ts`
- [x] **Embedded app** + App Bridge + Polaris — `app/routes/app.tsx`, `entry.server.tsx` (frame headers)
- [x] Offline access token persisted — Prisma `Session` (`@shopify/shopify-app-session-storage-prisma`)
- [~] OAuth 2.1 discovery for the connector (DCR/PKCE/iss/resource) — `app/mcp/route.ts` (metadata shape; full AS is P2/P3)
- [x] **Signed actor-token delegation verified app-side** — `app/mcp/actorToken.ts` +
  `app/mcp/auth.ts` HMAC-verify Busymate AI's HS256 actor token (per-(tenant,connector)
  secret derived from a shared master; iss/aud/kid/ttl/claim pins; fail-closed).
  Interop-tested against an independent reproduction of Busymate AI's signer. `/api/bmai/status`
  probes readiness. **Remaining owner/deploy step:** flip the LIVE connector
  `delegation_mode` + provision `BMAI_SUPPORT_ACTOR_MASTER` (= Busymate AI's
  `V2_SUPPORT_ACTOR_TOKEN_SECRET`) into the app's deploy env (done elsewhere).

## Mandatory GDPR compliance webhooks (the #1 rejection cause)

- [x] Declared via `compliance_topics` in `shopify.app.toml`
- [x] `customers/data_request` handler — pure dispatch (`app/lib/compliance.ts`) →
  `export_tenant_customer_data` MCP call; unit-tested.
- [x] `customers/redact` handler — dispatch → `redact_tenant_customer` MCP call;
  idempotent + unit-tested.
- [x] `shop/redact` handler — full tenant teardown wired (`onShopRedact`)
- [x] HMAC verification (fail-closed) via `authenticate.webhook`; the App-Proxy HMAC
  primitive (`verifyAppProxyHmac`) is independently unit-tested
- [x] A failed compliance effect returns 500 (Shopify retries) — never silently green

## Lifecycle webhooks

- [x] `app/uninstalled` → suspend tenant + purge sessions — `webhooks.app.uninstalled.tsx`
- [x] `app/scopes_update` handled — `webhooks.app.scopes_update.tsx`
- [x] Product/order KB-freshness webhooks — `webhooks.kb.*.tsx`

## API version & scopes

- [x] `api_version = "2026-01"` pinned (toml + admin client)
- [x] Least-privilege scopes declared (`read_products,read_content,read_orders,read_customers,read_fulfillments,write_orders,read_returns,write_returns`)
- [ ] 🔒 `read_all_orders` (>60-day orders) — needs Shopify approval; request at review
- [ ] Verify exact scope names per action against 2026-01 (refunds `write_orders`/`refundCreate`; `write_returns` availability)

## Billing

- [x] Shopify Billing API only (no external checkout) — Managed Pricing **check +
  redirect** wired (`app/lib/billingGate.ts` → `app.billing.tsx`); unit-tested
- [x] Usage charges **capped**; **widget never disabled at cap** — hard invariant
  `widgetEnabled() === true`, asserted by `test/billingGate.test.ts`
- [~] Usage-record metering (`AppUsageRecord` create) — seam in `usageBilling.ts` (P3)
- [ ] 🔒 Define the Managed Pricing plans in Partners + guarantee accounting decision

## Storefront & performance

- [x] **Theme app extension** (app-embed block; no `theme.liquid` edit) — `extensions/storefront-assistant/**`
- [x] Widget loads via the platform embed (`/embed/v1.js`), deferred/async
- [ ] Performance budget — widget must not regress storefront LCP/CLS (measure at P3)
- [x] App Proxy identity path for logged-in customers — `identity.tsx` + HMAC verify

## Privacy & data

- [x] Dedicated app DB (independent failure domain; not the bmai control plane)
- [x] All control-plane ops via MCP (no backdoor DB writes) — `bmai.server.ts`
- [ ] 🔒 Privacy policy + data-handling disclosures published (`busymate.ai/legal/*`)

## Listing

- [x] Localized-ready listing structure (`listing/en.json` + README) — ×14 plan
- [ ] 🔒 Translations for the 14 locales (real, not English stubs)
- [ ] 🔒 Screenshots, feature banner, icon, demo video (mp4/H.264), demo store + reviewer creds
- [ ] **(Optional) List in the Busymate AI directory** over MCP, once the App Store
  listing exists and is approved. See `docs/LISTING.md`.

## Owner-gated blockers (cannot be done from this session)

1. 🔒 **Create the app in the Shopify Partner Dashboard** → issues `client_id` + secret
   → `shopify app config link` writes them into `shopify.app.toml` / env.
2. 🔒 **Provisioning credential** (the provisioning-credential step): ship `provision_partner_tenant` (proof-of-shop)
   on the Busymate AI side, OR mint a scoped operator OAuth client for the app.
3. 🔒 **App-server host** (`shopify.busymate.ai`) + DNS + Let's Encrypt + systemd unit.
4. 🔒 **ES256 launch signing key** + register JWKS as the tenant visitor IdP.
5. 🔒 **Billing plan** definition in Partners + guarantee accounting decision.
6. 🔒 **Listing assets + translations** + demo store.

## Next phases (NEVER PARK — each has an active lane)

- **P2** — real Admin-API tool impls · provisioning wired to bmai MCP · identity/JWKS
  live · publish `@busymate/whitelabel-sdk` · exit: store installs, widget appears,
  Busymate AI answers grounded FAQ/policy + WISMO reads.
- **P3** — write connector tools (delegated+confirm+cap) · identified launch to the
  Shopify customer · resolution meter + Shopify Billing · pre-launch simulation ·
  guarantee + estimator · GDPR handlers proven · **App Store submission** · store
  listing published as app #1.
- **P4+** — trust engine · autonomous depth · onboarding · omnichannel · analytics/ROI
  · enterprise.
