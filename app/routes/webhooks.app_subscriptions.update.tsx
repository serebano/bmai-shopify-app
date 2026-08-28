import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { subscriptionStateFromWebhook } from "../lib/billingSync";
import { syncBillingState } from "../lib/billingState.server";

/**
 * `app_subscriptions/update` — Shopify fires this when a merchant accepts, declines,
 * cancels, freezes, or re-requests the app subscription. We normalize the status and
 * upsert BillingState so `resolveBillingAccess()` reflects the real plan on the next
 * admin load (Req 1.2.2). HMAC is verified by `authenticate.webhook` (fail-closed).
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  const state = subscriptionStateFromWebhook(payload);
  const synced = await syncBillingState(shop, state);
  console.log(`[billing] ${topic} shop=${shop} status=${state.status} synced=${synced}`);
  return new Response();
};
