const APP_URL = process.env.SHOPIFY_APP_URL || "https://store.busymate.ai";

/** The endpoint Busymate AI registers as the per-store connector's mcp_servers row. */
export function connectorEndpoint(): string {
  return `${APP_URL}/mcp`;
}

/**
 * The `aud` we pin on Busymate AI's actor tokens = the ORIGIN of the connector endpoint.
 * Busymate AI mints `aud = new URL(connectorEndpoint).origin` (v2 sessionConnectorTools),
 * so this is the single source of truth for actor-token audience verification.
 */
export function connectorAudience(): string {
  try {
    return new URL(connectorEndpoint()).origin;
  } catch {
    return "https://store.busymate.ai";
  }
}
