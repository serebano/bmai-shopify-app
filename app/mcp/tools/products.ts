import type { ToolContext, ToolResult } from "./types";
import { textResult } from "./types";

// Public catalog reads. Real impl: Admin GraphQL `products(query:)` with the shop
// offline token. Stub returns a typed shape so Busymate AI's contract is exercised now.
export async function searchProducts(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const query = String(args.query ?? "");
  const first = Number(args.first ?? 10);
  const data = await ctx.admin.graphql(
    `#graphql
    query SearchProducts($q: String!, $n: Int!) {
      products(query: $q, first: $n) {
        nodes { id title handle status featuredImage { url }
          priceRangeV2 { minVariantPrice { amount currencyCode } }
          totalInventory }
      }
    }`,
    { q: query, n: first },
  );
  return textResult(
    `search_products(${query}) — TODO(P2): map GraphQL nodes to concise results.`,
    data,
  );
}

export async function getProduct(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const handle = String(args.handle ?? "");
  const data = await ctx.admin.graphql(
    `#graphql
    query GetProduct($handle: String!) {
      productByHandle(handle: $handle) {
        id title descriptionHtml status
        variants(first: 50) { nodes { id title price availableForSale inventoryQuantity } }
      }
    }`,
    { handle },
  );
  return textResult(`get_product(${handle}) — TODO(P2).`, data);
}

export async function listCollections(
  _args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const data = await ctx.admin.graphql(
    `#graphql
    query Collections($n: Int!) { collections(first: $n) { nodes { id title handle } } }`,
    { n: Number(_args.first ?? 25) },
  );
  return textResult("list_collections — TODO(P2).", data);
}
