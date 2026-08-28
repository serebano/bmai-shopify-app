/**
 * Billing gate — Shopify Billing API ONLY (the App Store forbids an external
 * checkout for app charges). We use **Managed Pricing**: the plans live in the
 * Partner Dashboard and merchants pick one on Shopify's hosted pricing page, so
 * the app never renders its own charge UI — it only reads subscription status and
 * REDIRECTS to the managed pricing page when there is no active plan.
 *
 * THE INVARIANT (Built-for-Shopify + owner rule): the storefront widget is NEVER
 * disabled — not when there is no plan, not at the spend cap. `widgetEnabled()` is
 * unconditionally true. The gate only decides whether to nudge the MERCHANT to a
 * plan in the embedded admin; it never gates the customer-facing assistant.
 *
 * Pure + dependency-free so it is unit-testable without a live shop or plan.
 *
 */
export type SubscriptionStatus =
  | "active"
  | "pending"
  | "inactive"
  | "cancelled"
  | "frozen";

export interface BillingAccess {
  /** May the merchant use paid/admin features? (Always true for the widget.) */
  allowed: boolean;
  /** Should the embedded admin nudge the merchant to pick a plan? */
  mustSubscribe: boolean;
  /** The managed-pricing page to redirect to when mustSubscribe, else null. */
  redirectTo: string | null;
  reason: string;
}

/** Build the Shopify Managed Pricing page URL for a shop + app handle. */
export function managedPricingUrl(shop: string, appHandle: string): string {
  // <name>.myshopify.com → the admin store slug is <name>.
  const store = shop.replace(/\.myshopify\.com$/i, "");
  return `https://admin.shopify.com/store/${store}/charges/${appHandle}/pricing_plans`;
}

/**
 * Resolve billing access from a subscription status. A `frozen` sub (the merchant
 * hit their own hard cap or a payment issue) still leaves the widget ON but nudges
 * the merchant to resolve billing.
 */
export function resolveBillingAccess(input: {
  status?: SubscriptionStatus | string | null;
  shop: string;
  appHandle: string;
}): BillingAccess {
  const status = (input.status ?? "inactive") as SubscriptionStatus;
  const url = managedPricingUrl(input.shop, input.appHandle);
  switch (status) {
    case "active":
      return { allowed: true, mustSubscribe: false, redirectTo: null, reason: "active subscription" };
    case "pending":
      return { allowed: true, mustSubscribe: false, redirectTo: null, reason: "subscription pending approval" };
    case "frozen":
      return { allowed: true, mustSubscribe: true, redirectTo: url, reason: "billing frozen — resolve to keep charging" };
    default:
      return { allowed: true, mustSubscribe: true, redirectTo: url, reason: "no active subscription" };
  }
}

/**
 * The customer-facing widget is NEVER disabled by billing — not at the cap, not
 * without a plan. This is a hard product invariant; a regression here is a bug.
 */
export function widgetEnabled(): true {
  return true;
}
