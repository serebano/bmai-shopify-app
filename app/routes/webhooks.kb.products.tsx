import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { scheduleReingest } from "../lib/ingest";

// KB freshness: on any product create/update/delete, re-train the tenant
// (products → knowledge_sources → publish) so grounded answers stay current.
// Debounced per shop (a bulk edit is one re-train); the outcome is persisted on
// ShopTenant (kbTrainedAt / kbError) and shown on Home + Store connection.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  const r = scheduleReingest(shop, "products");
  console.log(`[kb] ${topic} for ${shop} → re-train ${r.scheduled ? "queued" : `skipped: ${r.reason}`}`);
  return new Response();
};
