import prisma from "../db.server";
import { adminForShop } from "../mcp/shopifyAdmin";
import { callMcpTool } from "../bmai.server";
import { PLANS, computeBillableUnits, planFor, type Plan } from "./plans";
import { parseMeterCursor, serializeMeterCursor } from "./meterCursor";
import { createAppEventsClient, usageIdempotencyKey } from "./appEvents";
import { appGidFromEnv, fetchActiveSubscription } from "./partnerApi";

export { PLANS, planFor };
export type { Plan };

/**
 * Two ledgers, never conflated:
 *   - Shopify App Pricing (merchant-facing: plan fee + metered overage) — this file.
 *   - Busymate AI usage_events (internal cost/margin truth) — read via MCP.
 *
 * A "resolution" = a positive-outcome, non-double-billed conversation signal. We
 * read the tenant's new resolutions since `cursor`, count them against the
 * plan's INCLUDED allowance for the current billing cycle, and report only the
 * billable overage — clamped to the plan's monthly cap — as ONE App Events
 * billing event (`ai_resolution`, value = units). App Pricing has no usage-cap
 * concept, so the cap is enforced here by not reporting beyond it. The cursor
 * (+ cycle counter) advances idempotently only once the batch is accounted for.
 *
 * The cap is a ceiling on CHARGES, never on the assistant — the widget is NEVER
 * disabled (`widgetEnabled()` is unconditional).
 *
 * TRIGGERS: `POST /api/billing/meter` (secret-gated, for a systemd timer — see
 * app/routes/api.billing.meter.tsx) and opportunistically the Billing page load.
 */
export interface MeterDeps {
  /** Stored billing state for the shop (status + plan drive whether we report). */
  getBilling: (shop: string) => Promise<{ status: string; plan: string; lastMeteredCursor: string | null } | null>;
  /** The Busymate AI tenant id for the shop, or null (not provisioned). */
  getTenantId: (shop: string) => Promise<string | null>;
  /** New resolutions since the cursor (Busymate AI MCP read — no backdoor), or null when unreadable. */
  readResolutions: (tenantId: string, cursor: string | null) => Promise<{ resolutions: number; cursor: string } | null>;
  /** The live billing cycle (Partner API) + the shop GID; null when there is no active cycle (trial / unreachable). */
  readBillingCycle: (shop: string) => Promise<{ key: string; shopId: string } | null>;
  /** Report billable units as an App Events billing event. */
  reportUsage: (input: { shop: string; shopId: string; units: number; idempotencyKey: string }) => Promise<{ ok: boolean; error?: string }>;
  /** Persist the advanced (idempotent) serialized cursor. */
  saveCursor: (shop: string, raw: string) => Promise<void>;
}

export interface MeterOutcome {
  /** New resolutions counted in this run. */
  metered: number;
  /** Billable units reported to Shopify in this run. */
  reportedUnits: number;
  capped: boolean;
  cursor: string | null;
  error?: string;
}

const noop = (cursor: string | null, extra: Partial<MeterOutcome> = {}): MeterOutcome => ({
  metered: 0,
  reportedUnits: 0,
  capped: false,
  cursor,
  ...extra,
});

/**
 * Meter one batch for a shop. Idempotent on the stored cursor. Reports only for
 * an ACTIVE paid plan; a Free plan / no subscription counts nothing to Shopify.
 * Holds the cursor on any failure so no resolution is lost or double-billed.
 */
export async function meterShop(shop: string, deps: MeterDeps = liveMeterDeps()): Promise<MeterOutcome> {
  const billing = await deps.getBilling(shop);
  const state = parseMeterCursor(billing?.lastMeteredCursor);
  if (!billing || billing.status !== "active") return noop(state.cursor);
  const tenantId = await deps.getTenantId(shop);
  if (!tenantId) return noop(state.cursor);

  const usage = await deps.readResolutions(tenantId, state.cursor);
  if (!usage) return noop(state.cursor, { error: "resolutions unreadable" });
  const resolutions = Math.max(0, Math.floor(usage.resolutions ?? 0));
  const plan = planFor(billing.plan);

  if (resolutions === 0) {
    await deps.saveCursor(shop, serializeMeterCursor({ ...state, cursor: usage.cursor }));
    return noop(usage.cursor);
  }

  // Free (no overage) — count for the merchant's dashboard, report nothing.
  if (plan.overageCents === null) {
    await deps.saveCursor(shop, serializeMeterCursor({ cursor: usage.cursor, cycleKey: state.cycleKey, cycleResolutions: state.cycleResolutions + resolutions }));
    return { metered: resolutions, reportedUnits: 0, capped: false, cursor: usage.cursor };
  }

  const cycle = await deps.readBillingCycle(shop);
  if (!cycle) {
    // No active billing cycle (trial, or the Partner API could not be read):
    // hold everything — never report blind, never lose the resolutions.
    return { metered: resolutions, reportedUnits: 0, capped: false, cursor: state.cursor, error: "no active billing cycle — held" };
  }
  const cycleResolutions = state.cycleKey === cycle.key ? state.cycleResolutions : 0;
  const { units, capped } = computeBillableUnits({ plan, cycleResolutions, newResolutions: resolutions });

  if (units > 0) {
    const rec = await deps.reportUsage({ shop, shopId: cycle.shopId, units, idempotencyKey: usageIdempotencyKey(shop, usage.cursor) });
    if (!rec.ok) {
      // Transient failure — hold the cursor so the batch is retried, not lost.
      return { metered: resolutions, reportedUnits: 0, capped, cursor: state.cursor, error: rec.error };
    }
  }
  await deps.saveCursor(shop, serializeMeterCursor({ cursor: usage.cursor, cycleKey: cycle.key, cycleResolutions: cycleResolutions + resolutions }));
  return { metered: resolutions, reportedUnits: units, capped, cursor: usage.cursor };
}

/** Live production deps: Prisma + Busymate AI MCP + Partner API + App Events. */
export function liveMeterDeps(): MeterDeps {
  const events = createAppEventsClient();
  return {
    getBilling: async (shop) => {
      const b = await prisma.billingState.findUnique({ where: { shop } });
      return b ? { status: b.status, plan: b.plan, lastMeteredCursor: b.lastMeteredCursor } : null;
    },
    getTenantId: async (shop) => {
      const t = await prisma.shopTenant.findUnique({ where: { shop }, select: { bmaiTenantId: true } });
      return t?.bmaiTenantId ?? null;
    },
    readResolutions: async (tenantId, _cursor) => {
      // Resolution counts are a Busymate AI MCP read (never a backdoor). The
      // partner rollup tool takes tenant_id; a cursor/metric-aware arm is a
      // platform follow-up — until it lands, a missing count reads as null (held).
      const r = await callMcpTool<{ resolutions?: number; cursor?: string }>("get_tenant_usage", { tenant_id: tenantId });
      if (!r.ok || !r.data || typeof r.data.resolutions !== "number" || !r.data.cursor) return null;
      return { resolutions: r.data.resolutions, cursor: String(r.data.cursor) };
    },
    readBillingCycle: async (shop) => {
      const appGid = appGidFromEnv();
      if (!appGid) return null;
      const admin = await adminForShop(shop);
      const data = (await admin.graphql(`#graphql
        query ShopId { shop { id } }`)) as { shop?: { id?: string } };
      const shopId = data.shop?.id;
      if (!shopId) return null;
      const sub = await fetchActiveSubscription({ appGid, shopGid: shopId });
      if (!sub.ok || !sub.subscription?.currentBillingCycle) return null;
      return { key: sub.subscription.currentBillingCycle.startTime, shopId };
    },
    reportUsage: async ({ shopId, units, idempotencyKey }) =>
      events.reportUsage({ shopId, units, idempotencyKey, timestamp: new Date().toISOString() }),
    saveCursor: async (shop, raw) => {
      await prisma.billingState.update({ where: { shop }, data: { lastMeteredCursor: raw } });
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
