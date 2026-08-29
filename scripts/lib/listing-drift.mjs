/**
 * Listing drift — the pure comparison behind the "ONE DB source → all surfaces"
 * guarantee (busymate-devtools#2036).
 *
 * The CANONICAL source of truth for this app's listing content is the
 * `store_apps` record in the Busymate control plane, read publicly at
 * `GET https://busymate.ai/api/store/apps/busymate-ai-shopify`. THIS repo holds
 * DERIVED artifacts a human copies into the Shopify Partner Dashboard, because
 * Shopify exposes NO API/CLI to write listing marketing content or Managed
 * Pricing (verified — see docs/architecture/store-single-source in the devtools
 * repo). So drift is inevitable unless something WATCHES for it: this module is
 * that watcher. It compares the canonical record against the repo's derived
 * artifacts and reports every field that diverges.
 *
 * Pure + dependency-free so it runs under `node` (the CLI) AND `vitest` (the
 * TEST-1 unit) from ONE implementation.
 *
 * @typedef {Object} PricingPlan
 * @property {string} kind
 * @property {string} name
 * @property {number} amountCents
 * @property {string} currency
 * @property {string|null} interval
 * @property {string[]} features
 *
 * @typedef {Object} CanonicalRecord
 * @property {string} slug
 * @property {string} name
 * @property {string|null} tagline
 * @property {string|null} descriptionMd
 * @property {PricingPlan[]} pricingPlans
 *
 * @typedef {Object} RepoArtifacts
 * @property {string|null} tomlName            shopify.app.toml `name`
 * @property {Object} listingEn                listing/en.json (parsed)
 * @property {PricingPlan[]|null} pricingJson   listing/pricing.json plans (parsed, or null if absent)
 */

/** Normalize a plan to the comparable core (order-independent, trimmed). */
export function normalizePlan(p) {
  return {
    kind: String(p.kind ?? "").trim(),
    name: String(p.name ?? "").trim(),
    amountCents: Number(p.amountCents ?? p.amount_cents ?? 0),
    currency: String(p.currency ?? "usd").trim().toLowerCase(),
    interval: p.interval ? String(p.interval).trim() : null,
    features: (p.features ?? []).map((f) => String(f).trim()),
  };
}

function plansEqual(a, b) {
  const na = a.map(normalizePlan);
  const nb = b.map(normalizePlan);
  if (na.length !== nb.length) return false;
  // Compare by name (stable identity), order-independent.
  const byName = (list) => Object.fromEntries(list.map((p) => [p.name, p]));
  const ma = byName(na);
  const mb = byName(nb);
  const names = new Set([...Object.keys(ma), ...Object.keys(mb)]);
  for (const n of names) {
    if (!ma[n] || !mb[n]) return false;
    if (JSON.stringify(ma[n]) !== JSON.stringify(mb[n])) return false;
  }
  return true;
}

/**
 * The listing INTRO must equal the FIRST paragraph of the canonical
 * description. The canonical `description_md` is a rich markdown superset (it
 * adds a "What it does" bullet list + a Pricing section for the busymate.ai
 * store page), so only its lead paragraph maps 1:1 to the Shopify listing
 * intro — asserting the WHOLE blob would be a false positive.
 */
export function canonicalIntro(descriptionMd) {
  return String(descriptionMd ?? "").split(/\n\n+/)[0]?.trim() ?? "";
}

/**
 * Compare the canonical record against the repo's derived artifacts.
 * @param {CanonicalRecord} record
 * @param {RepoArtifacts} artifacts
 * @returns {{ ok: boolean, differences: Array<{field:string, canonical:any, repo:any, note?:string}> }}
 */
export function computeListingDrift(record, artifacts) {
  const diffs = [];
  const eq = (field, canonical, repo, note) => {
    const c = typeof canonical === "string" ? canonical.trim() : canonical;
    const r = typeof repo === "string" ? repo.trim() : repo;
    if (c !== r) diffs.push({ field, canonical: c, repo: r, ...(note ? { note } : {}) });
  };

  // App name — the ONE field that is BOTH a listing field AND a CLI-pushable
  // config field (shopify.app.toml). Both must equal the canonical name.
  eq("shopify.app.toml:name", record.name, artifacts.tomlName, "CLI-pushable via `shopify app deploy`");
  eq("listing/en.json:app_name", record.name, artifacts.listingEn?.app_name);

  // Marketing copy — Partner-Dashboard-ONLY (hand-entered).
  eq("listing/en.json:tagline", record.tagline ?? "", artifacts.listingEn?.tagline ?? "");
  eq(
    "listing/en.json:intro",
    canonicalIntro(record.descriptionMd),
    (artifacts.listingEn?.intro ?? "").trim(),
    "the lead paragraph of the canonical description",
  );

  // Managed Pricing — Partner-Dashboard-ONLY. listing/pricing.json is the
  // human's source-of-record for the Dashboard entry; it must equal the DB.
  if (!artifacts.pricingJson) {
    diffs.push({
      field: "listing/pricing.json",
      canonical: `${record.pricingPlans?.length ?? 0} plan(s)`,
      repo: "MISSING",
      note: "run `npm run listing:sync` to regenerate from the canonical record",
    });
  } else if (!plansEqual(record.pricingPlans ?? [], artifacts.pricingJson)) {
    diffs.push({
      field: "listing/pricing.json:plans",
      canonical: (record.pricingPlans ?? []).map((p) => `${p.name} $${(p.amountCents / 100).toFixed(2)}`),
      repo: artifacts.pricingJson.map((p) => `${p.name} $${(Number(p.amountCents ?? p.amount_cents ?? 0) / 100).toFixed(2)}`),
      note: "Managed Pricing plans diverge — the once-drifted field",
    });
  }

  return { ok: diffs.length === 0, differences: diffs };
}
