# App Store listing — content skeleton (localized ×14)

The Shopify App Store listing must be **localized into 14 locales** (Built-for-Shopify).
Draft copy lives under `listing/` — one JSON per locale, same keys. Screenshots and
the demo video are owner-provided assets (capture on the best fleet iPhone/desktop).

## Locales (14 Tier-1)

`en · es · pt-BR · fr · de · it · ru · ro · tr · ar · zh-Hans · hi · ja · ko`
(RTL for `ar`). Shopify storefront/extension locale codes use `zh-CN` for `zh-Hans`.

## Listing fields (per locale)

| Field | Notes |
|---|---|
| `app_name` | "Busymate AI" (brand constant; tagline localizes) |
| `tagline` | ≤ 62 chars — "Grounded, order-aware AI support for your store" (no guarantees / superlatives) |
| `intro` | ≤ 100 chars |
| `details` | Long description — trust / multilang / access wedges |
| `feature_bullets` | The 7 MVP features |
| `demo_store_url` | Reviewer test store (owner-gated) |
| `pricing_summary` | Pay-per-resolution, capped, never-disable-at-cap |
| `privacy_url` / `faq_url` | Data handling + least-privilege scopes |

## Positioning (the three wedges)

- **TRUST** — grounded, source-cited answers (refuse-when-unsure) + honest pricing.
- **MULTILANG** — 14 locales + RTL, auto-detected (uncontested in the category).
- **ACCESS** — enterprise-grade autonomous resolution at an honest SMB price,
  self-serve, no demo wall.

## Listing in the Busymate AI directory (optional)

Once the Shopify App Store listing exists and is approved, the app can also be registered
in the Busymate AI directory via MCP (no backdoor writes) so it is discoverable alongside
other Busymate AI integrations. Do this only after the App Store listing URL exists — the
directory `install_url` points at the live App Store page.

## Assets checklist (owner-provided)

- [ ] App icon (1200×1200)
- [ ] Feature banner
- [ ] 3–6 screenshots (the merchant admin + a live storefront resolution)
- [ ] Demo video (mp4, H.264 — plays on iPhone)
- [ ] Demo store + reviewer credentials
