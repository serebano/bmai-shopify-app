import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Expiring offline tokens (#2110): every BACKGROUND Admin call (MCP connector
 * tools, KB ingest, billing reconcile, usage metering) must go through the
 * library's refreshing offline session — `unauthenticated.admin(shop)` — so a
 * 1-hour token is refreshed before use instead of failing after the first hour.
 * The old client read the Session row itself (no expiry check, no refresh).
 */
vi.mock("../app/shopify.server", () => ({
  unauthenticated: { admin: vi.fn() },
}));
// The legacy implementation read prisma directly; stub it so a regression here
// fails on the ASSERTIONS below rather than on a missing database.
vi.mock("../app/db.server", () => ({
  default: { session: { findFirst: async () => null } },
}));

import { unauthenticated } from "../app/shopify.server";
import { adminForShop } from "../app/mcp/shopifyAdmin";

const shop = "acme.myshopify.com";
const adminMock = unauthenticated.admin as unknown as ReturnType<typeof vi.fn>;

function fakeAdmin(body: unknown, status = 200) {
  const graphql = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  return { admin: { graphql }, session: { shop, accessToken: "x" }, graphql };
}

describe("adminForShop routes through the refreshing offline session", () => {
  beforeEach(() => {
    adminMock.mockReset(); // block body: a returned stub would be run as a cleanup hook
  });

  it("resolves the session via unauthenticated.admin and returns GraphQL data", async () => {
    const fake = fakeAdmin({ data: { shop: { name: "Acme" } } });
    adminMock.mockResolvedValue(fake);
    const admin = await adminForShop(shop);
    expect(admin.shop).toBe(shop);
    const data = await admin.graphql("query { shop { name } }", { a: 1 });
    expect(data).toEqual({ shop: { name: "Acme" } });
    expect(adminMock).toHaveBeenCalledWith(shop);
    expect(fake.graphql).toHaveBeenCalledWith("query { shop { name } }", { variables: { a: 1 } });
  });

  it("re-resolves the session on EVERY call so a refreshed token is always used", async () => {
    const fake = fakeAdmin({ data: { ok: true } });
    adminMock.mockResolvedValue(fake);
    const admin = await adminForShop(shop);
    await admin.graphql("query A { ok }");
    await admin.graphql("query B { ok }");
    // once eagerly (session must exist) + once per graphql() call
    expect(adminMock.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("fails eagerly with the reinstall message when no offline session exists", async () => {
    const err = new Error("Could not find a session for shop");
    err.name = "SessionNotFoundError";
    adminMock.mockRejectedValue(err);
    await expect(adminForShop(shop)).rejects.toThrow(/no offline token for acme\.myshopify\.com — reinstall required/);
  });

  it("surfaces GraphQL errors instead of returning partial data", async () => {
    adminMock.mockResolvedValue(fakeAdmin({ errors: [{ message: "Access denied" }] }));
    const admin = await adminForShop(shop);
    await expect(admin.graphql("query { shop { name } }")).rejects.toThrow(/Shopify Admin GraphQL errors/);
  });

  it("surfaces a non-2xx Admin response as an error", async () => {
    adminMock.mockResolvedValue(fakeAdmin({ errors: "throttled" }, 429));
    const admin = await adminForShop(shop);
    await expect(admin.graphql("query { shop { name } }")).rejects.toThrow(/Shopify Admin 429/);
  });
});
