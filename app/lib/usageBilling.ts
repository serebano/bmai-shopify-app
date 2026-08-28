import prisma from "../db.server";
import { adminForShop } from "../mcp/shopifyAdmin";
import { callMcpTool } from "../bmai.server";

/**
 * Two ledgers, never conflated:
 *   - Shopify Billing (merchant-facing usage charges, capped) — this file.
 *   - bmai usage_events (internal cost/margin truth) — read via MCP.
 *
 * A "resolution" = a positive-outcome, non-double-billed conversation signal. We
 * read bmai tenant resolutions since `lastMeteredCursor`, map them → a Shopify
 * AppUsageRecord (clamped to the remaining cap headroom), and advance the cursor
 * idempotently. The cap is a ceiling on CHARGES, never on the assistant — the
 * widget is NEVER disabled (`widgetEnabled()` is unconditional).
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

export function planFor(planId: string | null | undefined): Plan {
  return PLANS.find((p) => p.id === planId) ?? PLANS[0];
}

/**
 * The charge (cents) for a batch of resolutions, CLAMPED to the remaining cap
 * headroom. Pure + independently tested. `headroomCents <= 0` ⇒ 0 (cap reached, no
 * charge — the widget still runs).
 */
export function computeUsageCharge(input: {
  resolutions: number;
  perResolutionCents: number;
  headroomCents: number;
}): number {
  const gross = Math.max(0, Math.floor(input.resolutions)) * Math.max(0, input.perResolutionCents);
  return Math.min(gross, Math.max(0, input.headroomCents));
}

/** The active usage line item + its cap headroom (all cents). */
export interface UsageLine {
  lineItemId: string;
  cappedAmountCents: number;
  balanceUsedCents: number;
  currencyCode: string;
}

export interface MeterDeps {
  /** Stored billing state for the shop (status drives whether we charge). */
  getBilling: (shop: string) => Promise<{ status: string; plan: string; lastMeteredCursor: string | null } | null>;
  /** The bmai tenant id for the shop, or null (not provisioned). */
  getTenantId: (shop: string) => Promise<string | null>;
  /** Resolutions since the cursor (bmai MCP read — no backdoor). */
  readResolutions: (tenantId: string, cursor: string | null) => Promise<{ resolutions: number; cursor: string } | null>;
  /** The live usage line item + cap headroom (Admin GraphQL), or null. */
  readUsageLine: (shop: string) => Promise<UsageLine | null>;
  /** Create the AppUsageRecord (Admin GraphQL Billing API). */
  createUsageRecord: (input: {
    shop: string;
    lineItemId: string;
    amountCents: number;
    currencyCode: string;
    description: string;
  }) => Promise<{ ok: boolean; id?: string; error?: string }>;
  /** Persist the advanced (idempotent) cursor. */
  saveCursor: (shop: string, cursor: string) => Promise<void>;
}

export interface MeterOutcome {
  metered: number;
  chargedCents: number;
  capped: boolean;
  cursor: string | null;
  error?: string;
}

/**
 * Meter one billing cycle for a shop. Idempotent on `lastMeteredCursor`. Charges
 * only an ACTIVE subscription; clamps to cap headroom; advances the cursor once the
 * resolutions are accounted for (charged OR capped) and holds it on a transient
 * charge failure so nothing is lost.
 */
export async function meterShop(shop: string, deps: MeterDeps = liveMeterDeps()): Promise<MeterOutcome> {
  const billing = await deps.getBilling(shop);
  const cursor = billing?.lastMeteredCursor ?? null;
  if (!billing || billing.status !== "active") {
    return { metered: 0, chargedCents: 0, capped: false, cursor };
  }
  const tenantId = await deps.getTenantId(shop);
  if (!tenantId) return { metered: 0, chargedCents: 0, capped: false, cursor };

  const usage = await deps.readResolutions(tenantId, cursor);
  if (!usage) return { metered: 0, chargedCents: 0, capped: false, cursor };
  const resolutions = Math.max(0, Math.floor(usage.resolutions ?? 0));
  if (resolutions === 0) {
    await deps.saveCursor(shop, usage.cursor);
    return { metered: 0, chargedCents: 0, capped: false, cursor: usage.cursor };
  }

  const line = await deps.readUsageLine(shop);
  if (!line) {
    // No usage line item to charge against — hold the cursor and retry next cycle.
    return { metered: resolutions, chargedCents: 0, capped: false, cursor, error: "no usage line item" };
  }

  const perResolutionCents = planFor(billing.plan).perResolutionCents;
  const headroomCents = line.cappedAmountCents - line.balanceUsedCents;
  const amountCents = computeUsageCharge({ resolutions, perResolutionCents, headroomCents });

  if (amountCents <= 0) {
    // Cap reached: acknowledge the resolutions (advance cursor), charge nothing.
    await deps.saveCursor(shop, usage.cursor);
    return { metered: resolutions, chargedCents: 0, capped: true, cursor: usage.cursor };
  }

  const rec = await deps.createUsageRecord({
    shop,
    lineItemId: line.lineItemId,
    amountCents,
    currencyCode: line.currencyCode,
    description: `${resolutions} resolved conversation${resolutions === 1 ? "" : "s"} (Busymate AI)`,
  });
  if (!rec.ok) {
    // Transient charge failure — hold the cursor so the resolutions aren't lost.
    return { metered: resolutions, chargedCents: 0, capped: false, cursor, error: rec.error };
  }
  await deps.saveCursor(shop, usage.cursor);
  return {
    metered: resolutions,
    chargedCents: amountCents,
    capped: amountCents < resolutions * perResolutionCents,
    cursor: usage.cursor,
  };
}

/** The USD-decimal string an AppUsageRecord `price.amount` expects. */
function centsToAmount(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** Live production deps: Prisma + the shop Admin client + bmai MCP. */
export function liveMeterDeps(): MeterDeps {
  return {
    getBilling: async (shop) => {
      const b = await prisma.billingState.findUnique({ where: { shop } });
      return b ? { status: b.status, plan: b.plan, lastMeteredCursor: b.lastMeteredCursor } : null;
    },
    getTenantId: async (shop) => {
      const t = await prisma.shopTenant.findUnique({ where: { shop }, select: { bmaiTenantId: true } });
      return t?.bmaiTenantId ?? null;
    },
    readResolutions: async (tenantId, cursor) => {
      const r = await callMcpTool<{ resolutions: number; cursor: string }>("get_tenant_usage", {
        tenant_id: tenantId,
        since_cursor: cursor,
        metric: "resolution",
      });
      return r.ok && r.data ? { resolutions: r.data.resolutions ?? 0, cursor: r.data.cursor } : null;
    },
    readUsageLine: async (shop) => {
      const admin = await adminForShop(shop);
      const data = (await admin.graphql(
        `#graphql
        query UsageLine {
          currentAppInstallation {
            activeSubscriptions {
              id status
              lineItems {
                id
                plan {
                  pricingDetails {
                    __typename
                    ... on AppUsagePricing {
                      cappedAmount { amount currencyCode }
                      balanceUsed { amount currencyCode }
                    }
                  }
                }
              }
            }
          }
        }`,
      )) as {
        currentAppInstallation?: {
          activeSubscriptions?: Array<{
            status: string;
            lineItems?: Array<{
              id: string;
              plan?: {
                pricingDetails?: {
                  __typename?: string;
                  cappedAmount?: { amount: string; currencyCode: string };
                  balanceUsed?: { amount: string; currencyCode: string };
                };
              };
            }>;
          }>;
        };
      };
      const sub = (data.currentAppInstallation?.activeSubscriptions ?? []).find((s) => s.status === "ACTIVE");
      const li = sub?.lineItems?.find((l) => l.plan?.pricingDetails?.__typename === "AppUsagePricing");
      const pd = li?.plan?.pricingDetails;
      if (!li || !pd?.cappedAmount) return null;
      return {
        lineItemId: li.id,
        cappedAmountCents: Math.round(Number(pd.cappedAmount.amount) * 100),
        balanceUsedCents: Math.round(Number(pd.balanceUsed?.amount ?? "0") * 100),
        currencyCode: pd.cappedAmount.currencyCode,
      };
    },
    createUsageRecord: async ({ shop, lineItemId, amountCents, currencyCode, description }) => {
      const admin = await adminForShop(shop);
      const data = (await admin.graphql(
        `#graphql
        mutation CreateUsageRecord($subscriptionLineItemId: ID!, $description: String!, $price: MoneyInput!) {
          appUsageRecordCreate(subscriptionLineItemId: $subscriptionLineItemId, description: $description, price: $price) {
            appUsageRecord { id }
            userErrors { field message }
          }
        }`,
        {
          subscriptionLineItemId: lineItemId,
          description,
          price: { amount: centsToAmount(amountCents), currencyCode },
        },
      )) as {
        appUsageRecordCreate?: {
          appUsageRecord?: { id: string } | null;
          userErrors?: Array<{ message?: string }>;
        };
      };
      const err = data.appUsageRecordCreate?.userErrors?.find((e) => e.message)?.message;
      const id = data.appUsageRecordCreate?.appUsageRecord?.id;
      if (err || !id) return { ok: false, error: err ?? "usage record not created" };
      return { ok: true, id };
    },
    saveCursor: async (shop, cursor) => {
      await prisma.billingState.update({ where: { shop }, data: { lastMeteredCursor: cursor } });
    },
  };
}

/**
 * The customer-facing widget is NEVER disabled by billing — not at the cap, not
 * without a plan. Hard product invariant; a regression here is a bug.
 */
export function widgetEnabled(): true {
  return true;
}

export { centsToAmount };
