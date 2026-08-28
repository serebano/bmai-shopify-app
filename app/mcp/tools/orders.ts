import type { ToolContext, ToolResult } from "./types";
import { errorResult, textResult } from "./types";

/**
 * Identified reads — MUST be scoped to ctx.customerId (the launch-JWT subject).
 * A missing customer id is a fail-closed refusal, never a store-wide read.
 * Anonymous fallback (order# + email match) is verified server-side elsewhere.
 */
function requireCustomer(ctx: ToolContext): ToolResult | null {
  if (!ctx.customerId) {
    return errorResult(
      "This needs you to be signed in to the store so I can look up your own orders.",
    );
  }
  return null;
}

export async function getOrderStatus(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const guard = requireCustomer(ctx);
  if (guard) return guard;
  const data = await ctx.admin.graphql(
    `#graphql
    query CustomerOrder($customerId: ID!, $q: String!) {
      customer(id: $customerId) {
        orders(first: 5, query: $q) {
          nodes { name displayFulfillmentStatus displayFinancialStatus
            fulfillments { trackingInfo { number url company } } }
        }
      }
    }`,
    { customerId: `gid://shopify/Customer/${ctx.customerId}`, q: `name:${args.order_number}` },
  );
  return textResult(`get_order_status(${args.order_number}) — TODO(P2).`, data);
}

export async function trackFulfillment(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const guard = requireCustomer(ctx);
  if (guard) return guard;
  return textResult(`track_fulfillment(${args.order_number}) — TODO(P2): return tracking links.`);
}

export async function listMyOrders(
  _args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const guard = requireCustomer(ctx);
  if (guard) return guard;
  return textResult("list_my_orders — TODO(P2): list this customer's recent orders.");
}
