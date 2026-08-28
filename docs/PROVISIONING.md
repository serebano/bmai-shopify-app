# Provisioning — install → live

Every step runs through **Busymate AI MCP tools** (all-ops-via-MCP). `app/bmai.server.ts`
is the single integration seam. Idempotent: safe to re-run on every re-auth.

## Sequence

1. **Merchant clicks Install** → Shopify managed OAuth → the app stores the
   **offline access token** (`Session`, Prisma). `hooks.afterAuth` fires.
2. **Provision the tenant** — `provision_partner_tenant({ partner:"shopify", shop, slug, proof })`.
   - The store becomes an `is_platform=false` tenant. `slug` = `shopToSlug(shop)`
     (`app/lib/tenantSlug.ts`), giving the serving host `<slug>.busymate.ai` off the
     platform apex cert — **no per-store DNS/cert**.
3. **Branding** — `set_tenant_branding` (shop name/logo/theme colors; refined in
   `app/routes/app.settings.tsx`).
4. **Serving host + embed origins** — `set_tenant_domain(slug)` +
   `add_tenant_embed_origin([ https://<shop>.myshopify.com, custom domain ])`. The
   storefront origins go into the tenant's **published embed-origin allowlist**
   (checked by `embed/v1.js`), NOT `tenant_domains`.
5. **Merchant admin** — `add_tenant_admin(email)`.
6. **Register the Shopify Admin connector** — `upsert_tenant_support_connector`
   with `endpoint = https://shopify.busymate.ai/mcp`, `mode = signed_actor_token`,
   and the four-tier `mcp_connector_support_policies`.
7. **Auto-train** — `app/lib/ingest.ts` builds the KB snapshot (products + policies
   + pages).
8. **Publish** — `publish_tenant_runtime` (draft → preflight → publish, server-side).
   The projection worker delivers → the tenant goes LIVE.
9. **Widget** — the theme app extension injects `/embed/v1.js data-assistant=<slug>`;
   logged-in customers get identified launch (App Proxy `logged_in_customer_id` →
   `/identity` mints the ES256 launch JWT).
10. **Metering** — resolved conversations → Shopify Billing usage charge (capped) +
    internal `usage_events`.

## The provisioning-credential gap (OWNER-GATED)

`provision_tenant` (creating a NEW tenant) is a **platform-operator** action; a
tenant-admin cannot mint one. So the Shopify app cannot self-provision with only
merchant credentials. Two paths:

- **Recommended:** build a Busymate AI **`provision_partner_tenant`** MCP tool gated by
  *proof-of-shop* (a verified Shopify shop signature) → self-serve, no shared
  operator secret. (This lives on the Busymate AI side.)
- **Fallback:** the app holds a dedicated, narrowly-scoped operator/service OAuth
  client that can ONLY provision + wire branding/domain/admin/connector.

Until the credential exists, `callMcpTool` returns `{ ok:false, error }` and the
lifecycle records `provisionState:"error"` — it **does not fake success**
(green-while-dead is a bounce-able anti-pattern). The install is retryable from
**Connector & data → Re-provision**.

## Teardown

- `app/uninstalled` → `suspend_tenant` + purge sessions (soft; keeps data 48h).
- `shop/redact` (GDPR, 48h later) → `delete_tenant` + purge all local state.
