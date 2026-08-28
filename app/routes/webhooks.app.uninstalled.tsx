import type { ActionFunctionArgs } from "react-router";
import { authenticate, onAppUninstalled } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  console.log(`Received ${topic} for ${shop}`);
  // Suspend/teardown the tenant + purge sessions (do NOT hard-delete on uninstall;
  // shop/redact 48h later does the full purge).
  await onAppUninstalled(shop);
  return new Response();
};
