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

- Managed-install OAuth (offline token) + embedded Polaris/App-Bridge admin.
- The 4 admin pages (Home / Assistant settings / Connector & data / Billing).
- The per-store **Shopify Admin MCP connector** (`/mcp`): JSON-RPC 2.0, pre-auth
  discovery, fail-closed `tools/call`, 4 access tiers, refund cap, confirm gates.
- The tenant **provisioning lifecycle** (`app/lib/provision.ts`) — injected + tested.
- **GDPR** `customers/data_request` · `customers/redact` · `shop/redact` — real
  handlers wired to MCP effects; HMAC verified by `authenticate.webhook`.
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
screenshots + feature banner + demo video (mp4/H.264) + demo-store reviewer creds, and
**publishing** the drafted privacy policy + FAQ (`docs/legal/*.md`) at
`busymate.ai/legal/privacy` + `busymate.ai/shopify/faq` (currently 404 — needs v2 access).

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
npm test            # 159 passing (20 files)
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
| `APP_ENCRYPTION_KEY` | `openssl rand -base64 32` (32-byte at-rest key) | host env / app secret store |
| `SHOPIFY_APP_HANDLE` | shopify.app.toml handle | env (default `busymate-ai`) |

Nothing above can be produced from a code session — each needs the Partner Dashboard,
a host, or a Busymate AI credential.
