import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { scheduleReingest } from "../lib/ingest";

// KB freshness: on any product create/update/delete, re-ingest the tenant KB
// snapshot so the grounded answers stay current. Debounced per shop.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  console.log(`[kb] ${topic} for ${shop} → schedule re-ingest`);
  await scheduleReingest(shop, "products");
  return new Response();
};
