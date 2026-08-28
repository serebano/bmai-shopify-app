import prisma from "../db.server";
import { decryptField } from "../lib/fieldCipher";

const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-07";

export interface ShopifyAdminClient {
  shop: string;
  graphql(query: string, variables?: Record<string, unknown>): Promise<unknown>;
}

/**
 * An Admin GraphQL client bound to ONE shop's OFFLINE access token (persisted in
 * the Session table). This is how connector tools reach the store's data.
 */
export async function adminForShop(shop: string): Promise<ShopifyAdminClient> {
  const session = await prisma.session.findFirst({
    where: { shop, isOnline: false },
    orderBy: { expires: "desc" },
  });
  if (!session?.accessToken) {
    throw new Error(`no offline token for ${shop} — reinstall required`);
  }
  // The token is stored encrypted at rest (app/lib/fieldCipher.ts); decrypt for use.
  // Legacy plaintext rows pass through unchanged.
  const accessToken = decryptField(session.accessToken);
  const endpoint = `https://${shop}/admin/api/${API_VERSION}/graphql.json`;
  return {
    shop,
    async graphql(query, variables) {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-shopify-access-token": accessToken,
        },
        body: JSON.stringify({ query, variables: variables ?? {} }),
      });
      if (!res.ok) throw new Error(`Shopify Admin ${res.status}`);
      const json = (await res.json()) as { data?: unknown; errors?: unknown };
      if (json.errors) throw new Error(`Shopify Admin GraphQL errors: ${JSON.stringify(json.errors)}`);
      return json.data;
    },
  };
}
