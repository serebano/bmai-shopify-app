import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { scheduleReingest } from "../lib/ingest";

// Order/fulfillment changes are NOT knowledge — a shopper's orders are read live
// through the store connection — so this hook never re-trains (the scheduler
// refuses the "orders" reason). Kept as the subscription target so the topic can
// be re-enabled once Protected Customer Data access is granted.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  const r = scheduleReingest(shop, "orders");
  console.log(`[kb] ${topic} for ${shop} → ${r.scheduled ? "re-train queued" : `no re-train (${r.reason})`}`);
  return new Response();
};
