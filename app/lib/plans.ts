/**
 * THE plan catalog — the four Shopify App Pricing plans as configured in the
 * Partner Dashboard (Pricing → App Pricing). `id` == the App Pricing
 * `plan_handle` Shopify appends to the redirect URL and returns as the
 * subscription item `handle` in the Partner API.
 *
 * ONE SOURCE: `listing/pricing.json` (itself pinned to the canonical store
 * record by `npm run drift-check`) is the human's source-of-record for the
 * Partner entry; `test/plans.test.ts` asserts this catalog equals it field by
 * field, so an in-app price can no longer drift from what Shopify charges
 * (App Store Req 1.1.4 factual copy / 1.2.1 App Pricing).
 *
 * Pure + dependency-free (no Prisma, no fetch) so both the server and the tests
 * import it directly.
 */
export type PlanId = "free" | "starter" | "growth" | "scale";

export interface Plan {
  /** The App Pricing plan handle (immutable in the Partner Dashboard). */
  id: PlanId;
  handle: PlanId;
  name: string;
  /** Recurring monthly fee, USD cents (0 for Free). */
  monthlyCents: number;
  /** AI resolutions included in the monthly fee. */
  includedResolutions: number;
  /** Per-resolution price beyond the allowance, USD cents; null = no overage (Free routes to your team). */
  overageCents: number | null;
  /** App-enforced monthly overage ceiling, USD cents; null = no overage at all. */
  capCents: number | null;
  /** Free-trial days on the recurring fee (0 = none). */
  trialDays: number;
}

export const FREE_PLAN_ID: PlanId = "free";

export const PLANS: readonly Plan[] = [
  { id: "free", handle: "free", name: "Free", monthlyCents: 0, includedResolutions: 25, overageCents: null, capCents: null, trialDays: 0 },
  { id: "starter", handle: "starter", name: "Starter", monthlyCents: 1900, includedResolutions: 38, overageCents: 49, capCents: 20000, trialDays: 14 },
  { id: "growth", handle: "growth", name: "Growth", monthlyCents: 9900, includedResolutions: 225, overageCents: 44, capCents: 100000, trialDays: 14 },
  { id: "scale", handle: "scale", name: "Scale", monthlyCents: 34900, includedResolutions: 830, overageCents: 42, capCents: 500000, trialDays: 14 },
];

/** The plan for an id/handle; anything unknown (incl. no subscription) is Free. */
export function planFor(id: string | null | undefined): Plan {
  return planByHandle(id) ?? PLANS[0];
}

/** Case-insensitive match on the App Pricing plan handle (== id), or null. */
export function planByHandle(handle: string | null | undefined): Plan | null {
  const h = String(handle ?? "").trim().toLowerCase();
  if (!h) return null;
  return PLANS.find((p) => p.handle === h) ?? null;
}

/** $19 · $0.49 · $5,000 — whole dollars without cents, fractional with two. */
export function formatUsd(cents: number): string {
  const dollars = cents / 100;
  const whole = Number.isInteger(dollars);
  return `$${dollars.toLocaleString("en-US", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })}`;
}

/** Honest one-line merchant copy for a plan (what Shopify actually charges). */
export function describePlan(p: Plan): string {
  const parts = [`${formatUsd(p.monthlyCents)}/month`];
  if (p.overageCents === null) {
    parts.push(`${p.includedResolutions} resolutions included, then conversations route to your team`);
  } else {
    parts.push(`${p.includedResolutions} resolutions included, then ${formatUsd(p.overageCents)} each`);
    if (p.capCents !== null) parts.push(`${formatUsd(p.capCents)}/month overage cap`);
  }
  if (p.trialDays > 0) parts.push(`${p.trialDays}-day free trial`);
  return parts.join(" · ");
}

/**
 * Parse a listing plan's feature strings (listing/pricing.json, mirrored from the
 * canonical store record) into the metering facts. Fails CLOSED on an
 * unparseable allowance — a silent 0 would bill the merchant from the first
 * resolution.
 */
export function parseListingPlanFeatures(features: readonly string[]): {
  includedResolutions: number;
  overageCents: number | null;
  capCents: number | null;
} {
  const text = features.join("\n");
  const paid = text.match(/(\d+)\s+AI resolutions included, then \$(\d+(?:\.\d+)?)\/resolution/i);
  const free = text.match(/(\d+)\s+AI resolutions\/month, then routes to your team/i);
  const cap = text.match(/\$([\d,]+)\/month spend cap/i);
  if (paid) {
    return {
      includedResolutions: Number(paid[1]),
      overageCents: Math.round(Number(paid[2]) * 100),
      capCents: cap ? Number(cap[1].replace(/,/g, "")) * 100 : null,
    };
  }
  if (free) return { includedResolutions: Number(free[1]), overageCents: null, capCents: null };
  throw new Error(`listing plan has no parseable resolutions allowance: ${JSON.stringify(features)}`);
}

/**
 * How many of a batch of new resolutions are billable overage units, honoring the
 * plan's included allowance (per billing cycle) and its monthly overage cap.
 * App Pricing has no usage cap concept, so the app enforces the cap by not
 * reporting beyond it. Pure; the widget is never affected.
 */
export function computeBillableUnits(input: {
  plan: Plan;
  /** Resolutions already counted in this billing cycle (before this batch). */
  cycleResolutions: number;
  newResolutions: number;
}): { units: number; capped: boolean } {
  const { plan } = input;
  const before = Math.max(0, Math.floor(input.cycleResolutions));
  const fresh = Math.max(0, Math.floor(input.newResolutions));
  if (plan.overageCents === null || plan.overageCents <= 0 || fresh === 0) return { units: 0, capped: false };
  const billedBefore = Math.max(0, before - plan.includedResolutions);
  const billedAfter = Math.max(0, before + fresh - plan.includedResolutions);
  let units = billedAfter - billedBefore;
  let capped = false;
  if (plan.capCents !== null) {
    const capUnits = Math.floor(plan.capCents / plan.overageCents);
    const headroom = Math.max(0, capUnits - billedBefore);
    if (units > headroom) {
      units = headroom;
      capped = true;
    } else if (billedAfter >= capUnits) {
      capped = true;
    }
  }
  return { units, capped };
}
