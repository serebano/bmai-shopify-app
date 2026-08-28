import { describe, expect, it } from "vitest";
import { shopToSlug } from "../app/lib/tenantSlug";

// The slug drives <slug>.busymate.ai and MUST satisfy the whitelabel-sdk
// ASSISTANT_RE: ^[a-z0-9][a-z0-9-]{1,62}$.
const ASSISTANT_RE = /^[a-z0-9][a-z0-9-]{1,62}$/;

describe("shopToSlug", () => {
  it("derives a deterministic, SDK-valid slug from a myshopify domain", () => {
    const slug = shopToSlug("acme-store.myshopify.com");
    expect(slug).toBe("shop-acme-store");
    expect(slug).toMatch(ASSISTANT_RE);
  });

  it("is stable across calls (deterministic)", () => {
    expect(shopToSlug("Acme.myshopify.com")).toBe(shopToSlug("acme.myshopify.com"));
  });

  it("sanitizes underscores/dots and never ends with a hyphen", () => {
    const slug = shopToSlug("my_weird.shop.myshopify.com");
    expect(slug).toMatch(ASSISTANT_RE);
    expect(slug.endsWith("-")).toBe(false);
  });

  it("caps at 63 chars for a very long shop name", () => {
    const slug = shopToSlug(`${"a".repeat(80)}.myshopify.com`);
    expect(slug.length).toBeLessThanOrEqual(63);
    expect(slug).toMatch(ASSISTANT_RE);
  });
});
