import { describe, expect, it } from "vitest";
import {
  computeUsageCharge,
  meterShop,
  planFor,
  widgetEnabled,
  type MeterDeps,
  type UsageLine,
} from "../app/lib/usageBilling";

/**
 * B5 — usage metering. Proves the AppUsageRecord charge path + cap clamping
 * (respecting cappedAmountCents), and the hard invariant that the widget is never
 * disabled by billing.
 */

const SHOP = "acme.myshopify.com";

function makeDeps(over: Partial<MeterDeps> & { line?: UsageLine | null; resolutions?: number } = {}): {
  deps: MeterDeps;
  created: Array<{ amountCents: number }>;
  savedCursor: string[];
} {
  const created: Array<{ amountCents: number }> = [];
  const savedCursor: string[] = [];
  const line: UsageLine | null =
    over.line !== undefined
      ? over.line
      : { lineItemId: "gid://shopify/AppSubscriptionLineItem/1", cappedAmountCents: 5000, balanceUsedCents: 0, currencyCode: "USD" };
  const deps: MeterDeps = {
    getBilling: async () => ({ status: "active", plan: "starter", lastMeteredCursor: "c0" }),
    getTenantId: async () => "t_1",
    readResolutions: async () => ({ resolutions: over.resolutions ?? 3, cursor: "c1" }),
    readUsageLine: async () => line,
    createUsageRecord: async ({ amountCents }) => {
      created.push({ amountCents });
      return { ok: true, id: "gid://shopify/AppUsageRecord/1" };
    },
    saveCursor: async (_shop, cursor) => {
      savedCursor.push(cursor);
    },
    ...over,
  };
  return { deps, created, savedCursor };
}

describe("computeUsageCharge (pure, cap-clamped)", () => {
  it("charges gross when within headroom", () => {
    expect(computeUsageCharge({ resolutions: 3, perResolutionCents: 50, headroomCents: 5000 })).toBe(150);
  });
  it("clamps to the remaining cap headroom", () => {
    expect(computeUsageCharge({ resolutions: 200, perResolutionCents: 50, headroomCents: 400 })).toBe(400);
  });
  it("is 0 at/over the cap (never negative)", () => {
    expect(computeUsageCharge({ resolutions: 3, perResolutionCents: 50, headroomCents: 0 })).toBe(0);
    expect(computeUsageCharge({ resolutions: 3, perResolutionCents: 50, headroomCents: -100 })).toBe(0);
  });
});

describe("meterShop", () => {
  it("creates an AppUsageRecord for resolutions and advances the cursor", async () => {
    const { deps, created, savedCursor } = makeDeps({ resolutions: 3 });
    const out = await meterShop(SHOP, deps);
    expect(created).toEqual([{ amountCents: 150 }]); // 3 × starter $0.50
    expect(out.chargedCents).toBe(150);
    expect(out.metered).toBe(3);
    expect(savedCursor).toEqual(["c1"]);
  });

  it("clamps the charge to cap headroom and flags capped", async () => {
    const { deps, created } = makeDeps({
      resolutions: 100,
      line: { lineItemId: "li", cappedAmountCents: 5000, balanceUsedCents: 4990, currencyCode: "USD" },
    });
    const out = await meterShop(SHOP, deps);
    expect(created).toEqual([{ amountCents: 10 }]); // only 10¢ headroom left
    expect(out.capped).toBe(true);
  });

  it("at the cap it charges nothing but still advances the cursor (widget stays on)", async () => {
    const { deps, created, savedCursor } = makeDeps({
      resolutions: 5,
      line: { lineItemId: "li", cappedAmountCents: 5000, balanceUsedCents: 5000, currencyCode: "USD" },
    });
    const out = await meterShop(SHOP, deps);
    expect(created).toEqual([]);
    expect(out).toMatchObject({ chargedCents: 0, capped: true });
    expect(savedCursor).toEqual(["c1"]);
  });

  it("does NOT charge an inactive subscription", async () => {
    const { deps, created } = makeDeps();
    deps.getBilling = async () => ({ status: "inactive", plan: "starter", lastMeteredCursor: "c0" });
    const out = await meterShop(SHOP, deps);
    expect(created).toEqual([]);
    expect(out.metered).toBe(0);
  });

  it("zero resolutions advances the cursor without charging", async () => {
    const { deps, created, savedCursor } = makeDeps({ resolutions: 0 });
    const out = await meterShop(SHOP, deps);
    expect(created).toEqual([]);
    expect(out.metered).toBe(0);
    expect(savedCursor).toEqual(["c1"]);
  });

  it("holds the cursor on a transient charge failure (never loses resolutions)", async () => {
    const { deps, savedCursor } = makeDeps({ resolutions: 3 });
    deps.createUsageRecord = async () => ({ ok: false, error: "throttled" });
    const out = await meterShop(SHOP, deps);
    expect(out.chargedCents).toBe(0);
    expect(out.error).toBe("throttled");
    expect(savedCursor).toEqual([]); // cursor NOT advanced
  });

  it("holds the cursor when there is no usage line item to charge", async () => {
    const { deps, savedCursor } = makeDeps({ resolutions: 3, line: null });
    const out = await meterShop(SHOP, deps);
    expect(out).toMatchObject({ metered: 3, chargedCents: 0 });
    expect(savedCursor).toEqual([]);
  });

  it("widgetEnabled() is unconditionally true", () => {
    expect(widgetEnabled()).toBe(true);
    expect(planFor("scale").perResolutionCents).toBe(30);
  });
});
