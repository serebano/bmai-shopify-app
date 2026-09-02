/**
 * Shopify Partner API — the plan-state SOURCE under Shopify App Pricing.
 *
 * App Pricing sends NO billing webhooks and `currentAppInstallation.
 * activeSubscriptions` reflects only legacy Billing-API subscriptions, so the
 * canonical "what is this merchant subscribed to right now?" is the Partner API
 * `activeSubscription(appId:, shopId:)` query (Active Subscription API):
 * https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing#query-subscription-data
 * https://shopify.dev/docs/api/partner/active-subscription
 *
 * AUTH (value-blind, fail-closed): the Partner API authenticates with a Partner
 * API client access token in `X-Shopify-Access-Token` (Partner Dashboard →
 * Settings → Partner API clients, "Manage apps" permission). Two env shapes:
 *   • PARTNER_API_ACCESS_TOKEN                          — a client access token, used as is
 *   • PARTNER_API_CLIENT_ID + PARTNER_API_CLIENT_SECRET — exchanged (client_credentials)
 *     at https://api.shopify.com/auth/access_token for a 60-min token, cached
 * plus PARTNER_ORG_ID (the numeric organization id in the Partner Dashboard URL).
 * Nothing here logs or returns a credential; a missing/empty one ⇒ ok:false.
 */
import { planByHandle } from "./plans";
import type { SubscriptionState } from "./billingSync";

export const PARTNER_API_VERSION = "2026-07";
export const PARTNER_ORG_ID_ENV = "PARTNER_ORG_ID";
export const PARTNER_API_ACCESS_TOKEN_ENV = "PARTNER_API_ACCESS_TOKEN";
export const PARTNER_API_CLIENT_ID_ENV = "PARTNER_API_CLIENT_ID";
export const PARTNER_API_CLIENT_SECRET_ENV = "PARTNER_API_CLIENT_SECRET";
export const PARTNER_TOKEN_URL = "https://api.shopify.com/auth/access_token";

export interface PartnerApiConfig {
  orgId: string;
  version: string;
  clientId?: string;
  accessToken?: string;
  /** Non-enumerable: the client secret never serializes. */
  readonly secret?: () => string;
}

/** Read the Partner credential from env by NAME. Null when the org id or credential is absent/EMPTY. */
export function readPartnerApiConfig(env: NodeJS.ProcessEnv = process.env): PartnerApiConfig | null {
  const orgId = (env[PARTNER_ORG_ID_ENV] ?? "").trim();
  if (!orgId) return null;
  const accessToken = (env[PARTNER_API_ACCESS_TOKEN_ENV] ?? "").trim();
  const clientId = (env[PARTNER_API_CLIENT_ID_ENV] ?? "").trim();
  const secret = (env[PARTNER_API_CLIENT_SECRET_ENV] ?? "").trim();
  const version = (env.PARTNER_API_VERSION ?? "").trim() || PARTNER_API_VERSION;
  if (accessToken) return { orgId, version, accessToken };
  if (clientId && secret) {
    const cfg = { orgId, version, clientId } as PartnerApiConfig;
    Object.defineProperty(cfg, "secret", { value: () => secret, enumerable: false });
    return cfg;
  }
  return null;
}

export function partnerApiEndpoint(orgId: string, version = PARTNER_API_VERSION): string {
  return `https://partners.shopify.com/${orgId}/api/${version}/graphql.json`;
}

/** `gid://shopify/App/<id>` from SHOPIFY_APP_GID (verbatim) or SHOPIFY_APP_ID (numeric). */
export function appGidFromEnv(env: NodeJS.ProcessEnv = process.env): string | null {
  const gid = (env.SHOPIFY_APP_GID ?? "").trim();
  if (gid) return gid;
  const id = (env.SHOPIFY_APP_ID ?? "").trim();
  return /^\d+$/.test(id) ? `gid://shopify/App/${id}` : null;
}

// ---- Active Subscription shape (the fields we query) -------------------------

export interface FlatRatePrice {
  __typename: "FlatRatePrice";
  active: boolean;
  currency: string;
  amount: string;
}
export interface TieredPrice {
  __typename: "TieredPrice";
  active: boolean;
  currency: string;
  tiersMode: "VOLUME" | "GRADUATED";
  tiers: Array<{ upTo: number | null; amountPerUnit: string | null; amount: string | null }>;
}
export interface SubscriptionItem {
  handle: string;
  description: string | null;
  price: FlatRatePrice | TieredPrice;
  usage: { quantity: number; cost: { amount: string; currencyCode: string } } | null;
}
export interface ActiveSubscription {
  billingPeriod: string;
  cancelAtEndOfCycle: boolean;
  trialEndsAt: string | null;
  currentBillingCycle: { startTime: string; endTime: string } | null;
  items: SubscriptionItem[];
  pendingUpdate: { billingPeriod?: string; items?: Array<{ handle: string }> } | null;
  legacySubscriptionId: string | null;
}

export const ACTIVE_SUBSCRIPTION_QUERY = `#graphql
query ActiveSubscription($appId: ID!, $shopId: ID!) {
  activeSubscription(appId: $appId, shopId: $shopId) {
    billingPeriod
    cancelAtEndOfCycle
    trialEndsAt
    currentBillingCycle { startTime endTime }
    items {
      handle
      description
      price {
        __typename
        active
        currency
        ... on FlatRatePrice { amount }
        ... on TieredPrice { tiersMode tiers { upTo amountPerUnit amount } }
      }
      usage { quantity cost { amount currencyCode } }
    }
    pendingUpdate { billingPeriod items { handle } }
    legacySubscriptionId
  }
}`;

export type ActiveSubscriptionResult =
  | { ok: true; subscription: ActiveSubscription | null }
  | { ok: false; error: string };

export interface PartnerApiDeps {
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  now?: () => number;
}

let tokenCache: { key: string; token: string; expiresAt: number } | null = null;

async function partnerToken(cfg: PartnerApiConfig, doFetch: typeof fetch, now: () => number): Promise<string> {
  if (cfg.accessToken) return cfg.accessToken;
  const key = `${cfg.orgId}:${cfg.clientId}`;
  if (tokenCache && tokenCache.key === key && tokenCache.expiresAt > now()) return tokenCache.token;
  const res = await doFetch(PARTNER_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: cfg.clientId, client_secret: cfg.secret?.(), grant_type: "client_credentials" }),
  });
  if (!res.ok) throw new Error(`Partner API token ${res.status}`);
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new Error("Partner API token response had no access_token");
  tokenCache = { key, token: json.access_token, expiresAt: now() + Math.max(0, (Number(json.expires_in ?? 3600) - 60) * 1000) };
  return tokenCache.token;
}

/**
 * Query the merchant's live App Pricing contract. `subscription: null` means the
 * shop has no active contract (never chose a plan / Free without a contract /
 * cancelled) — the gate models that as the Free plan. Any inability to check is
 * `ok:false` (UNVERIFIED), never a guessed state.
 */
export async function fetchActiveSubscription(
  input: { appGid: string; shopGid: string },
  deps: PartnerApiDeps = {},
): Promise<ActiveSubscriptionResult> {
  const env = deps.env ?? process.env;
  const doFetch = deps.fetch ?? fetch;
  const now = deps.now ?? (() => Date.now());
  const cfg = readPartnerApiConfig(env);
  if (!cfg) {
    return {
      ok: false,
      error: `Partner API not configured (${PARTNER_ORG_ID_ENV} + ${PARTNER_API_ACCESS_TOKEN_ENV} or ${PARTNER_API_CLIENT_ID_ENV}/${PARTNER_API_CLIENT_SECRET_ENV})`,
    };
  }
  try {
    const token = await partnerToken(cfg, doFetch, now);
    const res = await doFetch(partnerApiEndpoint(cfg.orgId, cfg.version), {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({ query: ACTIVE_SUBSCRIPTION_QUERY, variables: { appId: input.appGid, shopId: input.shopGid } }),
    });
    if (!res.ok) return { ok: false, error: `Partner API ${res.status}` };
    const json = (await res.json()) as {
      data?: { activeSubscription?: ActiveSubscription | null };
      errors?: Array<{ message?: string }>;
    };
    if (json.errors?.length) return { ok: false, error: json.errors.map((e) => e.message ?? "error").join("; ") };
    return { ok: true, subscription: json.data?.activeSubscription ?? null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface PartnerSubscriptionState extends SubscriptionState {
  trialEndsAt: string | null;
  cycleStart: string | null;
  cycleEnd: string | null;
  cancelAtEndOfCycle: boolean;
  /** Usage units Shopify has recorded on the plan's meter this cycle (null if none). */
  usageQuantity: number | null;
}

/** Map a live contract (or null) onto the app's subscription state. */
export function subscriptionStateFromPartnerApi(sub: ActiveSubscription | null): PartnerSubscriptionState {
  if (!sub) {
    return { status: "inactive", subscriptionId: null, plan: null, trialEndsAt: null, cycleStart: null, cycleEnd: null, cancelAtEndOfCycle: false, usageQuantity: null };
  }
  const planItem = sub.items.find((i) => planByHandle(i.handle)) ?? null;
  const meter = sub.items.find((i) => i.usage) ?? null;
  return {
    status: "active",
    subscriptionId: sub.legacySubscriptionId ?? null,
    plan: planItem ? planByHandle(planItem.handle)!.id : null,
    trialEndsAt: sub.trialEndsAt ?? null,
    cycleStart: sub.currentBillingCycle?.startTime ?? null,
    cycleEnd: sub.currentBillingCycle?.endTime ?? null,
    cancelAtEndOfCycle: Boolean(sub.cancelAtEndOfCycle),
    usageQuantity: meter?.usage?.quantity ?? null,
  };
}
