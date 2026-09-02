# Changelog

Newest first. Each entry names the app-repo commit on `main`, the Shopify app version
it released (Dev Dashboard → Versions) and the host build serving
`https://store.busymate.ai`.

## 2026-09-02 — main `0447ff3` (+ follow-up) · Shopify version **busymate-ai-5** · host `store.busymate.ai`

App Store resubmission for busymate-devtools#2110 (review reference 132497).

- **Billing (1.2.1)** — Shopify App Pricing is the only billing path: plan catalog ==
  `listing/pricing.json`, plan state from the Partner API `activeSubscription` +
  `?plan_handle=` redirect, App Events `ai_resolution` metering behind a secret-gated
  `POST /api/billing/meter` (hourly systemd timer on the host), honest plan cards.
- **Expiring offline tokens** — `@shopify/shopify-app-react-router` 2.1.0 with
  `future.expiringOfflineAccessTokens`; `Session.refreshToken` / `refreshTokenExpires`
  (encrypted at rest); background Admin calls refresh through `unauthenticated.admin`;
  `npm run tokens:cycle` cycled the 2 existing offline sessions on the host.
- **Grounded knowledge (auto-train)** — products / shop policies / pages →
  `publish_tenant_runtime.knowledge_sources` (`shopify:policies` / `shopify:products` /
  `shopify:pages`, ≤20,000 chars each, ≤40,000 total, deterministic truncation) at
  install, on product webhooks (debounced), on a scope grant and on "Re-train on my
  store"; training state on `ShopTenant` (`kb*` columns) shown on Home + Store
  connection; errors persisted and surfaced. New scope `read_legal_policies`.
- **Reinstall** — `provision_partner_tenant` `reactivated:true` → re-publish → Home "Live".
- **Onboarding / admin UX (5.1.3 / 5.1.5)** — setup checklist + theme-editor deep link,
  merchant Settings / Store connection / Conversations pages, branded error boundary,
  `/auth/login` never 500s, `/favicon.ico` + `/robots.txt`.
- **In-app navigation** — Polaris `Link url` / `Button url` now route through React
  Router inside the admin iframe (`app/components/PolarisLink.tsx`); a raw anchor
  reloaded a bare URL the embedded auth could not serve.
- **App Proxy** — `/apps/busymate-ai/*` → `https://store.busymate.ai` (storefront identity).
- **Extension i18n** — launcher copy from `locales/*.json` (14 locales) + `t:` schema keys.
- **Listing + legal** — final listing copy ×14 in sync with the canonical store record
  (`npm run drift-check`), `docs/legal/{privacy,faq,terms}` rendered to
  `store.busymate.ai/legal/*` (nginx `/legal/terms` added).
- **Docs** — `docs/review/app-store-review-resolution.md` (1.2.1, expiring tokens,
  grounded knowledge, reinstall, App Proxy/identity, `/auth/login`, in-app navigation,
  scopes_update), SETUP §3b/§3c/§3c-bis/§3d/§11, CHECKLIST, README, CLAUDE.md.
- **CI** — workflows on Node 22 (`engines >=22`).

Shopify version busymate-ai-5 (Active, source `0447ff3`): scopes
`read_content,read_customers,read_fulfillments,read_legal_policies,read_orders,read_products,read_returns,write_orders,write_returns`,
App proxy `apps/busymate-ai → https://store.busymate.ai`, 6 webhook subscriptions,
theme extension `storefront-assistant`.
