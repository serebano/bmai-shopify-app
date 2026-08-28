import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { scheduleReingest } from "../lib/ingest";

// Order/fulfillment changes don't feed the KB directly (order reads are live via
// the connector), but a cancellation/refund may invalidate a cached WISMO answer;
// keep the hook so policy/threshold changes can re-train.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  console.log(`[kb] ${topic} for ${shop}`);
  await scheduleReingest(shop, "orders");
  return new Response();
};
