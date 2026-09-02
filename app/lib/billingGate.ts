/**
 * Billing gate — Shopify App Pricing ONLY (the App Store forbids off-platform
 * billing for app charges). The plans live in the Partner Dashboard and the
 * merchant picks one on Shopify's hosted plan-selection page
 * (`/store/<store>/charges/<handle>/pricing_plans`); the app never renders its
 * own charge UI — it reads the contract state (Partner API) and links there.
 *
 * FREE IS A PLAN: no contract ⇒ the merchant is on the Free plan. That is an
 * INFO notice ("change plan any time"), NOT a permanent warning — a merchant
 * (or a reviewer) who never picks a paid plan must not be nagged.
 *
 * THE INVARIANT (Built-for-Shopify + owner rule): the storefront widget is NEVER
 * disabled — not on Free, not at the cap, not when frozen. `widgetEnabled()` is
 * unconditionally true. The gate only decides what notice the MERCHANT sees in
 * the embedded admin.
 *
 * Pure + dependency-free so it is unit-testable without a live shop or plan.
 */
import { FREE_PLAN_ID, planByHandle, type PlanId } from "./plans";

export type SubscriptionStatus = "active" | "pending" | "inactive" | "cancelled" | "frozen";

export type BillingTone = "none" | "info" | "warning";

export interface BillingAccess {
  /** May the merchant use the app? (Always true — the widget is never gated.) */
  allowed: boolean;
  /** Should the admin WARN the merchant to resolve billing (frozen only)? */
  mustSubscribe: boolean;
  /** The plan-selection page (where "Choose/Manage plan" navigates top-level). */
  redirectTo: string;
  /** The effective plan (Free when there is no contract). */
  planId: PlanId;
  tone: BillingTone;
  reason: string;
}

/** Build the Shopify App Pricing plan-selection URL for a shop + app handle. */
export function managedPricingUrl(shop: string, appHandle: string): string {
  // <name>.myshopify.com → the admin store slug is <name>.
  const store = shop.replace(/\.myshopify\.com$/i, "");
  return `https://admin.shopify.com/store/${store}/charges/${appHandle}/pricing_plans`;
}

/**
 * Resolve the merchant-facing billing notice from the stored subscription state.
 *   inactive / cancelled / unknown ⇒ Free (info)
 *   pending                       ⇒ the chosen plan, info (confirming with Shopify)
 *   active                        ⇒ the plan; Free handle ⇒ info, paid ⇒ no notice
 *   frozen                        ⇒ warning — resolve billing (widget still on)
 */
export function resolveBillingAccess(input: {
  status?: SubscriptionStatus | string | null;
  plan?: string | null;
  shop: string;
  appHandle: string;
}): BillingAccess {
  const status = String(input.status ?? "inactive") as SubscriptionStatus;
  const url = managedPricingUrl(input.shop, input.appHandle);
  const matched = planByHandle(input.plan)?.id ?? null;
  const base = { allowed: true as const, redirectTo: url };
  switch (status) {
    case "active": {
      const planId = matched ?? FREE_PLAN_ID;
      return planId === FREE_PLAN_ID
        ? { ...base, mustSubscribe: false, planId, tone: "info", reason: "Free plan" }
        : { ...base, mustSubscribe: false, planId, tone: "none", reason: "active subscription" };
    }
    case "pending":
      return { ...base, mustSubscribe: false, planId: matched ?? FREE_PLAN_ID, tone: "info", reason: "plan selection pending confirmation" };
    case "frozen":
      return { ...base, mustSubscribe: true, planId: matched ?? FREE_PLAN_ID, tone: "warning", reason: "billing frozen — resolve to keep your plan" };
    default:
      return { ...base, mustSubscribe: false, planId: FREE_PLAN_ID, tone: "info", reason: "no subscription — Free plan" };
  }
}

/**
 * The customer-facing widget is NEVER disabled by billing — not at the cap, not
 * without a plan. This is a hard product invariant; a regression here is a bug.
 */
export function widgetEnabled(): true {
  return true;
}
