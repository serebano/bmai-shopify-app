import crypto from "node:crypto";

/**
 * Verify a storefront caller and extract the logged-in customer.
 *
 * The theme app extension calls /identity through the Shopify App Proxy, which
 * appends `logged_in_customer_id`, `shop`, `timestamp`, and an HMAC `signature`
 * over the sorted query params (keyed by the app SECRET). We MUST verify that
 * signature before trusting the customer id — otherwise anyone could claim any
 * customer. Guests arrive with an empty `logged_in_customer_id`.
 *
 * Docs: https://shopify.dev/docs/apps/build/online-store/app-proxies
 */
export interface VerifiedCustomer {
  shop: string;
  customerId: string;
}

const APP_SECRET = process.env.SHOPIFY_API_SECRET || "";

/**
 * Verify a Shopify App Proxy HMAC signature (constant-time). Pure + secret is
 * injected so it is unit-testable with known vectors. The signature is the hex
 * HMAC-SHA256 of the sorted, concatenated `key=value` params (excluding
 * `signature`), keyed by the app secret. A missing signature/secret fails closed.
 */
export function verifyAppProxyHmac(url: URL, secret: string): boolean {
  const signature = url.searchParams.get("signature");
  if (!signature || !secret) return false;
  const params: string[] = [];
  for (const [key, value] of url.searchParams) {
    if (key === "signature") continue;
    params.push(`${key}=${value}`);
  }
  params.sort();
  const digest = crypto
    .createHmac("sha256", secret)
    .update(params.join(""))
    .digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
  } catch {
    return false;
  }
}

export async function verifyStorefrontCustomer(request: Request): Promise<VerifiedCustomer | null> {
  const url = new URL(request.url);
  if (!verifyAppProxyHmac(url, APP_SECRET)) return null; // fail-closed
  const shop = url.searchParams.get("shop");
  const customerId = url.searchParams.get("logged_in_customer_id");
  if (!shop || !customerId) return null; // guest or unauthenticated
  return { shop, customerId };
}
