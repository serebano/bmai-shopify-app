import prisma from "../db.server";
import { callMcpTool } from "../bmai.server";

/**
 * Two ledgers, never conflated:
 *   - Shopify Billing (merchant-facing usage charges, capped) — this file.
 *   - bmai usage_events (internal cost/margin truth) — read via MCP.
 *
 * A "resolution" = a positive-outcome, non-double-billed conversation signal
 * (precise definition is an owner decision — §8). We read bmai tenant usage since
 * lastMeteredCursor, map resolutions → a Shopify AppUsageRecord (capped), and
 * advance the cursor idempotently. The widget is NEVER disabled at the cap.
 *
 */
export interface Plan {
  id: string;
  name: string;
  blurb: string;
  cappedAmountCents: number;
  perResolutionCents: number;
}

export const PLANS: Plan[] = [
  { id: "starter", name: "Starter", blurb: "$0.50 per resolved conversation · $50/mo cap", cappedAmountCents: 5000, perResolutionCents: 50 },
  { id: "growth", name: "Growth", blurb: "$0.40 per resolution · $250/mo cap", cappedAmountCents: 25000, perResolutionCents: 40 },
  { id: "scale", name: "Scale", blurb: "$0.30 per resolution · $1,000/mo cap", cappedAmountCents: 100000, perResolutionCents: 30 },
];

/**
 * Meter one billing cycle for a shop. Idempotent on lastMeteredCursor.
 * TODO(P3): wire billing.createUsageRecord (react-router billing helpers).
 */
export async function meterShop(shop: string): Promise<{ metered: number; cursor: string | null }> {
  const billing = await prisma.billingState.findUnique({ where: { shop } });
  const tenant = await prisma.shopTenant.findUnique({ where: { shop } });
  if (!tenant?.bmaiTenantId) return { metered: 0, cursor: billing?.lastMeteredCursor ?? null };

  // Read internal resolutions since the cursor (MCP read — no backdoor).
  const usage = await callMcpTool<{ resolutions: number; cursor: string }>("get_tenant_usage", {
    tenant_id: tenant.bmaiTenantId,
    since_cursor: billing?.lastMeteredCursor ?? null,
    metric: "resolution",
  });
  if (!usage.ok || !usage.data) return { metered: 0, cursor: billing?.lastMeteredCursor ?? null };

  const resolutions = usage.data.resolutions ?? 0;
  // TODO(P3): AppUsageRecord create for (resolutions * perResolutionCents),
  // respecting cappedAmount; never disable at cap.
  if (resolutions > 0) {
    await prisma.billingState.update({
      where: { shop },
      data: { lastMeteredCursor: usage.data.cursor },
    });
  }
  return { metered: resolutions, cursor: usage.data.cursor };
}
