import { describe, expect, it, vi } from "vitest";
import {
  appGidFromEnv,
  fetchActiveSubscription,
  partnerApiEndpoint,
  readPartnerApiConfig,
  subscriptionStateFromPartnerApi,
  type ActiveSubscription,
} from "../app/lib/partnerApi";

/**
 * Shopify App Pricing plan-state source = the Partner API Active Subscription
 * query (App Pricing sends NO billing webhooks; `currentAppInstallation.
 * activeSubscriptions` only reflects legacy Billing-API subs). Value-blind: the
 * Partner credential is read from env by NAME and only ever placed in a header.
 */
const ENV = {
  PARTNER_ORG_ID: "5148262",
  PARTNER_API_CLIENT_ID: "partner-client-id",
  PARTNER_API_CLIENT_SECRET: "partner-client-secret",
} as NodeJS.ProcessEnv;

describe("readPartnerApiConfig (value-blind, fail-closed)", () => {
  it("returns null when the org id or the credential is missing", () => {
    expect(readPartnerApiConfig({})).toBeNull();
    expect(readPartnerApiConfig({ PARTNER_ORG_ID: "1" })).toBeNull();
    expect(readPartnerApiConfig({ PARTNER_API_CLIENT_ID: "x", PARTNER_API_CLIENT_SECRET: "y" })).toBeNull();
  });
  it("an explicitly EMPTY credential is a refusal, not an absence", () => {
    expect(readPartnerApiConfig({ ...ENV, PARTNER_API_CLIENT_SECRET: "" })).toBeNull();
  });
  it("accepts client id + secret, and a static access token as an alternative", () => {
    expect(readPartnerApiConfig(ENV)).toMatchObject({ orgId: "5148262", clientId: "partner-client-id" });
    expect(readPartnerApiConfig({ PARTNER_ORG_ID: "1", PARTNER_API_ACCESS_TOKEN: "tok" })).toMatchObject({ orgId: "1", accessToken: "tok" });
  });
  it("never exposes the secret on the config object's enumerable surface", () => {
    const cfg = readPartnerApiConfig(ENV)!;
    expect(JSON.stringify(cfg)).not.toContain("partner-client-secret");
  });
  it("builds the versioned org endpoint", () => {
    expect(partnerApiEndpoint("5148262", "2026-07")).toBe("https://partners.shopify.com/5148262/api/2026-07/graphql.json");
  });
  it("derives the App GID from SHOPIFY_APP_ID or takes SHOPIFY_APP_GID verbatim", () => {
    expect(appGidFromEnv({ SHOPIFY_APP_ID: "416416825345" })).toBe("gid://shopify/App/416416825345");
    expect(appGidFromEnv({ SHOPIFY_APP_GID: "gid://shopify/App/1" })).toBe("gid://shopify/App/1");
    expect(appGidFromEnv({})).toBeNull();
  });
});

const SUB: ActiveSubscription = {
  billingPeriod: "EVERY_30_DAYS",
  cancelAtEndOfCycle: false,
  trialEndsAt: null,
  currentBillingCycle: { startTime: "2026-09-01T00:00:00Z", endTime: "2026-10-01T00:00:00Z" },
  items: [
    { handle: "growth", description: "Growth", price: { __typename: "FlatRatePrice", active: true, currency: "USD", amount: "99.00" }, usage: null },
    { handle: "ai_resolution", description: "AI resolution", price: { __typename: "TieredPrice", active: true, currency: "USD", tiersMode: "GRADUATED", tiers: [] }, usage: { quantity: 12, cost: { amount: "5.28", currencyCode: "USD" } } },
  ],
  pendingUpdate: null,
  legacySubscriptionId: null,
};

describe("fetchActiveSubscription", () => {
  it("POSTs the ActiveSubscription query with the Partner token in X-Shopify-Access-Token and parses the contract", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "https://api.shopify.com/auth/access_token") {
        return new Response(JSON.stringify({ access_token: "minted-token", expires_in: 3599 }), { status: 200 });
      }
      expect(url).toBe("https://partners.shopify.com/5148262/api/2026-07/graphql.json");
      const headers = init?.headers as Record<string, string>;
      expect(headers["X-Shopify-Access-Token"]).toBe("minted-token");
      const body = JSON.parse(String(init?.body));
      expect(body.variables).toEqual({ appId: "gid://shopify/App/416416825345", shopId: "gid://shopify/Shop/5678" });
      return new Response(JSON.stringify({ data: { activeSubscription: SUB } }), { status: 200 });
    });
    const out = await fetchActiveSubscription(
      { appGid: "gid://shopify/App/416416825345", shopGid: "gid://shopify/Shop/5678" },
      { env: ENV, fetch: fetchMock as unknown as typeof fetch },
    );
    expect(out.ok).toBe(true);
    expect(out.ok && out.subscription?.items[0].handle).toBe("growth");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns { ok:true, subscription:null } when the shop has no App Pricing contract (Free / never chose)", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: { activeSubscription: null } }), { status: 200 }));
    const out = await fetchActiveSubscription(
      { appGid: "gid://shopify/App/1", shopGid: "gid://shopify/Shop/2" },
      { env: { PARTNER_ORG_ID: "1", PARTNER_API_ACCESS_TOKEN: "tok" }, fetch: fetchMock as unknown as typeof fetch },
    );
    expect(out).toEqual({ ok: true, subscription: null });
  });

  it("fails CLOSED (ok:false, never a fake state) without a credential, on a GraphQL error, and on a non-200", async () => {
    const none = await fetchActiveSubscription({ appGid: "gid://shopify/App/1", shopGid: "gid://shopify/Shop/2" }, { env: {}, fetch: vi.fn() as unknown as typeof fetch });
    expect(none.ok).toBe(false);
    expect(!none.ok && none.error).toMatch(/PARTNER_/);

    const gqlErr = await fetchActiveSubscription(
      { appGid: "gid://shopify/App/1", shopGid: "gid://shopify/Shop/2" },
      { env: { PARTNER_ORG_ID: "1", PARTNER_API_ACCESS_TOKEN: "tok" }, fetch: (async () => new Response(JSON.stringify({ errors: [{ message: "Only public apps can access active subscription" }] }), { status: 200 })) as unknown as typeof fetch },
    );
    expect(gqlErr.ok).toBe(false);
    expect(!gqlErr.ok && gqlErr.error).toMatch(/public apps/);

    const http = await fetchActiveSubscription(
      { appGid: "gid://shopify/App/1", shopGid: "gid://shopify/Shop/2" },
      { env: { PARTNER_ORG_ID: "1", PARTNER_API_ACCESS_TOKEN: "tok" }, fetch: (async () => new Response("nope", { status: 401 })) as unknown as typeof fetch },
    );
    expect(http.ok).toBe(false);
    expect(!http.ok && http.error).toMatch(/401/);
  });
});

describe("subscriptionStateFromPartnerApi", () => {
  it("an active contract ⇒ active + the plan matched from the plan handle item", () => {
    expect(subscriptionStateFromPartnerApi(SUB)).toEqual({
      status: "active",
      subscriptionId: null,
      plan: "growth",
      trialEndsAt: null,
      cycleStart: "2026-09-01T00:00:00Z",
      cycleEnd: "2026-10-01T00:00:00Z",
      cancelAtEndOfCycle: false,
      usageQuantity: 12,
    });
  });
  it("a trial is active (the merchant is on the plan) with trialEndsAt set and no cycle yet", () => {
    const s = subscriptionStateFromPartnerApi({ ...SUB, trialEndsAt: "2026-09-15T00:00:00Z", currentBillingCycle: null });
    expect(s.status).toBe("active");
    expect(s.trialEndsAt).toBe("2026-09-15T00:00:00Z");
    expect(s.cycleStart).toBeNull();
  });
  it("no contract ⇒ inactive with no plan (the gate models that as Free)", () => {
    expect(subscriptionStateFromPartnerApi(null)).toMatchObject({ status: "inactive", plan: null, subscriptionId: null });
  });
  it("carries a legacy Billing-API subscription id when Shopify migrated it", () => {
    expect(subscriptionStateFromPartnerApi({ ...SUB, legacySubscriptionId: "gid://shopify/AppSubscription/9" }).subscriptionId).toBe("gid://shopify/AppSubscription/9");
  });
});
