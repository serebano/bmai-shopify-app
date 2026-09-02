# Listing copy — localized ×14

`en.json` is the source a human pastes into the Shopify Partner Dashboard listing editor;
it mirrors the **canonical store record** (`intro` = paragraph 1 and `details` = paragraph 2
of the record's `descriptionMd`, `tagline` = the record's tagline, `privacy_url` = the
record's `privacyUrl` — all asserted by `npm run drift-check`). The listing ships
translations for all 14 Tier-1 locales (Built-for-Shopify): **en, es, pt-BR, fr, de, it,
ru, ro, tr, ar (RTL), zh-Hans (zh-CN), hi, ja, ko** — same keys as `en.json`, one file per
locale (`es.json`, `pt-BR.json`, …). All 14 carry real translations (not English
placeholders) and the same locales exist on the record; keep them in sync with `en.json`
on every copy change.

`pricing.json` is **generated** (`npm run listing:sync`) from the record's plans — do not
hand-edit it.

**Copy rules** (enforced by `test/listing-copy.test.ts`, see `docs/LISTING.md`):

- No pricing words in `intro` / `details` / `feature_bullets` (Req 4.2.3 — pricing only in
  Pricing details). `pricing_summary` is the one field that may mention plans and it is used
  only on the busymate.ai store page.
- No numerals / statistics in those fields, in any script (Req 4.3.3 / 4.4.1) — no language
  counts; say "in the shopper's language".
- Factual only (Req 4.3.3): no guarantees, no unverifiable superlatives, no competitor-flaw
  positioning. Grounding is "answers only from your store content, with sources, and says
  when it is not sure" — never "no hallucinations".
- `feature_bullets` = 3–5 items ≤ 80 chars (the Partner "Features" field).
