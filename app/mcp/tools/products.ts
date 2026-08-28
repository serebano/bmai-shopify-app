import type { ToolContext, ToolResult } from "./types";
import { textResult } from "./types";

/**
 * Public catalog reads — Admin GraphQL (2026-07) with the shop offline token. No
 * store PII, so these are the `public` tier (anonymous callers). Each maps the raw
 * GraphQL nodes to a concise, grounded shape Busymate AI can cite verbatim.
 */

interface Money {
  amount: string;
  currencyCode: string;
}

function money(m?: Money | null): string | null {
  if (!m) return null;
  return `${m.amount} ${m.currencyCode}`;
}

/** Collapse HTML/whitespace to a short plain-text blurb (grounded, no markup). */
function plain(html: string | null | undefined, max = 280): string {
  const text = String(html ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

interface ProductNode {
  id: string;
  title: string;
  handle: string;
  status: string;
  featuredImage?: { url: string } | null;
  onlineStoreUrl?: string | null;
  totalInventory?: number | null;
  priceRangeV2?: { minVariantPrice?: Money; maxVariantPrice?: Money } | null;
}

export interface ProductSummary {
  title: string;
  handle: string;
  url: string | null;
  price: string | null;
  available: boolean;
  image: string | null;
}

function summarizeProduct(n: ProductNode): ProductSummary {
  return {
    title: n.title,
    handle: n.handle,
    url: n.onlineStoreUrl ?? null,
    price: money(n.priceRangeV2?.minVariantPrice),
    available: (n.totalInventory ?? 0) > 0 && n.status === "ACTIVE",
    image: n.featuredImage?.url ?? null,
  };
}

export async function searchProducts(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const query = String(args.query ?? "").trim();
  const first = Math.max(1, Math.min(Number(args.first ?? 10) || 10, 25));
  const data = (await ctx.admin.graphql(
    `#graphql
    query SearchProducts($q: String!, $n: Int!) {
      products(query: $q, first: $n) {
        nodes {
          id title handle status onlineStoreUrl totalInventory
          featuredImage { url }
          priceRangeV2 { minVariantPrice { amount currencyCode } }
        }
      }
    }`,
    { q: `status:active ${query}`.trim(), n: first },
  )) as { products?: { nodes?: ProductNode[] } };

  const products = (data.products?.nodes ?? []).map(summarizeProduct);
  if (products.length === 0) {
    return textResult(`No products match “${query}”.`, { query, products: [] });
  }
  const lines = products.map(
    (p) => `• ${p.title}${p.price ? ` — ${p.price}` : ""}${p.available ? "" : " (out of stock)"}`,
  );
  return textResult(
    `${products.length} product${products.length === 1 ? "" : "s"} matching “${query}”:\n${lines.join("\n")}`,
    { query, products },
  );
}

interface VariantNode {
  id: string;
  title: string;
  price: string;
  availableForSale: boolean;
  inventoryQuantity?: number | null;
  sku?: string | null;
}

export async function getProduct(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const handle = String(args.handle ?? "").trim();
  const data = (await ctx.admin.graphql(
    `#graphql
    query GetProduct($handle: String!) {
      productByHandle(handle: $handle) {
        id title descriptionHtml status handle onlineStoreUrl
        priceRangeV2 { minVariantPrice { amount currencyCode } maxVariantPrice { amount currencyCode } }
        variants(first: 50) { nodes { id title price availableForSale inventoryQuantity sku } }
      }
    }`,
    { handle },
  )) as {
    productByHandle?: {
      id: string;
      title: string;
      descriptionHtml?: string | null;
      status: string;
      handle: string;
      onlineStoreUrl?: string | null;
      priceRangeV2?: { minVariantPrice?: Money; maxVariantPrice?: Money } | null;
      variants?: { nodes?: VariantNode[] };
    } | null;
  };

  const p = data.productByHandle;
  if (!p) return textResult(`No product found for “${handle}”.`, { handle, product: null });

  const variants = (p.variants?.nodes ?? []).map((v) => ({
    title: v.title,
    price: v.price,
    available: v.availableForSale,
    quantity: v.inventoryQuantity ?? null,
    sku: v.sku ?? null,
  }));
  const product = {
    title: p.title,
    handle: p.handle,
    url: p.onlineStoreUrl ?? null,
    description: plain(p.descriptionHtml),
    priceFrom: money(p.priceRangeV2?.minVariantPrice),
    available: variants.some((v) => v.available),
    variants,
  };
  return textResult(
    `${product.title}${product.priceFrom ? ` — from ${product.priceFrom}` : ""}. ${product.description}`,
    { product },
  );
}

export async function listCollections(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const first = Math.max(1, Math.min(Number(args.first ?? 25) || 25, 50));
  const data = (await ctx.admin.graphql(
    `#graphql
    query Collections($n: Int!) {
      collections(first: $n, sortKey: TITLE) {
        nodes { id title handle productsCount { count } }
      }
    }`,
    { n: first },
  )) as {
    collections?: { nodes?: Array<{ title: string; handle: string; productsCount?: { count?: number } | null }> };
  };

  const collections = (data.collections?.nodes ?? []).map((c) => ({
    title: c.title,
    handle: c.handle,
    productCount: c.productsCount?.count ?? null,
  }));
  const lines = collections.map((c) => `• ${c.title}${c.productCount != null ? ` (${c.productCount})` : ""}`);
  return textResult(
    collections.length ? `${collections.length} collections:\n${lines.join("\n")}` : "No collections.",
    { collections },
  );
}
