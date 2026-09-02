import { describe, expect, it, vi } from "vitest";
import { handleComplianceTopic, type ComplianceDeps } from "../app/lib/compliance";

// The mandatory GDPR webhook dispatch. HMAC verification is upstream (the route's
// authenticate.webhook); here we prove each topic ACTUALLY performs its effect
// (export / erase / teardown) and is idempotent — the #1 App Store rejection area.

function makeDeps(hasTenant = true): { deps: ComplianceDeps; spies: Record<string, ReturnType<typeof vi.fn>> } {
  const spies = {
    hasTenant: vi.fn(async () => hasTenant),
    exportCustomerData: vi.fn(async () => ({ ok: true })),
    redactCustomer: vi.fn(async () => ({ ok: true })),
    redactShop: vi.fn(async () => {}),
  };
  return { deps: spies as unknown as ComplianceDeps, spies };
}

const shop = "acme.myshopify.com";

describe("GDPR compliance dispatch", () => {
  it("customers/data_request exports the identified customer's data", async () => {
    const { deps, spies } = makeDeps();
    const out = await handleComplianceTopic("CUSTOMERS_DATA_REQUEST", { shop, customerId: "42" }, deps);
    expect(out).toMatchObject({ handled: true, action: "export", ok: true });
    expect(spies.exportCustomerData).toHaveBeenCalledWith(shop, "42");
    expect(spies.redactShop).not.toHaveBeenCalled();
  });

  it("customers/redact erases that customer's data", async () => {
    const { deps, spies } = makeDeps();
    const out = await handleComplianceTopic("CUSTOMERS_REDACT", { shop, customerId: "42" }, deps);
    expect(out).toMatchObject({ handled: true, action: "redact_customer", ok: true });
    expect(spies.redactCustomer).toHaveBeenCalledWith(shop, "42");
  });

  it("shop/redact tears the whole tenant down", async () => {
    const { deps, spies } = makeDeps();
    const out = await handleComplianceTopic("SHOP_REDACT", { shop, customerId: null }, deps);
    expect(out).toMatchObject({ handled: true, action: "redact_shop", ok: true });
    expect(spies.redactShop).toHaveBeenCalledWith(shop);
  });

  it("is idempotent for a customer topic with no customer id (no-op success)", async () => {
    const { deps, spies } = makeDeps();
    const out = await handleComplianceTopic("CUSTOMERS_REDACT", { shop, customerId: null }, deps);
    expect(out.ok).toBe(true);
    expect(spies.redactCustomer).not.toHaveBeenCalled();
  });

  it("surfaces a failed effect as ok:false (webhook must be retried, not silently green)", async () => {
    const { deps, spies } = makeDeps();
    spies.redactCustomer.mockResolvedValueOnce({ ok: false, error: "mcp down" });
    const out = await handleComplianceTopic("CUSTOMERS_REDACT", { shop, customerId: "7" }, deps);
    expect(out.ok).toBe(false);
    expect(out.error).toBe("mcp down");
  });

  it("an unknown topic is reported unhandled (never a fake 200)", async () => {
    const { deps } = makeDeps();
    const out = await handleComplianceTopic("ORDERS_UPDATED", { shop, customerId: null }, deps);
    expect(out.handled).toBe(false);
  });

  // #2110 — a shop with NO provisioned tenant holds nothing: data_request and
  // redact are satisfied by a 200 no-op ("nothing held"). Returning 500 here made
  // Shopify retry for 48h and counted as webhook failures during review (a fresh
  // reviewer store whose provisioning errored, a shop after shop/redact, an
  // unknown shop). A REAL MCP failure on a provisioned tenant still fails.
  describe("shop with no tenant (nothing held)", () => {
    it("customers/data_request is a 200 no-op and never calls the MCP export", async () => {
      const { deps, spies } = makeDeps(false);
      const out = await handleComplianceTopic("CUSTOMERS_DATA_REQUEST", { shop, customerId: "42" }, deps);
      expect(out).toMatchObject({ handled: true, action: "export", ok: true, noop: "nothing held" });
      expect(spies.exportCustomerData).not.toHaveBeenCalled();
    });

    it("customers/redact is a 200 no-op and never calls the MCP redact", async () => {
      const { deps, spies } = makeDeps(false);
      const out = await handleComplianceTopic("CUSTOMERS_REDACT", { shop, customerId: "42" }, deps);
      expect(out).toMatchObject({ handled: true, action: "redact_customer", ok: true, noop: "nothing held" });
      expect(spies.redactCustomer).not.toHaveBeenCalled();
    });

    it("a provisioned tenant whose MCP export fails is STILL a failure (500 path kept)", async () => {
      const { deps, spies } = makeDeps(true);
      spies.exportCustomerData.mockResolvedValueOnce({ ok: false, error: "mcp down" });
      const out = await handleComplianceTopic("CUSTOMERS_DATA_REQUEST", { shop, customerId: "42" }, deps);
      expect(out.ok).toBe(false);
      expect(out.noop).toBeUndefined();
    });

    it("shop/redact still runs the full teardown (it is the purge itself)", async () => {
      const { deps, spies } = makeDeps(false);
      const out = await handleComplianceTopic("SHOP_REDACT", { shop, customerId: null }, deps);
      expect(out.ok).toBe(true);
      expect(spies.redactShop).toHaveBeenCalledWith(shop);
    });
  });
});
