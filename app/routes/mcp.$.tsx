import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { handleMcpRequest } from "../mcp/route";

/**
 * The per-store Shopify Admin MCP connector transport.
 *
 * This IS the "just another connector row" runtime: Busymate AI calls it at the dispatch
 * seam, gated fail-closed by the tenant connector gate. It speaks MCP JSON-RPC 2.0
 * at POST /mcp and serves OAuth 2.1 discovery (DCR + PKCE S256 + resource
 * indicator + iss) at /.well-known/* — matching what the bmai MCP delegation
 * surface requires.
 *
 */
export const loader = async ({ request }: LoaderFunctionArgs) => handleMcpRequest(request);
export const action = async ({ request }: ActionFunctionArgs) => handleMcpRequest(request);
