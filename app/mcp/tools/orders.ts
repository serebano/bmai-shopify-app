import type { ToolContext, ToolResult } from "./types";
import { errorResult, textResult } from "./types";
import { findCustomerOrder, listCustomerOrders, summarizeOrder, type CustomerOrder } from "./orderLookup";

/**
 * Identified reads — MUST be scoped to ctx.customerId (the launch-JWT subject).
 * A missing customer id is a fail-closed refusal, never a store-wide read. Every
 * lookup goes through `customer(id).orders(...)` (orderLookup.ts), so a customer
 * only ever sees their OWN orders.
 */
function requireCustomer(ctx: ToolContext): ToolResult | null {
  if (!ctx.customerId) {
    return errorResult(
      "This needs you to be signed in to the store so I can look up your own orders.",
    );
  }
  return null;
}

function notFound(orderNumber: unknown): ToolResult {
  return textResult(
    `I couldn't find an order ${String(orderNumber ?? "")} on your account. Please double-check the order number.`,
    { order: null },
  );
}

/** Concise WISMO fields Busymate AI cites back to the shopper. */
function orderStatusPayload(order: CustomerOrder) {
  const tracking = order.fulfillments.flatMap((f) =>
    f.trackingInfo.map((t) => ({ company: t.company, number: t.number, url: t.url })),
  );
  return {
    name: order.name,
    fulfillmentStatus: order.displayFulfillmentStatus,
    financialStatus: order.displayFinancialStatus,
    cancelled: Boolean(order.cancelledAt),
    total: order.totalPrice ? `${order.totalPrice.amount} ${order.totalPrice.currencyCode}` : null,
    tracking,
    estimatedDelivery: order.fulfillments.map((f) => f.estimatedDeliveryAt).find(Boolean) ?? null,
  };
}

export async function getOrderStatus(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const guard = requireCustomer(ctx);
  if (guard) return guard;
  const order = await findCustomerOrder(ctx, args.order_number);
  if (!order) return notFound(args.order_number);
  return textResult(summarizeOrder(order), { order: orderStatusPayload(order) });
}

export async function trackFulfillment(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const guard = requireCustomer(ctx);
  if (guard) return guard;
  const order = await findCustomerOrder(ctx, args.order_number);
  if (!order) return notFound(args.order_number);

  const tracking = order.fulfillments.flatMap((f) =>
    f.trackingInfo.map((t) => ({ company: t.company, number: t.number, url: t.url })),
  );
  if (tracking.length === 0) {
    return textResult(
      `${order.name} isn't showing tracking yet (status: ${order.displayFulfillmentStatus.toLowerCase().replace(/_/g, " ")}). I'll keep an eye on it.`,
      { order: order.name, tracking: [] },
    );
  }
  const lines = tracking.map(
    (t) => `• ${t.company ?? "Carrier"} ${t.number ?? ""}${t.url ? ` — ${t.url}` : ""}`.trim(),
  );
  return textResult(`Tracking for ${order.name}:\n${lines.join("\n")}`, {
    order: order.name,
    tracking,
  });
}

export async function listMyOrders(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const guard = requireCustomer(ctx);
  if (guard) return guard;
  const first = Number(args.first ?? 5) || 5;
  const orders = await listCustomerOrders(ctx, first);
  if (orders.length === 0) {
    return textResult("I don't see any orders on your account yet.", { orders: [] });
  }
  const summaries = orders.map((o) => ({
    name: o.name,
    processedAt: o.processedAt,
    fulfillmentStatus: o.displayFulfillmentStatus,
    total: o.totalPrice ? `${o.totalPrice.amount} ${o.totalPrice.currencyCode}` : null,
  }));
  const lines = summaries.map(
    (o) => `• ${o.name}${o.total ? ` — ${o.total}` : ""} · ${o.fulfillmentStatus.toLowerCase().replace(/_/g, " ")}`,
  );
  return textResult(`Your recent orders:\n${lines.join("\n")}`, { orders: summaries });
}
