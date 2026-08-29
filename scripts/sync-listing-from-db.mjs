#!/usr/bin/env node
/**
 * `npm run listing:sync` — regenerate this repo's DERIVED listing artifacts from
 * the canonical `store_apps` record (busymate-devtools#2036).
 *
 * The canonical record is the single source of truth. This writes the artifacts
 * that are derivable IN-REPO:
 *   • listing/pricing.json  — the Managed-Pricing source-of-record (the plans a
 *     human hand-enters into the Partner Dashboard). Kept here so pricing is
 *     auditable + drift-checkable in git.
 *   • shopify.app.toml name — the ONE CLI-pushable listing field, kept equal to
 *     the canonical name so `shopify app deploy` (App Automation Token) pushes
 *     the right value.
 *
 * It does NOT touch the Partner Dashboard (Shopify exposes no API for listing
 * copy / screenshots / Managed Pricing — see the drift-check header). After
 * running this, `npm run drift-check` should be green; the human then applies
 * the regenerated pricing + copy in the Partner Dashboard.
 *
 * Usage: node scripts/sync-listing-from-db.mjs [--record r.json] [--dry-run]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchCanonicalRecord } from "./lib/store-canonical.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DRY = process.argv.includes("--dry-run");
function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function pricingArtifact(record) {
  return {
    _generated: "DERIVED from the canonical store_apps record — do not hand-edit.",
    _source: "https://busymate.ai/api/store/apps/busymate-ai-shopify",
    _note: "Managed Pricing is Partner-Dashboard-only; this is the source-of-record a human enters there. `npm run drift-check` asserts it matches the canonical record.",
    app: record.slug,
    pricingModel: record.pricingModel,
    plans: (record.pricingPlans ?? []).map((p) => ({
      kind: p.kind,
      name: p.name,
      amountCents: p.amountCents,
      currency: p.currency,
      interval: p.interval,
      features: p.features,
    })),
  };
}

async function main() {
  const { record, source } = await fetchCanonicalRecord({ recordFile: arg("--record") });
  console.log(`listing:sync — canonical: ${source}\n  app: ${record.name} (${record.slug})\n`);

  // 1. listing/pricing.json
  const pricingPath = join(ROOT, "listing/pricing.json");
  const nextPricing = JSON.stringify(pricingArtifact(record), null, 2) + "\n";
  let prevPricing = "";
  try { prevPricing = readFileSync(pricingPath, "utf8"); } catch { /* absent */ }
  if (prevPricing !== nextPricing) {
    console.log(`  ${DRY ? "[dry-run] would write" : "wrote"} listing/pricing.json (${record.pricingPlans?.length ?? 0} plans)`);
    if (!DRY) writeFileSync(pricingPath, nextPricing);
  } else {
    console.log("  listing/pricing.json already in sync");
  }

  // 2. shopify.app.toml name (the CLI-pushable listing field)
  const tomlPath = join(ROOT, "shopify.app.toml");
  const toml = readFileSync(tomlPath, "utf8");
  const nextToml = toml.replace(/^(\s*name\s*=\s*")[^"]*(")/m, `$1${record.name}$2`);
  if (nextToml !== toml) {
    console.log(`  ${DRY ? "[dry-run] would update" : "updated"} shopify.app.toml name → "${record.name}"`);
    if (!DRY) writeFileSync(tomlPath, nextToml);
  } else {
    console.log(`  shopify.app.toml name already "${record.name}"`);
  }

  console.log(`\nNext: review the diff, commit, then hand-apply pricing + copy in the Partner Dashboard.`);
  console.log(`Run \`npm run drift-check\` to confirm the repo artifacts match the canonical record.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
