import prisma from "../db.server";
import type { SubscriptionState } from "./billingSync";

/**
 * Persist a resolved subscription state onto the shop's BillingState row so
 * `resolveBillingAccess()` (loader) reflects reality. Idempotent upsert keyed by
 * shop. Skips when there is no ShopTenant yet (BillingState FKs to it) — a
 * subscription event without an install is unexpected and nothing to attach to.
 */
export async function syncBillingState(shop: string, state: SubscriptionState): Promise<boolean> {
  const tenant = await prisma.shopTenant.findUnique({ where: { shop }, select: { shop: true } });
  if (!tenant) return false;
  const data: { status: string; subscriptionId?: string; plan?: string } = { status: state.status };
  if (state.subscriptionId) data.subscriptionId = state.subscriptionId;
  if (state.plan) data.plan = state.plan;
  await prisma.billingState.upsert({
    where: { shop },
    create: { shop, ...data },
    update: data,
  });
  return true;
}
