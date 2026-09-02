# SETUP — taking Busymate AI for Shopify live

The code is **verified-buildable + unit-tested** (`npm run typecheck | lint | test |
build` all green). What it CANNOT do from a code session is anything that needs a
**Shopify Partner app** or a **Busymate AI provisioning credential** — those require an
account and credentials only you can create. This file is the exact checklist to go from
"green build" → "installable on a dev store" → "submittable".

> **Forking for your own store or platform?** Everything below applies to a fork —
> substitute your own Partner app and Busymate AI credentials. Adapting to a **non-Shopify
> platform** (Stripe, WordPress, …)? Read [`docs/EXTENDING.md`](docs/EXTENDING.md) first;
> it maps each step here to the platform-agnostic Busymate AI pattern.

---

## 0. What's already done (no owner action)

- Managed-install OAuth with **expiring offline tokens + refresh** (#2110; RR 2.1.0) + embedded Polaris/App-Bridge admin; `/auth/login` never 500s.
- The 4 admin pages (Home / Assistant settings / Connector & data / Billing).
- The per-store **Shopify Admin MCP connector** (`/mcp`): JSON-RPC 2.0, pre-auth
  discovery, fail-closed `tools/call`, 4 access tiers, refund cap, confirm gates.
- The tenant **provisioning lifecycle** (`app/lib/provision.ts`) — injected + tested.
- **GDPR** `customers/data_request` · `customers/redact` · `shop/redact` — real
  handlers wired to MCP effects; HMAC verified by `authenticate.webhook`; a shop
  with no tenant is a 200 no-op ("nothing held"), a real MCP failure still 500s.
- **Billing** — Managed-Pricing check + redirect; widget never disabled at cap.
- **Public naming** — merchant copy says "Busymate AI" / "bro"; enforced by
  `test/naming.test.ts`.

---

## 1. Create the Shopify Partner app (issues the API key/secret) 🔒

1. Partner Dashboard → **Apps → Create app → Create app manually**.
   - Name: **Busymate AI**. App URL: `https://shopify.busymate.ai`.
2. Copy the **Client ID** and **Client secret**.
3. Link the config from this repo:
   ```bash
   npm install
   npx prisma generate
   shopify app config link      # writes client_id into shopify.app.toml
   shopify app env pull         # writes SHOPIFY_API_KEY / SHOPIFY_API_SECRET into .env
   ```
   `client_id` in `shopify.app.toml` currently holds the placeholder
   `REPLACE_WITH_PARTNER_APP_CLIENT_ID` — `config link` overwrites it.

**Secret → where:** `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET` → `.env` (local) and the
app-host environment (prod). `SHOPIFY_API_SECRET` also verifies the App-Proxy HMAC
(`app/lib/storefrontIdentity.ts`) and every webhook HMAC.

## 2. Create a development store + run it 🔒

```bash
shopify app dev              # opens a tunnel, prompts to install on a dev store
```
This is the FIRST live install. `hooks.afterAuth` runs the provisioning lifecycle —
without step 4's credential it records `provisionState:"error"` (by design, not a
crash) and the admin shows a retry button.

## 3. App host + DNS 🔒 (for a persistent, non-tunnel deployment)

- Host the built app (`npm run build` → `npm start`, `react-router-serve`) at
  **`shopify.busymate.ai`** (systemd + nginx + Let's Encrypt, mirroring the fleet).
- Point `shopify.busymate.ai` DNS → that host.
- Provision the app's **own Postgres** and set `DATABASE_URL`; run
  `npx prisma migrate deploy`.

**Secret → where:** `DATABASE_URL` → app-host env only.

## 3b. Host deploy runbook (production build + migrations)

The host (`busymate-v2-lon1`, dir `/opt/bmai-shopify-app`, owner `deploy`, systemd
`bmai-shopify-app` → `react-router-serve` on 127.0.0.1:3970, env file
`/etc/bmai-shopify-app/env`) runs a git clone of `origin`. Every deploy is:

```bash
cd /opt/bmai-shopify-app
sudo -u deploy git -c safe.directory=/opt/bmai-shopify-app fetch origin
sudo -u deploy git -c safe.directory=/opt/bmai-shopify-app checkout <shipped sha>
sudo -u deploy npm ci                        # devDependencies included: the build + the tsx runner need them
sudo -u deploy npx prisma generate
sudo -u deploy npx prisma migrate deploy     # additive migrations only (e.g. 20260902120000_session_refresh_token)
sudo -u deploy npm run build                 # = NODE_ENV=production react-router build
systemctl restart bmai-shopify-app
curl -s https://store.busymate.ai/api/bmai/status   # {"ok":true,...}
```

`npm run build` / `npm start` pin `NODE_ENV=production` (the systemd unit sets it too)
for the app's own env-gated behaviour (`BMAI_ALLOW_HEADER_CALLER` off, no Prisma
global). Note on the framework itself: `react-router` 7.x ships `dist/development`
and `dist/production`, but its package `exports` has **no `production` condition** —
on Node the `node` condition always resolves `dist/development` (and the Vite SSR
build leaves `react-router` external), so `NODE_ENV` cannot select the production
dist and stack traces will show `dist/development` paths. That is upstream packaging,
not a mis-set env. Its one user-visible effect — the framework's default error page
with developer hints on any unknown route — is removed by the branded root
`ErrorBoundary` (`app/root.tsx` + `app/lib/routeError.ts`), and `/favicon.ico` +
`/robots.txt` are now real files under `public/`.

## 3c. Expiring offline access tokens — one-off cycling of pre-upgrade sessions 🔒

Public apps created after 2026-04-01 must use **expiring** offline access tokens;
Shopify rejects permanent ones (`403 [API] Non-expiring access tokens are no longer
accepted`) and the Dev Dashboard shows "Deprecated offline token use detected".
The app runs `@shopify/shopify-app-react-router` 2.1.0 with
`future.expiringOfflineAccessTokens: true`: new installs mint a ~1h token + a refresh
token (both encrypted at rest, `Session.refreshToken` / `refreshTokenExpires`), the
embedded path refreshes inside `authenticate.admin`, and every background Admin call
(connector tools, KB ingest, billing, metering) goes through
`unauthenticated.admin(shop)` (`app/mcp/shopifyAdmin.ts`), which refreshes within
5 minutes of expiry.

The library never replaces an **existing** permanent token on its own (a session
with `expires = NULL` is "active" forever), so after the first deploy of this code
cycle the install base once, on the host, as `deploy`, with the env sourced —
never echo a value:

```bash
cd /opt/bmai-shopify-app
sudo -u deploy bash -c 'set -a; . /etc/bmai-shopify-app/env; set +a; npm run tokens:cycle -- --dry-run'   # lists candidate shops
sudo -u deploy bash -c 'set -a; . /etc/bmai-shopify-app/env; set +a; npm run tokens:cycle'                # exchanges + stores
```

`scripts/cycle-offline-tokens.ts` (core `app/lib/cycleOfflineTokens.ts`, unit-tested)
reads every offline session through the app's encrypting session storage, exchanges
each permanent token via `api.auth.migrateToExpiringToken`, and stores the expiring
session under the same id. It prints only shop domains + expiry timestamps and exits
1 if any shop failed (that shop keeps its old row — re-run, or the merchant simply
re-opens the app, which re-exchanges). Verify in the app DB (never the platform DB):
every `Session` row with `isOnline = false` now has `expires` ≈ now + 1h and a
non-null `refreshTokenExpires`. The Dev Dashboard warning is a trailing-30-day window
and clears ~30 days after the last deprecated call.

Env var NAMES the script needs: `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`,
`SHOPIFY_APP_URL`, `DATABASE_URL`, `APP_ENCRYPTION_KEY` (+ optional
`SHOPIFY_API_VERSION`, `SCOPES`).

## 3d. App Proxy (storefront identity) 🔒

`shopify.app.toml` declares `[app_proxy] url = "https://store.busymate.ai"`,
`subpath = "busymate-ai"`, `prefix = "apps"` so the widget's storefront POST to
`/apps/busymate-ai/identity` is HMAC-signed by Shopify and proxied to `/identity`
(`app/routes/identity.tsx`), which turns `logged_in_customer_id` into the
customer-scoped launch JWT (order-aware answers). `test/appConfig.test.ts` pins the
proxy path to the extension's `IDENTITY_URL`. **Owner step:** the proxy is app
configuration — it reaches the app only through `shopify app deploy` (a new app
version) and `shopify app release`.

## 4. The Busymate AI provisioning credentials

The app drives the tenant lifecycle **only via the standalone Busymate AI MCP**:

- **`busymate.ai/mcp`** — proof-of-shop lifecycle plus tenant management:
  `provision_partner_tenant`, `add_tenant_embed_origin`, `get_tenant_usage`,
  `suspend_tenant`, `delete_tenant`, `export/redact_tenant_customer`. Authorized by an
  HMAC **proof-of-shop** (`app/lib/partnerProof.ts`, `BMAI_PARTNER_PROOF_SECRET` ==
  the Busymate AI platform's `SHOPIFY_PARTNER_HMAC`) — no operator needed. `set_tenant_domain` is
  NOT used: the tenant serves at the derived slug lane `<slug>.busymate.ai`.
  The same surface serves `set_tenant_branding`, `upsert_tenant_support_connector`,
  and `publish_tenant_runtime`.

Busymate DevTools is a separate product and is never part of this lifecycle.

### One durable credential (rotating OAuth refresh token) + the operator grant

MCP access tokens are 1h, so the app uses one rotating **OAuth refresh token**
(DCR + PKCE) for a dedicated provisioner identity, bound to the Busymate AI
resource. Mint it with `scripts/mint-provision-credential.mjs` (needs `SUPABASE_URL`
+ `SUPABASE_SERVICE_ROLE_KEY`):

```
node scripts/mint-provision-credential.mjs  # → BMAI_MGMT_*
```

`app/lib/bmaiToken.ts` mints access tokens, caches until near-expiry, and PERSISTS
each rotation to the `BmaiCredential` table (store wins over the env seed).

**⚠️ The provisioner identity is a PLATFORM OPERATOR** (`profiles.role='admin'`). The
tenant-management tools authorize only a platform-operator OR a tenant's own
CURRENT-tenant admin (a DELIBERATE design — `set_tenant_branding` etc.); a multi-tenant
partner provisioner (homed once, `is_default=false` per shop) can't be current-tenant
for every shop, so it needs operator. This is a broad,
revocable grant — see the least-privilege follow-up below.

**Env → app host (value-blind):** `BMAI_PARTNER_PROOF_SECRET` and
`BMAI_MGMT_CLIENT_ID`/`BMAI_MGMT_REFRESH_TOKEN`. Optional static bootstrap
`BMAI_MGMT_TOKEN`. Without a credential the lifecycle
fails closed.

### Verified end-to-end ✅

A real install → `provision_partner_tenant` (real tenant) → `set_tenant_branding`
(Busymate AI) → `add_tenant_embed_origin` (proof) → `upsert_tenant_support_connector`
(**real connector_id**, `probe_status:ok`) → `publish_tenant_runtime`
(runtime projection **ready**). The widget renders BRANDED at `<slug>.busymate.ai`.

### Follow-ups

- **Least-privilege (platform side):** extend the proof-of-shop authorization to the three
  mgmt tools (mirror `add_tenant_embed_origin`), so the app authorizes by
  proof-of-shop instead of holding a platform-operator credential. Then revoke the
  provisioner's `admin` role.
- **Delegated writes (app):** the app-side signed_actor_token verifier is **DONE** — `app/mcp/auth.ts` + `app/mcp/actorToken.ts` HMAC-verify
  Busymate AI's actor token (per-(tenant,connector) secret derived from `BMAI_SUPPORT_ACTOR_MASTER`;
  iss/aud/kid/ttl/claim pins; fail-closed), and `GET /api/bmai/status` reports
  `actorVerifier`. The connector registration flips to
  `delegation_mode:'signed_actor_token'` + the delegated write tools **automatically**
  once the verifier is ready (`app/lib/provision.ts` reads
  `masterSecretUsable(BMAI_SUPPORT_ACTOR_MASTER)`). **Remaining owner/deploy step:**
  provision `BMAI_SUPPORT_ACTOR_MASTER` (= Busymate AI's `V2_SUPPORT_ACTOR_TOKEN_SECRET`)
  into the deploy env, then re-provision (Connector → Re-provision) to flip it live.
- **Merchant admin:** `add_tenant_admin` is NOT called (needs a Busymate AI `user_id` a
  Shopify install lacks); the merchant is linked on first Busymate AI sign-in.

## 5. Identified-launch ES256 key 🔒

Generate an ES256 keypair; the PRIVATE key signs the storefront launch JWT, the
PUBLIC half is served at `/.well-known/jwks.json` and registered as the tenant's
visitor identity provider.
```bash
openssl ecparam -genkey -name prime256v1 -noout -out ec.key
openssl pkcs8 -topk8 -nocrypt -in ec.key -out ec.pkcs8.pem   # PKCS#8 for jose
```
**Secret → where:** `LAUNCH_SIGNING_KEY` (PKCS#8 PEM, newlines as `\n`) → app secret
store. `LAUNCH_KEY_ID` → env (default fine).

### 5b. Actor-token delegation master (`signed_actor_token` verify) 🔒

Busymate AI mints a short-lived HS256 **actor token** per delegated `tools/call`; this host
verifies it (`app/mcp/actorToken.ts` + `app/mcp/auth.ts`). The host holds ONE shared
master and DERIVES the per-(tenant,connector) verifier secret at verify time. Set
`BMAI_SUPPORT_ACTOR_MASTER` to the **same value Busymate AI signs with** — the platform's
`V2_SUPPORT_ACTOR_TOKEN_SECRET` (≥32 bytes; provisioned value-blind into the deploy
env). Until it is set, actor verification is **fail-closed** (every delegated call is
refused). Confirm readiness with `GET /api/bmai/status` → `actorVerifier:true`.

In production leave `BMAI_ALLOW_HEADER_CALLER` **unset** — the legacy unverified
`x-bmai-shop` header caller is dev/test only and OFF when `NODE_ENV=production`.
`BMAI_CONNECTOR_HMAC_SECRET` (a single static HMAC) is **superseded** by the
derived-per-connector master and is no longer read by the verifier.

### 5c. Encryption-at-rest key (`APP_ENCRYPTION_KEY`) 🔒

Credential + PII columns (`Session.accessToken` + `email`, `BmaiCredential.refreshToken`)
are AES-256-GCM encrypted at the app layer (`app/lib/fieldCipher.ts`). Set a 32-byte
key on the host — `openssl rand -base64 32` — as `APP_ENCRYPTION_KEY`. Value-blind;
never logged. UNSET ⇒ those columns are stored plaintext (a documented dev/CI no-op);
SET it in production so the PCD at-rest attestation is true. Legacy plaintext rows
read fine and upgrade to ciphertext on the next write. Retention windows + the full
data map: `docs/DATA-RETENTION.md`.

## 6. Billing plan (Managed Pricing) 🔒

Define the plans in **Partner Dashboard → App pricing → Managed pricing** (match
`app/lib/usageBilling.ts::PLANS`). The app redirects merchants to Shopify's hosted
`/charges/busymate-ai/pricing_plans` page — no app-rendered checkout. Set
`SHOPIFY_APP_HANDLE` if the handle differs from `busymate-ai`.

## 7. Listing assets + translations 🔒

Done in-repo: the **icon** (`listing/assets/icon-1200.png`), the **14-locale**
listing translations (`listing/*.json`), and factual-accuracy copy. Still owner-gated:
screenshots + feature banner + demo video (mp4/H.264) + demo-store reviewer creds. The
privacy policy + FAQ (`docs/legal/*.md`) are published at
`https://store.busymate.ai/legal/privacy` + `https://store.busymate.ai/legal/faq`.

## 8. (Optional) List it in the Busymate AI directory

Once the Shopify App Store listing exists and is approved, the app can also be registered
in the Busymate AI directory over MCP so it is discoverable alongside other Busymate AI
integrations. Do this only after the App Store listing URL exists.

---

## Verify locally right now (no owner creds needed)

```bash
npm install && npx prisma generate
npm run typecheck   # 0 errors
npm run lint        # 0 errors
npm test            # 204 passing (29 files)
npm run build       # clean SSR build
```

## Secret → destination summary

| Secret | Source | Destination |
|---|---|---|
| `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` | Partner app | `.env` + host env |
| `DATABASE_URL` | app's own Postgres | host env |
| `BMAI_PARTNER_PROOF_SECRET` | == the Busymate AI platform's `SHOPIFY_PARTNER_HMAC` | host env |
| `BMAI_MGMT_CLIENT_ID` / `BMAI_MGMT_REFRESH_TOKEN` | `scripts/mint-provision-credential.mjs` (DCR+PKCE, resource `busymate.ai/mcp`) | host env |
| `BMAI_MGMT_TOKEN` | optional static bootstrap access token | app secret store |
| `BMAI_SUPPORT_ACTOR_MASTER` | = Busymate AI's `V2_SUPPORT_ACTOR_TOKEN_SECRET` (≥32 B) | app secret store / host env |
| `BMAI_CONNECTOR_HMAC_SECRET` | *(deprecated — superseded by the master above)* | — |
| `LAUNCH_SIGNING_KEY` | ES256 PKCS#8 PEM | app secret store |
| `APP_ENCRYPTION_KEY` | `openssl rand -base64 32` (32-byte at-rest key; also encrypts `Session.refreshToken`) | host env / app secret store |
| `SHOPIFY_APP_HANDLE` | shopify.app.toml handle | env (default `busymate-ai`) |

Nothing above can be produced from a code session — each needs the Partner Dashboard,
a host, or a Busymate AI credential.

## 11. Shopify App Pricing — plan state, usage metering, legal pages (2026-09) 🔒

The app bills ONLY through **Shopify App Pricing** (Partner Dashboard → Pricing →
"Update to App Pricing" → enable). Plan handles are `free` / `starter` / `growth` /
`scale` (== `app/lib/plans.ts`, asserted against `listing/pricing.json` by
`test/plans.test.ts`); each paid plan carries the usage meter **`ai_resolution`**
and a redirect URL of **`/app/billing`** (the app reads `?plan_handle=` there).

| Env var (value-blind) | Purpose | Where |
|---|---|---|
| `PARTNER_ORG_ID` | Partner organization id (the number in the partners.shopify.com URL) | host env |
| `PARTNER_API_ACCESS_TOKEN` **or** `PARTNER_API_CLIENT_ID` + `PARTNER_API_CLIENT_SECRET` | Partner API client ("Manage apps" permission) — `activeSubscription` = the plan-state source | host env |
| `SHOPIFY_APP_ID` (numeric) or `SHOPIFY_APP_GID` | The app's GID for the Partner API query | host env |
| `SHOPIFY_APP_EVENTS_CLIENT_ID` + `SHOPIFY_APP_EVENTS_CLIENT_SECRET` | Dev Dashboard API key → App Events API (usage billing events) | host env |
| `BILLING_METER_SECRET` | Shared secret for the `POST /api/billing/meter` timer trigger | host env |
| `STOREFRONT_ASSISTANT_EXTENSION_UUID` | Optional override of the Shopify-assigned theme-extension UUID used by the theme-editor deep link | host env |

Metering trigger (systemd timer on the host; the secret is read from the env file, never argv):

```
# /etc/systemd/system/bmai-shopify-meter.service
[Service]
Type=oneshot
EnvironmentFile=/etc/bmai-shopify-app/env
ExecStart=/bin/sh -c 'curl -fsS -X POST -H "x-billing-meter-secret: $$BILLING_METER_SECRET" http://127.0.0.1:3970/api/billing/meter'
# /etc/systemd/system/bmai-shopify-meter.timer  →  OnCalendar=hourly
```

Legal pages: `docs/legal/{privacy,faq,terms}.md` → `node scripts/render-legal.mjs --out /var/www/bmai-legal`
(+ an nginx `location = /legal/terms { default_type text/html; alias /var/www/bmai-legal/terms.html; }`).
