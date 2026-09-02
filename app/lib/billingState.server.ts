import prisma from "../db.server";
import type { SubscriptionState } from "./billingSync";

/**
 * Persist a resolved subscription state onto the shop's BillingState row so
 * `resolveBillingAccess()` (loader) reflects reality. Idempotent upsert keyed by
 * shop. Skips when there is no ShopTenant yet (BillingState FKs to it) — a
 * subscription event without an install is unexpected and nothing to attach to.
 *
 * A `null` plan is written as "free" only when the state says there is NO
 * contract (`inactive`/`cancelled`) — a pending/active state without a matched
 * plan keeps the previously stored plan (never silently downgrades a paid plan
 * because a handle failed to match).
 */
export async function syncBillingState(shop: string, state: SubscriptionState): Promise<boolean> {
  const tenant = await prisma.shopTenant.findUnique({ where: { shop }, select: { shop: true } });
  if (!tenant) return false;
  const data: { status: string; subscriptionId?: string | null; plan?: string } = { status: state.status };
  if (state.subscriptionId) data.subscriptionId = state.subscriptionId;
  if (state.plan) data.plan = state.plan;
  else if (state.status === "inactive" || state.status === "cancelled") {
    data.plan = "free";
    data.subscriptionId = null;
  }
  await prisma.billingState.upsert({
    where: { shop },
    create: { shop, ...data },
    update: data,
  });
  return true;
}

/** The stored billing state for a shop (or null before any sync). */
export async function readBillingState(shop: string) {
  return prisma.billingState.findUnique({ where: { shop } });
}
