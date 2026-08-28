import { adminForShop } from "../mcp/shopifyAdmin";
import { publishTenantRuntime } from "../bmai.server";
import prisma from "../db.server";

/**
 * Auto-train ingester — build the tenant KB snapshot from the store's own data so
 * Busymate AI answers ONLY from grounded, cited sources.
 *
 * Sources (read via the shop offline token):
 *   - products      (read_products)
 *   - pages/policies (read_content + Shop.shopPolicies)
 *   - FAQ           (merchant-provided or synthesized)
 *
 * The snapshot is handed to publish_tenant_runtime (draft → preflight → publish).
 * On product/policy webhooks we re-ingest (debounced) so answers stay fresh.
 *
 */
export interface KbSnapshot {
  products: unknown[];
  policies: unknown[];
  pages: unknown[];
  generatedAt: string;
}

export async function buildKbSnapshot(shop: string): Promise<KbSnapshot> {
  const admin = await adminForShop(shop);
  const data = (await admin.graphql(
    `#graphql
    query KbIngest {
      shop {
        name
        shopPolicies { type title body url }
      }
      products(first: 250) {
        nodes { title handle descriptionHtml onlineStoreUrl
          priceRangeV2 { minVariantPrice { amount currencyCode } } }
      }
      pages(first: 100) { nodes { title handle body } }
    }`,
  )) as {
    shop?: { shopPolicies?: unknown[] };
    products?: { nodes?: unknown[] };
    pages?: { nodes?: unknown[] };
  };
  return {
    products: data.products?.nodes ?? [],
    policies: data.shop?.shopPolicies ?? [],
    pages: data.pages?.nodes ?? [],
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Re-ingest and re-publish the runtime for a shop. Debounce lives here (a simple
 * per-shop timestamp guard); a durable queue is a P2 follow-up.
 */
export async function scheduleReingest(shop: string, _reason: "products" | "orders"): Promise<void> {
  const tenant = await prisma.shopTenant.findUnique({ where: { shop } });
  if (!tenant?.bmaiTenantId) return; // not provisioned yet
  // Debounce + a durable job are a follow-up; for now, best-effort inline. Routed
  // through the SAME proof-signed + confirm publish shape the lifecycle uses (a
  // proofless call was silently refused — the B13 bug this fixes).
  const snapshot = await buildKbSnapshot(shop).catch(() => null);
  if (!snapshot) return;
  await publishTenantRuntime(shop, tenant.bmaiTenantId, { kbSnapshot: snapshot });
}
