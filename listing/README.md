# Listing copy — localized ×14

`en.json` is the canonical source. The App Store listing must ship translations
for all 14 Tier-1 locales (Built-for-Shopify): **en, es, pt-BR, fr, de, it, ru,
ro, tr, ar (RTL), zh-Hans (zh-CN), hi, ja, ko** — same keys as `en.json`, one file
per locale (`es.json`, `pt-BR.json`, …).

Translations are a **P3 owner deliverable** — real translations for each locale (not
English placeholders). Tracked in `../CHECKLIST.md`.

Do NOT commit machine-untranslated stubs that duplicate English; a locale file is
added only when it carries a real translation.
