import type { ToolContext } from "./types";

/**
 * Customer-scoped order lookup — the ONE place order reads/writes resolve an order
 * from an order number. Every read goes through `customer(id).orders(query:)` so a
 * customer can only ever see (and act on) THEIR OWN orders: the shop-wide
 * `orders(query:)` root is never used on the identified path. A missing customer id
 * or a no-match is `null` (fail-closed — never a store-wide read).
 */

export interface Money {
  amount: string;
  currencyCode: string;
}

export interface TrackingInfo {
  number: string | null;
  url: string | null;
  company: string | null;
}

export interface OrderFulfillment {
  status: string | null;
  deliveredAt: string | null;
  estimatedDeliveryAt: string | null;
  trackingInfo: TrackingInfo[];
}

export interface CustomerOrder {
  id: string;
  name: string;
  processedAt: string | null;
  cancelledAt: string | null;
  displayFulfillmentStatus: string;
  displayFinancialStatus: string;
  totalPrice: Money | null;
  fulfillments: OrderFulfillment[];
  lineItems: Array<{ id: string; title: string; quantity: number }>;
}

interface RawOrder {
  id: string;
  name: string;
  processedAt?: string | null;
  cancelledAt?: string | null;
  displayFulfillmentStatus?: string | null;
  displayFinancialStatus?: string | null;
  totalPriceSet?: { presentmentMoney?: Money } | null;
  fulfillments?: Array<{
    status?: string | null;
    deliveredAt?: string | null;
    estimatedDeliveryAt?: string | null;
    trackingInfo?: TrackingInfo[] | null;
  }> | null;
  lineItems?: { nodes?: Array<{ id: string; title: string; quantity: number }> } | null;
}

/** Normalize a merchant-typed order number to Shopify's `#1001` name form. */
export function normalizeOrderName(input: unknown): string {
  const raw = String(input ?? "").trim();
  if (!raw) return "";
  return raw.startsWith("#") ? raw : `#${raw}`;
}

const CUSTOMER_ORDERS_QUERY = `#graphql
  query CustomerOrders($customerId: ID!, $q: String, $n: Int!) {
    customer(id: $customerId) {
      orders(first: $n, query: $q, sortKey: PROCESSED_AT, reverse: true) {
        nodes {
          id
          name
          processedAt
          cancelledAt
          displayFulfillmentStatus
          displayFinancialStatus
          totalPriceSet { presentmentMoney { amount currencyCode } }
          fulfillments(first: 10) {
            status
            deliveredAt
            estimatedDeliveryAt
            trackingInfo { number url company }
          }
          lineItems(first: 50) { nodes { id title quantity } }
        }
      }
    }
  }`;

function mapOrder(node: RawOrder): CustomerOrder {
  return {
    id: node.id,
    name: node.name,
    processedAt: node.processedAt ?? null,
    cancelledAt: node.cancelledAt ?? null,
    displayFulfillmentStatus: node.displayFulfillmentStatus ?? "UNKNOWN",
    displayFinancialStatus: node.displayFinancialStatus ?? "UNKNOWN",
    totalPrice: node.totalPriceSet?.presentmentMoney ?? null,
    fulfillments: (node.fulfillments ?? []).map((f) => ({
      status: f.status ?? null,
      deliveredAt: f.deliveredAt ?? null,
      estimatedDeliveryAt: f.estimatedDeliveryAt ?? null,
      trackingInfo: f.trackingInfo ?? [],
    })),
    lineItems: node.lineItems?.nodes ?? [],
  };
}

/** Resolve ONE order (by number) belonging to the identified customer, or null. */
export async function findCustomerOrder(
  ctx: ToolContext,
  orderNumber: unknown,
): Promise<CustomerOrder | null> {
  if (!ctx.customerId) return null;
  const name = normalizeOrderName(orderNumber);
  if (!name) return null;
  const data = (await ctx.admin.graphql(CUSTOMER_ORDERS_QUERY, {
    customerId: `gid://shopify/Customer/${ctx.customerId}`,
    q: `name:${name}`,
    n: 1,
  })) as { customer?: { orders?: { nodes?: RawOrder[] } } };
  const node = data.customer?.orders?.nodes?.[0];
  return node ? mapOrder(node) : null;
}

/** List the identified customer's most recent orders (scoped, never store-wide). */
export async function listCustomerOrders(
  ctx: ToolContext,
  first = 5,
): Promise<CustomerOrder[]> {
  if (!ctx.customerId) return [];
  const data = (await ctx.admin.graphql(CUSTOMER_ORDERS_QUERY, {
    customerId: `gid://shopify/Customer/${ctx.customerId}`,
    q: null,
    n: Math.max(1, Math.min(first, 25)),
  })) as { customer?: { orders?: { nodes?: RawOrder[] } } };
  return (data.customer?.orders?.nodes ?? []).map(mapOrder);
}

/** A concise, customer-readable one-line WISMO summary for an order. */
export function summarizeOrder(order: CustomerOrder): string {
  if (order.cancelledAt) return `${order.name}: cancelled.`;
  const tracking = order.fulfillments.flatMap((f) => f.trackingInfo).filter((t) => t.number || t.url);
  const fulfill = order.displayFulfillmentStatus.toLowerCase().replace(/_/g, " ");
  const parts = [`${order.name}: ${fulfill}`];
  if (tracking.length) {
    const t = tracking[0];
    parts.push(`tracking ${t.company ?? ""} ${t.number ?? ""}`.trim());
  }
  const eta = order.fulfillments.map((f) => f.estimatedDeliveryAt).find(Boolean);
  if (eta) parts.push(`est. delivery ${new Date(eta).toDateString()}`);
  return parts.join(" · ");
}
