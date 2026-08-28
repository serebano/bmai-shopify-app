import type { ToolContext, ToolResult } from "./types";
import { errorResult, textResult } from "./types";

// Delegated + confirm writes. The transport enforces confirm before dispatch;
// these assume ctx.confirmed === true.
export async function applyDiscount(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.customerId) return errorResult("Sign in required to apply a discount to your order.");
  return textResult(`apply_discount(${args.code}) — TODO(P3): draftOrderApplyDiscount.`);
}

export async function createDraftOrder(
  _args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.customerId) return errorResult("Sign in required to create a draft order.");
  return textResult("create_draft_order — TODO(P3): draftOrderCreate.");
}
