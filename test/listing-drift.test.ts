/**
 * Listing drift-check (busymate-devtools#2036, "ONE DB source → all surfaces").
 * TEST-1 for the pure comparison that guards against the Partner-Dashboard-only
 * listing content falling out of step with the canonical `store_apps` record.
 *
 * Asserts BOTH directions: an in-sync repo passes, and each divergence class
 * (name, tagline, description, pricing amount, missing pricing.json) is caught —
 * a drift-check that can only ever say "ok" would be green-while-dead.
 */
import { describe, expect, it } from "vitest";
import { canonicalIntro, computeListingDrift, normalizePlan } from "../scripts/lib/listing-drift.mjs";

const RECORD = {
  slug: "busymate-ai-shopify",
  name: "Busymate AI",
  tagline: "Grounded, order-aware AI support for your store",
  descriptionMd: "Intro line here.\n\nDetails paragraph here.",
  pricingPlans: [
    { kind: "free", name: "Free", amountCents: 0, currency: "usd", interval: "month", features: ["25 AI resolutions/month"] },
    { kind: "flat", name: "Starter", amountCents: 1900, currency: "usd", interval: "month", features: ["38 included"] },
  ],
};

const IN_SYNC = {
  tomlName: "Busymate AI",
  listingEn: {
    app_name: "Busymate AI",
    tagline: "Grounded, order-aware AI support for your store",
    intro: "Intro line here.",
    details: "Details paragraph here.",
  },
  pricingJson: [
    { kind: "free", name: "Free", amountCents: 0, currency: "usd", interval: "month", features: ["25 AI resolutions/month"] },
    { kind: "flat", name: "Starter", amountCents: 1900, currency: "usd", interval: "month", features: ["38 included"] },
  ],
};

describe("computeListingDrift", () => {
  it("passes when every field matches the canonical record", () => {
    const r = computeListingDrift(RECORD, IN_SYNC);
    expect(r.ok).toBe(true);
    expect(r.differences).toHaveLength(0);
  });

  it("flags a stale shopify.app.toml name", () => {
    const r = computeListingDrift(RECORD, { ...IN_SYNC, tomlName: "Busymate" });
    expect(r.ok).toBe(false);
    expect(r.differences.map((d) => d.field)).toContain("shopify.app.toml:name");
  });

  it("flags a stale tagline in the listing copy", () => {
    const r = computeListingDrift(RECORD, {
      ...IN_SYNC,
      listingEn: { ...IN_SYNC.listingEn, tagline: "Old tagline" },
    });
    expect(r.ok).toBe(false);
    expect(r.differences.map((d) => d.field)).toContain("listing/en.json:tagline");
  });

  it("flags a stale intro (the lead paragraph of the canonical description)", () => {
    const r = computeListingDrift(RECORD, {
      ...IN_SYNC,
      listingEn: { ...IN_SYNC.listingEn, intro: "Changed intro line." },
    });
    expect(r.ok).toBe(false);
    expect(r.differences.map((d) => d.field)).toContain("listing/en.json:intro");
  });

  it("ignores the rich body below the intro (superset is not drift)", () => {
    // canonical description has extra markdown sections; only the lead
    // paragraph maps to the listing intro, so a longer canonical body is OK.
    const richRecord = {
      ...RECORD,
      descriptionMd: "Intro line here.\n\nDetails paragraph here.\n\n## Extra\n\n- bullet",
    };
    const r = computeListingDrift(richRecord, IN_SYNC);
    expect(r.ok).toBe(true);
  });

  it("flags stale Managed Pricing (the once-drifted field)", () => {
    const drifted = [
      { ...IN_SYNC.pricingJson[0] },
      { ...IN_SYNC.pricingJson[1], amountCents: 2900 }, // price changed
    ];
    const r = computeListingDrift(RECORD, { ...IN_SYNC, pricingJson: drifted });
    expect(r.ok).toBe(false);
    expect(r.differences.map((d) => d.field)).toContain("listing/pricing.json:plans");
  });

  it("flags a missing listing/pricing.json instead of passing silently", () => {
    const r = computeListingDrift(RECORD, { ...IN_SYNC, pricingJson: null });
    expect(r.ok).toBe(false);
    expect(r.differences.map((d) => d.field)).toContain("listing/pricing.json");
  });

  it("pricing comparison is order-independent but value-sensitive", () => {
    const reordered = [IN_SYNC.pricingJson[1], IN_SYNC.pricingJson[0]];
    const r = computeListingDrift(RECORD, { ...IN_SYNC, pricingJson: reordered });
    expect(r.ok).toBe(true);
  });
});

describe("helpers", () => {
  it("canonicalIntro returns the lead paragraph only", () => {
    expect(canonicalIntro("A line.\n\nB body.\n\n## More")).toBe("A line.");
  });
  it("normalizePlan accepts snake_case amount_cents", () => {
    expect(normalizePlan({ name: "X", amount_cents: 500 }).amountCents).toBe(500);
  });
});
