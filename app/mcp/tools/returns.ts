import type { ToolContext, ToolResult } from "./types";
import { errorResult, textResult } from "./types";

// The refund cap (cents) above which the agent must escalate to a human instead
// of auto-refunding. Merchant-configurable (app.settings → tenant config).
const DEFAULT_REFUND_CAP_CENTS = 5000;

export async function createRefund(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.customerId) return errorResult("Sign in required to request a refund on your order.");
  const amount = Number(args.amount_cents ?? 0);
  const cap = DEFAULT_REFUND_CAP_CENTS; // TODO(P3): read per-tenant cap.
  if (amount > cap) {
    // Above cap → do NOT auto-refund; hand off to a human (request_human is LIVE).
    return errorResult(
      `This $${(amount / 100).toFixed(2)} refund is above the automatic limit. I'll connect you with the team to approve it.`,
    );
  }
  // Refunds = write_orders via refundCreate (verify scope names against 2026-01).
  return textResult(
    `create_refund(${args.order_number}, $${(amount / 100).toFixed(2)}) — TODO(P3): refundCreate.`,
  );
}

export async function startReturn(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.customerId) return errorResult("Sign in required to start a return.");
  return textResult(`start_return(${args.order_number}) — TODO(P3): returnCreate.`);
}

export async function cancelOrder(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.customerId) return errorResult("Sign in required to cancel your order.");
  return textResult(`cancel_order(${args.order_number}) — TODO(P3): orderCancel.`);
}

export async function updateShippingAddress(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.customerId) return errorResult("Sign in required to update your shipping address.");
  return textResult(`update_shipping_address(${args.order_number}) — TODO(P3): orderUpdate.`);
}
