import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { mintLaunchIdentity } from "../lib/identity";
import { verifyStorefrontCustomer } from "../lib/storefrontIdentity";

/**
 * POST /identity — the storefront widget's getIdentity endpoint.
 *
 * The theme app extension passes the logged-in customer signal (App Proxy
 * `logged_in_customer_id`, HMAC-verified by Shopify). We verify it and mint a
 * short-lived ES256 launch JWT whose subject is the customer id, scoping order
 * reads to that customer. Guests → 204 → anonymous chat still works (public tools).
 *
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const verified = await verifyStorefrontCustomer(request);
  if (!verified) {
    // Guest — no identity, public tools only. Not an error.
    return new Response(null, { status: 204 });
  }
  const identity = await mintLaunchIdentity({
    shop: verified.shop,
    sub: verified.customerId,
  });
  return Response.json(identity, {
    headers: { "cache-control": "no-store" },
  });
};

// GET is used by some SDK flows / preflight; same contract.
export const loader = async ({ request }: LoaderFunctionArgs) => action({ request } as ActionFunctionArgs);
