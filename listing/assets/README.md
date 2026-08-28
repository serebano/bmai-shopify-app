# Listing assets

| Asset | Status | Notes |
|---|---|---|
| `icon.svg` / `icon-1200.png` | ✅ present | 1200×1200 app icon — Busymate AI green `#3ECF8E` speech bubble + AI spark on charcoal. Shopify applies its own corner mask; keep it full-bleed with no transparency. |
| Feature banner (1920×1080) | 🔒 owner | Marketing banner for the listing header. |
| Screenshots (≥ 3, 1600×900) | 🔒 owner | Embedded admin (Home / Settings / Connector / Billing) + the storefront widget. Capture on the live app. |
| Demo video (mp4/H.264) | 🔒 owner | ≤ 2 min walkthrough. Must be mp4 (H.264, yuv420p, +faststart) to play everywhere. |

The icon was rasterized from `icon.svg` (`qlmanage -t -s 1200 -o . icon.svg`).
Regenerate the PNG whenever the SVG changes.
