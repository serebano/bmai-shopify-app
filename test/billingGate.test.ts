import { describe, expect, it } from "vitest";
import { managedPricingUrl, resolveBillingAccess, widgetEnabled } from "../app/lib/billingGate";

// The Shopify App Pricing gate. Proves the Free-plan model (no subscription is
// NOT a warning), the plan-selection URL, and the hard invariant that the
// storefront widget is NEVER disabled by billing state.

const shop = "acme.myshopify.com";
const appHandle = "busymate-ai";

describe("billing gate", () => {
  it("builds the App Pricing plan-selection URL from the shop + app handle", () => {
    expect(managedPricingUrl(shop, appHandle)).toBe("https://admin.shopify.com/store/acme/charges/busymate-ai/pricing_plans");
  });

  it("no subscription ⇒ NO PLAN SELECTED (Free-plan limits): allowed, an INFO notice, no must-subscribe warning (#2132 D)", () => {
    const a = resolveBillingAccess({ status: "inactive", plan: null, shop, appHandle });
    expect(a).toMatchObject({ allowed: true, mustSubscribe: false, planId: "free", planSelected: false, tone: "info" });
    // Shopify's Manage apps says "No plan selected" for a shop with no contract — the app says the same, never "on the Free plan".
    expect(a.reason).toMatch(/no plan selected/i);
    expect(a.reason).not.toMatch(/^Free plan$/);
    expect(a.redirectTo).toBe(managedPricingUrl(shop, appHandle)); // where "Choose a plan" goes
  });

  it("a missing/unknown status is treated as Free (fail-safe: never blocks, never warns)", () => {
    const a = resolveBillingAccess({ status: undefined, shop, appHandle });
    expect(a.mustSubscribe).toBe(false);
    expect(a.planId).toBe("free");
  });

  it("an active paid plan is allowed with no notice and the matched plan id", () => {
    const a = resolveBillingAccess({ status: "active", plan: "growth", shop, appHandle });
    expect(a).toMatchObject({ allowed: true, mustSubscribe: false, planId: "growth", tone: "none" });
  });

  it("a SELECTED $0 Free plan is a real App Pricing contract (Partner API item handle 'free') ⇒ planSelected true (#2132 D)", () => {
    const a = resolveBillingAccess({ status: "active", plan: "free", shop, appHandle });
    expect(a).toMatchObject({ planId: "free", planSelected: true, tone: "info", reason: "Free plan" });
  });

  it("an active contract on the Free plan handle is Free (info), not a paid plan", () => {
    const a = resolveBillingAccess({ status: "active", plan: "free", shop, appHandle });
    expect(a).toMatchObject({ planId: "free", tone: "info", mustSubscribe: false });
  });

  it("a pending selection is allowed and shows an info notice (confirming with Shopify)", () => {
    const a = resolveBillingAccess({ status: "pending", plan: "starter", shop, appHandle });
    expect(a).toMatchObject({ allowed: true, mustSubscribe: false, planId: "starter", tone: "info" });
  });

  it("a frozen subscription still leaves the widget on but WARNS the merchant to resolve billing", () => {
    const a = resolveBillingAccess({ status: "frozen", plan: "growth", shop, appHandle });
    expect(a).toMatchObject({ allowed: true, mustSubscribe: true, tone: "warning" });
    expect(a.redirectTo).toBe(managedPricingUrl(shop, appHandle));
  });

  it("a cancelled subscription falls back to Free (info), never a permanent warning", () => {
    const a = resolveBillingAccess({ status: "cancelled", plan: "growth", shop, appHandle });
    expect(a).toMatchObject({ planId: "free", tone: "info", mustSubscribe: false });
  });

  it("the storefront widget is NEVER disabled by billing (hard invariant)", () => {
    expect(widgetEnabled()).toBe(true);
    for (const status of ["inactive", "pending", "active", "frozen", "cancelled", "garbage"]) {
      expect(resolveBillingAccess({ status, shop, appHandle }).allowed).toBe(true);
    }
  });
});
