import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FREE_PLAN_ID,
  PLANS,
  describePlan,
  formatUsd,
  parseListingPlanFeatures,
  planByHandle,
  planFor,
  computeBillableUnits,
} from "../app/lib/plans";
import { loadRepoArtifacts } from "../scripts/lib/store-canonical.mjs";

/**
 * PLAN CATALOG ↔ listing/pricing.json DRIFT (App Store Req 1.1.4 "factual copy" +
 * 1.2.1/1.2.2). The in-app plan list once showed per-resolution prices and caps that
 * contradicted the Partner-Dashboard plans (the Aug-31 rejection). This test pins
 * the ONE in-app catalog to the repo's source-of-record for the Partner Dashboard
 * entry (`listing/pricing.json`, itself asserted against the canonical store
 * record by `npm run drift-check`), so a price change must land in both or the
 * suite goes red.
 */
const ROOT = process.cwd();

describe("plan catalog == listing/pricing.json (drift gate)", () => {
  const { pricingJson } = loadRepoArtifacts(ROOT);

  it("listing/pricing.json is present and has the four Partner plans", () => {
    expect(pricingJson).not.toBeNull();
    expect((pricingJson ?? []).map((p: { name: string }) => p.name).sort()).toEqual(
      ["Free", "Growth", "Scale", "Starter"],
    );
  });

  it("every in-app plan matches its listing plan (fee · included · overage · cap)", () => {
    for (const plan of PLANS) {
      const listed = (pricingJson ?? []).find((p: { name: string }) => p.name === plan.name);
      expect(listed, `listing/pricing.json has no plan named ${plan.name}`).toBeDefined();
      expect(plan.monthlyCents, `${plan.name} monthly fee`).toBe(Number(listed!.amountCents));
      const parsed = parseListingPlanFeatures(listed!.features as string[]);
      expect(plan.includedResolutions, `${plan.name} included allowance`).toBe(parsed.includedResolutions);
      expect(plan.overageCents, `${plan.name} overage`).toBe(parsed.overageCents);
      expect(plan.capCents, `${plan.name} cap`).toBe(parsed.capCents);
    }
    expect(PLANS).toHaveLength((pricingJson ?? []).length);
  });

  it("the Partner plan handles are the ids (free/starter/growth/scale)", () => {
    expect(PLANS.map((p) => p.id)).toEqual(["free", "starter", "growth", "scale"]);
    for (const p of PLANS) expect(p.handle).toBe(p.id);
  });

  it("paid plans carry the 14-day trial; Free has none", () => {
    for (const p of PLANS) expect(p.trialDays).toBe(p.monthlyCents > 0 ? 14 : 0);
  });
});

describe("parseListingPlanFeatures", () => {
  it("parses a paid plan's included/overage/cap from the listing feature strings", () => {
    expect(
      parseListingPlanFeatures([
        "225 AI resolutions included, then $0.44/resolution",
        "$1,000/month spend cap",
        "Unlimited seats",
      ]),
    ).toEqual({ includedResolutions: 225, overageCents: 44, capCents: 100000 });
  });
  it("parses the Free plan (allowance, no overage, no cap)", () => {
    expect(parseListingPlanFeatures(["25 AI resolutions/month, then routes to your team", "No credit card required"])).toEqual({
      includedResolutions: 25,
      overageCents: null,
      capCents: null,
    });
  });
  it("fails closed on an unparseable allowance (never silently 0)", () => {
    expect(() => parseListingPlanFeatures(["Unlimited seats"])).toThrow(/allowance/);
  });
});

describe("catalog helpers", () => {
  it("planFor defaults to Free (no subscription ⇒ Free), never a paid plan", () => {
    expect(planFor(null).id).toBe(FREE_PLAN_ID);
    expect(planFor("nope").id).toBe(FREE_PLAN_ID);
    expect(planFor("growth").id).toBe("growth");
  });
  it("planByHandle matches the Shopify App Pricing plan_handle case-insensitively", () => {
    expect(planByHandle("Growth")?.id).toBe("growth");
    expect(planByHandle("SCALE")?.id).toBe("scale");
    expect(planByHandle("enterprise")).toBeNull();
  });
  it("describePlan is honest merchant copy (fee, allowance, overage, cap, trial)", () => {
    expect(describePlan(planFor("starter"))).toBe(
      "$19/month · 38 resolutions included, then $0.49 each · $200/month overage cap · 14-day free trial",
    );
    expect(describePlan(planFor("free"))).toBe("$0/month · 25 resolutions included, then conversations route to your team");
    expect(describePlan(planFor("scale"))).toContain("$5,000/month overage cap");
  });
  it("formatUsd renders whole dollars without cents and fractional with two", () => {
    expect(formatUsd(1900)).toBe("$19");
    expect(formatUsd(49)).toBe("$0.49");
    expect(formatUsd(500000)).toBe("$5,000");
  });
});

describe("computeBillableUnits (included allowance + app-enforced cap)", () => {
  const growth = planFor("growth"); // 225 included, $0.44, $1,000 cap ⇒ 2272 billable units max
  it("charges nothing while inside the included allowance", () => {
    expect(computeBillableUnits({ plan: growth, cycleResolutions: 0, newResolutions: 100 })).toEqual({ units: 0, capped: false });
    expect(computeBillableUnits({ plan: growth, cycleResolutions: 200, newResolutions: 25 })).toEqual({ units: 0, capped: false });
  });
  it("bills only the part of a batch that crosses the allowance", () => {
    expect(computeBillableUnits({ plan: growth, cycleResolutions: 220, newResolutions: 10 })).toEqual({ units: 5, capped: false });
  });
  it("clamps to the plan's monthly overage cap and flags capped", () => {
    // 2272 billable units fit under $1,000 at $0.44; 2262 already billed ⇒ 10 left
    expect(computeBillableUnits({ plan: growth, cycleResolutions: 225 + 2262, newResolutions: 50 })).toEqual({ units: 10, capped: true });
    expect(computeBillableUnits({ plan: growth, cycleResolutions: 225 + 2272, newResolutions: 50 })).toEqual({ units: 0, capped: true });
  });
  it("the Free plan never produces billable units", () => {
    expect(computeBillableUnits({ plan: planFor("free"), cycleResolutions: 1000, newResolutions: 50 })).toEqual({ units: 0, capped: false });
  });
});

describe("the repo's plan copy has no stale per-resolution-only pricing", () => {
  it("usageBilling re-exports the same catalog (one source)", async () => {
    const mod = await import("../app/lib/usageBilling");
    expect(mod.PLANS).toBe(PLANS);
  });
  it("the billing page + home never claim 'billed only for conversations it resolves'", () => {
    for (const rel of ["app/routes/app.billing.tsx", "app/routes/app._index.tsx"]) {
      const src = readFileSync(join(ROOT, rel), "utf8");
      expect(src, rel).not.toMatch(/billed only for conversations/i);
      expect(src, rel).not.toMatch(/Pay per resolution/i);
    }
  });
});
