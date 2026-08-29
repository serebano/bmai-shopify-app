/**
 * Fetch the CANONICAL store record + read this repo's DERIVED listing artifacts
 * (busymate-devtools#2036). Shared by `drift-check.mjs` and
 * `sync-listing-from-db.mjs` so both talk to the ONE source the same way.
 *
 * The canonical record is public data (published apps only) read over the
 * sanctioned shared endpoint — NEVER a backdoor DB/storage write, and no secret
 * is required.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const APP_SLUG = "busymate-ai-shopify";
export const DEFAULT_ENDPOINT = `https://busymate.ai/api/store/apps/${APP_SLUG}`;

/** Distinct from a real drift: the source could not be read → UNVERIFIED. */
export class UnverifiedError extends Error {}

/**
 * @param {{ endpoint?: string, recordFile?: string }} opts
 * @returns {Promise<{ record: object, source: string }>}
 */
export async function fetchCanonicalRecord(opts = {}) {
  if (opts.recordFile) {
    const raw = readFileSync(opts.recordFile, "utf8");
    const parsed = JSON.parse(raw);
    const record = parsed.app ?? parsed; // accept the endpoint envelope or a bare record
    return { record, source: `file:${opts.recordFile}` };
  }
  const endpoint = opts.endpoint || process.env.BMAI_STORE_ENDPOINT || DEFAULT_ENDPOINT;
  let res;
  try {
    res = await fetch(endpoint, { headers: { accept: "application/json" } });
  } catch (e) {
    throw new UnverifiedError(`store endpoint unreachable (${endpoint}): ${e.message}`);
  }
  if (res.status === 404) {
    throw new UnverifiedError(`store endpoint 404 for ${endpoint} — is the app published and the endpoint deployed?`);
  }
  if (!res.ok) {
    throw new UnverifiedError(`store endpoint ${res.status} for ${endpoint}`);
  }
  const body = await res.json().catch(() => null);
  if (!body?.app) throw new UnverifiedError(`store endpoint returned no app for ${endpoint}`);
  return { record: body.app, source: endpoint };
}

/** Extract the `name = "..."` value from shopify.app.toml (top-level, no TOML dep). */
export function tomlName(tomlText) {
  const m = tomlText.match(/^\s*name\s*=\s*"([^"]*)"/m);
  return m ? m[1] : null;
}

/**
 * Read the repo's derived artifacts.
 * @param {string} rootDir repo root
 * @returns {import("./listing-drift.mjs").RepoArtifacts}
 */
export function loadRepoArtifacts(rootDir) {
  const readJson = (rel) => {
    try {
      return JSON.parse(readFileSync(join(rootDir, rel), "utf8"));
    } catch {
      return null;
    }
  };
  let tName = null;
  try {
    tName = tomlName(readFileSync(join(rootDir, "shopify.app.toml"), "utf8"));
  } catch {
    tName = null;
  }
  // listing/pricing.json is the wrapped artifact { _generated, …, plans: [] };
  // accept a bare array too. The comparator wants the plans array (or null).
  const pricingDoc = readJson("listing/pricing.json");
  const pricingJson = Array.isArray(pricingDoc)
    ? pricingDoc
    : Array.isArray(pricingDoc?.plans)
      ? pricingDoc.plans
      : null;
  return {
    tomlName: tName,
    listingEn: readJson("listing/en.json") ?? {},
    pricingJson,
  };
}
