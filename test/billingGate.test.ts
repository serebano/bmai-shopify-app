import { describe, expect, it } from "vitest";
import {
  managedPricingUrl,
  resolveBillingAccess,
  widgetEnabled,
} from "../app/lib/billingGate";

// The Shopify Billing gate (Managed Pricing). Proves the check + redirect, and the
// hard invariant that the storefront widget is NEVER disabled by billing state.

const shop = "acme.myshopify.com";
const appHandle = "busymate-ai";

describe("billing gate", () => {
  it("builds the managed pricing URL from the shop + app handle", () => {
    expect(managedPricingUrl(shop, appHandle)).toBe(
      "https://admin.shopify.com/store/acme/charges/busymate-ai/pricing_plans",
    );
  });

  it("an active subscription is allowed with no redirect", () => {
    const a = resolveBillingAccess({ status: "active", shop, appHandle });
    expect(a.allowed).toBe(true);
    expect(a.mustSubscribe).toBe(false);
    expect(a.redirectTo).toBeNull();
  });

  it("no subscription must subscribe and redirects to managed pricing", () => {
    const a = resolveBillingAccess({ status: "inactive", shop, appHandle });
    expect(a.mustSubscribe).toBe(true);
    expect(a.redirectTo).toBe(managedPricingUrl(shop, appHandle));
  });

  it("a missing/unknown status defaults to must-subscribe (fail-safe)", () => {
    const a = resolveBillingAccess({ status: undefined, shop, appHandle });
    expect(a.mustSubscribe).toBe(true);
  });

  it("a frozen subscription still leaves the widget on but nudges the merchant", () => {
    const a = resolveBillingAccess({ status: "frozen", shop, appHandle });
    expect(a.allowed).toBe(true);
    expect(a.mustSubscribe).toBe(true);
  });

  it("the storefront widget is NEVER disabled by billing (hard invariant)", () => {
    expect(widgetEnabled()).toBe(true);
  });
});
