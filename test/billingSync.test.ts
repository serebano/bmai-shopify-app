import { describe, expect, it } from "vitest";
import {
  matchPlanId,
  normalizeSubscriptionStatus,
  subscriptionStateFromInstallation,
  subscriptionStateFromWebhook,
} from "../app/lib/billingSync";

/**
 * B3 — billing status sync. The status normalizer + payload extractors are what
 * make resolveBillingAccess() reflect a REAL subscription (accept/decline/
 * reinstall-re-request all converge). Widget-never-disabled is proven separately in
 * billingGate.test.ts.
 */
describe("subscription status normalization", () => {
  const cases: Array<[string, string]> = [
    ["ACTIVE", "active"],
    ["PENDING", "pending"],
    ["ACCEPTED", "pending"],
    ["FROZEN", "frozen"],
    ["CANCELLED", "cancelled"],
    ["DECLINED", "inactive"],
    ["EXPIRED", "inactive"],
    ["", "inactive"],
    ["something-unknown", "inactive"],
  ];
  for (const [raw, expected] of cases) {
    it(`${raw || "(empty)"} → ${expected}`, () => {
      expect(normalizeSubscriptionStatus(raw)).toBe(expected);
    });
  }
});

describe("plan-id matching", () => {
  it("matches by id and by display name, else null", () => {
    expect(matchPlanId("starter")).toBe("starter");
    expect(matchPlanId("Growth")).toBe("growth");
    expect(matchPlanId("Enterprise")).toBeNull();
    expect(matchPlanId(null)).toBeNull();
  });
});

describe("app_subscriptions/update webhook extraction", () => {
  it("maps status + captures the subscription GID and plan", () => {
    const state = subscriptionStateFromWebhook({
      app_subscription: {
        admin_graphql_api_id: "gid://shopify/AppSubscription/99",
        name: "Growth",
        status: "ACTIVE",
      },
    });
    expect(state).toEqual({ status: "active", subscriptionId: "gid://shopify/AppSubscription/99", plan: "growth" });
  });

  it("a declined subscription becomes inactive", () => {
    const state = subscriptionStateFromWebhook({ app_subscription: { status: "DECLINED" } });
    expect(state.status).toBe("inactive");
  });

  it("a malformed payload fails safe to inactive", () => {
    expect(subscriptionStateFromWebhook({}).status).toBe("inactive");
    expect(subscriptionStateFromWebhook(null).status).toBe("inactive");
  });
});

describe("currentAppInstallation.activeSubscriptions extraction", () => {
  it("prefers the ACTIVE subscription", () => {
    const state = subscriptionStateFromInstallation({
      currentAppInstallation: {
        activeSubscriptions: [
          { id: "gid://shopify/AppSubscription/1", name: "Starter", status: "PENDING" },
          { id: "gid://shopify/AppSubscription/2", name: "Scale", status: "ACTIVE" },
        ],
      },
    });
    expect(state).toEqual({ status: "active", subscriptionId: "gid://shopify/AppSubscription/2", plan: "scale" });
  });

  it("no subscriptions ⇒ inactive", () => {
    expect(subscriptionStateFromInstallation({ currentAppInstallation: { activeSubscriptions: [] } })).toEqual({
      status: "inactive",
      subscriptionId: null,
      plan: null,
    });
  });
});
