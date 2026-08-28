import type { SubscriptionStatus } from "./billingGate";
import { PLANS } from "./usageBilling";

/**
 * Map a Shopify `AppSubscription.status` (webhook or GraphQL) onto the app's
 * `SubscriptionStatus`, so `resolveBillingAccess()` reflects a REAL subscription
 * (accept / decline / reinstall-re-request all converge here). Shopify's enum:
 * ACTIVE · PENDING · ACCEPTED · DECLINED · EXPIRED · FROZEN · CANCELLED. Anything
 * unknown fails safe to `inactive` (→ nudge the merchant to a plan; widget stays on).
 */
export function normalizeSubscriptionStatus(raw: string | null | undefined): SubscriptionStatus {
  switch (String(raw ?? "").toUpperCase()) {
    case "ACTIVE":
      return "active";
    case "PENDING":
    case "ACCEPTED":
      return "pending";
    case "FROZEN":
      return "frozen";
    case "CANCELLED":
    case "CANCELED":
      return "cancelled";
    case "DECLINED":
    case "EXPIRED":
    default:
      return "inactive";
  }
}

/** Match a Shopify plan/subscription name to one of our plan ids, or null. */
export function matchPlanId(name: string | null | undefined): string | null {
  const n = String(name ?? "").trim().toLowerCase();
  if (!n) return null;
  const byId = PLANS.find((p) => p.id === n);
  if (byId) return byId.id;
  const byName = PLANS.find((p) => p.name.toLowerCase() === n);
  return byName ? byName.id : null;
}

export interface SubscriptionState {
  status: SubscriptionStatus;
  subscriptionId: string | null;
  plan: string | null;
}

interface WebhookSubscription {
  admin_graphql_api_id?: string;
  name?: string;
  status?: string;
}

/** Extract the billing state from an `app_subscriptions/update` webhook payload. */
export function subscriptionStateFromWebhook(payload: unknown): SubscriptionState {
  const sub = ((payload as { app_subscription?: WebhookSubscription })?.app_subscription ?? {}) as WebhookSubscription;
  return {
    status: normalizeSubscriptionStatus(sub.status),
    subscriptionId: sub.admin_graphql_api_id ?? null,
    plan: matchPlanId(sub.name),
  };
}

interface InstallationSubscription {
  id?: string;
  name?: string;
  status?: string;
}

/**
 * Extract the billing state from a `currentAppInstallation.activeSubscriptions`
 * query. Prefers an ACTIVE row; falls back to the first (e.g. PENDING); no
 * subscriptions ⇒ `inactive` (Shopify only returns active/pending here).
 */
export function subscriptionStateFromInstallation(data: unknown): SubscriptionState {
  const subs =
    ((data as { currentAppInstallation?: { activeSubscriptions?: InstallationSubscription[] } })
      ?.currentAppInstallation?.activeSubscriptions ?? []) as InstallationSubscription[];
  const active = subs.find((s) => String(s.status).toUpperCase() === "ACTIVE") ?? subs[0] ?? null;
  if (!active) return { status: "inactive", subscriptionId: null, plan: null };
  return {
    status: normalizeSubscriptionStatus(active.status),
    subscriptionId: active.id ?? null,
    plan: matchPlanId(active.name),
  };
}
