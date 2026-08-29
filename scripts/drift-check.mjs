#!/usr/bin/env node
/**
 * `npm run drift-check` — compare the LIVE canonical store record against this
 * repo's derived listing artifacts and FAIL when a field diverges
 * (busymate-devtools#2036, "ONE DB source → all surfaces").
 *
 * WHY: Shopify has no API/CLI to write listing marketing content or Managed
 * Pricing — those are hand-entered in the Partner Dashboard, so they drift
 * (they already did once: stale pricing). This check is the guarantee that we
 * always KNOW when the Dashboard-entered content has fallen out of step with
 * the single source of truth.
 *
 * Fields checked (canonical `store_apps` record ↔ repo artifact):
 *   • app name       → shopify.app.toml `name` (CLI-pushable) + listing/en.json
 *   • tagline        → listing/en.json
 *   • description    → listing/en.json (intro + details)
 *   • pricing plans  → listing/pricing.json (source-of-record for Managed Pricing)
 *
 * Exit codes (FAIL CLOSED — "couldn't check" is never a pass):
 *   0  in sync
 *   1  DRIFT — at least one field diverges
 *   2  UNVERIFIED — the canonical source could not be read (NOT an all-clear)
 *
 * Usage:
 *   node scripts/drift-check.mjs                 # live endpoint
 *   node scripts/drift-check.mjs --record r.json # offline, from a saved record
 *   BMAI_STORE_ENDPOINT=… node scripts/drift-check.mjs
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { computeListingDrift } from "./lib/listing-drift.mjs";
import { fetchCanonicalRecord, loadRepoArtifacts, UnverifiedError } from "./lib/store-canonical.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const recordFile = arg("--record");
  const endpoint = arg("--endpoint");
  let record, source;
  try {
    ({ record, source } = await fetchCanonicalRecord({ recordFile, endpoint }));
  } catch (e) {
    if (e instanceof UnverifiedError) {
      console.error(`\x1b[33mUNVERIFIED\x1b[0m — could not read the canonical record.\n  ${e.message}\n  This is NOT an all-clear. Fix the source or pass --record <file>.`);
      process.exit(2);
    }
    throw e;
  }

  const artifacts = loadRepoArtifacts(ROOT);
  const { ok, differences } = computeListingDrift(record, artifacts);

  console.log(`store drift-check — canonical: ${source}`);
  console.log(`  app: ${record.name} (${record.slug})\n`);

  if (ok) {
    console.log("\x1b[32m✓ IN SYNC\x1b[0m — every checked field matches the canonical record.");
    process.exit(0);
  }

  console.log(`\x1b[31m✗ DRIFT — ${differences.length} field(s) diverge from the canonical record:\x1b[0m\n`);
  for (const d of differences) {
    console.log(`  • ${d.field}${d.note ? `  (${d.note})` : ""}`);
    console.log(`      canonical: ${JSON.stringify(d.canonical)}`);
    console.log(`      repo     : ${JSON.stringify(d.repo)}`);
  }
  console.log(`\nManaged Pricing + listing COPY are Partner-Dashboard-only — after regenerating`);
  console.log(`the repo artifacts (\`npm run listing:sync\`), hand-apply them in the Partner Dashboard.`);
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
