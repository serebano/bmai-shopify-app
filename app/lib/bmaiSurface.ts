export const BUSYMATE_AI_MCP_URL = "https://busymate.ai/mcp";

/**
 * Keep Shopify on the Busymate AI protocol boundary. A stale DevTools URL is
 * refused rather than silently routing tenant data into the wrong product.
 */
export function resolveBusymateAiMcpUrl(configured?: string): string {
  const value = (configured || BUSYMATE_AI_MCP_URL).trim().replace(/\/+$/, "");
  if (value !== BUSYMATE_AI_MCP_URL) {
    throw new Error(
      `BMAI_MGMT_MCP_URL must be ${BUSYMATE_AI_MCP_URL}; Busymate DevTools is a separate product`,
    );
  }
  return value;
}
