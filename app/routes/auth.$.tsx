import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

// Managed-auth catch-all. Token exchange + afterAuth (bmai provision lifecycle)
// run inside authenticate.admin.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};
