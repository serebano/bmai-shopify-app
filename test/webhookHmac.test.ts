import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyAppProxyHmac } from "../app/lib/storefrontIdentity";

// Shopify App Proxy HMAC verification — the signed request the theme extension
// makes to /identity, which we MUST verify before trusting logged_in_customer_id.
// Same HMAC-SHA256 primitive Shopify uses for webhook signing; a regression here
// would let anyone impersonate any customer.

const SECRET = "shpss_test_secret_deadbeef";

function signedUrl(
  params: Record<string, string>,
  secret = SECRET,
): URL {
  const sorted = Object.entries(params)
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join("");
  const signature = crypto.createHmac("sha256", secret).update(sorted).digest("hex");
  const url = new URL("https://shopify.busymate.ai/identity");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("signature", signature);
  return url;
}

describe("App Proxy HMAC verification", () => {
  it("accepts a correctly signed request", () => {
    const url = signedUrl({ shop: "acme.myshopify.com", logged_in_customer_id: "42", timestamp: "1700000000" });
    expect(verifyAppProxyHmac(url, SECRET)).toBe(true);
  });

  it("rejects a tampered param (signature no longer matches)", () => {
    const url = signedUrl({ shop: "acme.myshopify.com", logged_in_customer_id: "42", timestamp: "1700000000" });
    url.searchParams.set("logged_in_customer_id", "99"); // tamper after signing
    expect(verifyAppProxyHmac(url, SECRET)).toBe(false);
  });

  it("rejects a wrong secret", () => {
    const url = signedUrl({ shop: "acme.myshopify.com", logged_in_customer_id: "42" });
    expect(verifyAppProxyHmac(url, "wrong_secret")).toBe(false);
  });

  it("fails closed with no signature present", () => {
    const url = new URL("https://shopify.busymate.ai/identity?shop=acme.myshopify.com");
    expect(verifyAppProxyHmac(url, SECRET)).toBe(false);
  });

  it("fails closed with an empty secret", () => {
    const url = signedUrl({ shop: "acme.myshopify.com" });
    expect(verifyAppProxyHmac(url, "")).toBe(false);
  });
});
