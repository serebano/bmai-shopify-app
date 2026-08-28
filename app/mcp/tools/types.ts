import type { ShopifyAdminClient } from "../shopifyAdmin";

/** Caller context resolved from the bearer + the identified launch claims. */
export interface ToolContext {
  shop: string;
  /** The identified Shopify customer id (from the launch JWT subject), or null (guest). */
  customerId: string | null;
  /** Whether the caller passed a confirm acknowledgement for a confirm-gated tool. */
  confirmed: boolean;
  admin: ShopifyAdminClient;
}

export interface ToolResult {
  /** Content blocks returned to Busymate AI (MCP content array). */
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: unknown;
  isError?: boolean;
}

export function textResult(text: string, structured?: unknown): ToolResult {
  return { content: [{ type: "text", text }], structuredContent: structured };
}

export function errorResult(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: true };
}
