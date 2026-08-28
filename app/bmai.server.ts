/**
 * bmai / Busymate AI integration — the ONLY way this app touches the Busymate control plane.
 *
 * ALL-OPS-VIA-MCP (a bmdev/bmai invariant): this app reaches bmai strictly through
 * MCP tools + the connector protocol — never a backdoor Supabase DB/storage write.
 * If a needed operation has no MCP tool, the fix is to expose the tool in bmdev,
 * not to reach around it here.
 *
 * AUTH: every `tools/call` carries a bmai OAuth 2.1 access token, minted + kept
 * fresh by the durable token provider (`lib/bmaiToken.ts`) from a rotating refresh
 * token. AUTHORIZATION of the partner tenant tools is PROOF-OF-SHOP (`lib/partnerProof.ts`).
 *
 * The install callback runs the LIVE MCP tenant lifecycle:
 *   provision_partner_tenant (proof) → set_tenant_branding → add_tenant_embed_origin
 *   (proof) → add_tenant_admin (best-effort) → register connector → publish_tenant_runtime
 *
 * FAIL-CLOSED: no credential ⇒ the op returns an error, never fake success
 * (green-while-dead).
 *
 */
import type { Session } from "@shopify/shopify-app-react-router/server";
import prisma from "./db.server";
import { shopToSlug } from "./lib/tenantSlug";
import { connectorEndpoint } from "./lib/connector";
import { runProvisionLifecycle, type ProvisionDeps } from "./lib/provision";
import { buildPartnerProof, proofArgs } from "./lib/partnerProof";
import { createTokenProvider, type TokenStore } from "./lib/bmaiToken";
import { decryptField, encryptField } from "./lib/fieldCipher";
import { masterSecretUsable } from "./mcp/actorToken";
import { brandingArgs, publishArgs, type Branding, type PublishOptions } from "./lib/mgmtArgs";

// Two MCP surfaces, split by the no-mix rule + one shared Supabase OAuth
// backend (the SAME access token authenticates on both):
//   • mcp.busymate.dev (busymate-devtools) — the proof-of-shop PARTNER tools
//     (provision_partner_tenant, add_tenant_embed_origin, get_tenant_usage,
//     suspend_tenant, delete_tenant, export/redact GDPR). Also the OAuth issuer.
//   • busymate.ai/mcp (busymate-ai) — the bmai tenant-MANAGEMENT tools
//     (set_tenant_branding, add_tenant_admin, upsert_tenant_support_connector,
//     publish_tenant_runtime). Excluded from the devtools host by design.
const MCP_URL = process.env.BMAI_MCP_URL || "https://mcp.busymate.dev";
const MGMT_MCP_URL = process.env.BMAI_MGMT_MCP_URL || "https://busymate.ai/mcp";
const EMBED_ORIGIN = process.env.BMAI_EMBED_ORIGIN || "https://busymate.ai";

/// Tools served ONLY by the bmai host (busymate.ai/mcp), not the devtools host.
const BMAI_MGMT_TOOLS = new Set([
  "set_tenant_branding",
  "add_tenant_admin",
  "upsert_tenant_support_connector",
  "publish_tenant_runtime",
]);

/// Route each tool to the host that serves it (same token works on both).
function hostForTool(name: string): string {
  return BMAI_MGMT_TOOLS.has(name) ? MGMT_MCP_URL : MCP_URL;
}

export interface McpResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

/** Prisma-backed store for a rotating refresh token, keyed by credential id. */
function makeTokenStore(id: string): TokenStore {
  return {
    load: async () => {
      const row = await prisma.bmaiCredential.findUnique({ where: { id } });
      // The rotating refresh token is stored encrypted at rest; decrypt on load
      // (legacy plaintext rows pass through unchanged).
      return row ? { clientId: row.clientId, refreshToken: decryptField(row.refreshToken) } : null;
    },
    save: async (v) => {
      const refreshToken = encryptField(v.refreshToken);
      await prisma.bmaiCredential.upsert({
        where: { id },
        create: { id, clientId: v.clientId, refreshToken },
        update: { clientId: v.clientId, refreshToken },
      });
    },
  };
}

// The two hosts are separate RFC-8707 resources (devtools vs bmai), so the token
// for one is rejected on the other ("token resource mismatch"). The app therefore
// holds TWO durable credentials for the SAME provisioner identity, each minted
// against its own issuer + resource, routed per-tool.
const partnerTokenProvider = createTokenProvider({
  mcpUrl: MCP_URL, // mcp.busymate.dev — devtools resource + the OAuth issuer
  staticToken: process.env.BMAI_PROVISION_TOKEN || undefined,
  seedClientId: process.env.BMAI_PROVISION_CLIENT_ID || undefined,
  seedRefreshToken: process.env.BMAI_PROVISION_REFRESH_TOKEN || undefined,
  store: makeTokenStore("provision"),
});
const mgmtTokenProvider = createTokenProvider({
  mcpUrl: MGMT_MCP_URL, // busymate.ai/mcp — bmai resource + its own OAuth issuer
  staticToken: process.env.BMAI_MGMT_TOKEN || undefined,
  seedClientId: process.env.BMAI_MGMT_CLIENT_ID || undefined,
  seedRefreshToken: process.env.BMAI_MGMT_REFRESH_TOKEN || undefined,
  store: makeTokenStore("mgmt"),
});

/** The token provider whose resource matches the host that serves the tool. */
function tokenProviderForTool(name: string) {
  return BMAI_MGMT_TOOLS.has(name) ? mgmtTokenProvider : partnerTokenProvider;
}

/** Sign a proof-of-shop for a shop (fail-closed to null when no secret is set). */
function shopProof(shop: string) {
  return buildPartnerProof("shopify", shop);
}

/**
 * MCP JSON-RPC 2.0 `tools/call` client. Mints/refreshes the OAuth bearer via the
 * token provider and retries once on a 401 (expired token → force re-mint).
 */
export async function callMcpTool<T = unknown>(
  name: string,
  args: Record<string, unknown>,
): Promise<McpResult<T>> {
  const tokenProvider = tokenProviderForTool(name);
  let token: string;
  try {
    token = await tokenProvider.getAccessToken();
  } catch (err) {
    // Fail LOUD, not silently-green: no credential ⇒ the op did NOT happen.
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  const host = hostForTool(name);
  const doFetch = (bearer: string) =>
    fetch(host, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${bearer}` },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: crypto.randomUUID(),
        method: "tools/call",
        params: { name, arguments: args },
      }),
    });

  try {
    let res = await doFetch(token);
    if (res.status === 401) {
      tokenProvider.invalidate();
      token = await tokenProvider.getAccessToken();
      res = await doFetch(token);
    }
    const json = (await res.json()) as {
      result?: { content?: unknown; structuredContent?: T; isError?: boolean };
      error?: { message?: string };
    };
    if (json.error) return { ok: false, error: json.error.message ?? "mcp error" };
    if (json.result?.isError) return { ok: false, error: toolErrorText(json.result) };
    // A NON-widget bmdev tool returns its JSON only in the `content` text block
    // (structuredContent is emitted for widget-linked tools). Parse both so we
    // reliably capture tenant_id / connector_id.
    const data = json.result?.structuredContent ?? parseToolContent<T>(json.result?.content);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Concatenate the text parts of an MCP tool-result content array. */
function contentText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((p) => (p && typeof p === "object" && "text" in p ? String((p as { text: unknown }).text) : ""))
    .filter(Boolean)
    .join(" ");
}

/** Best-effort parse of a tool result's JSON payload from its text content. */
function parseToolContent<T>(content: unknown): T | undefined {
  const text = contentText(content).trim();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

/** Extract a readable message from an isError tool result (text content). */
function toolErrorText(result: { content?: unknown }): string {
  return contentText(result.content) || "tool returned isError";
}

/** Real production deps for the provisioning lifecycle (MCP + Prisma tenant-store). */
function liveProvisionDeps(): ProvisionDeps {
  return {
    call: callMcpTool,
    getTenant: (shop) =>
      prisma.shopTenant.findUnique({
        where: { shop },
        select: { bmaiTenantId: true, customDomain: true },
      }),
    saveTenant: async (shop, patch) => {
      const slug = patch.slug ?? shopToSlug(shop);
      await prisma.shopTenant.upsert({
        where: { shop },
        create: { shop, slug, ...patch },
        update: patch,
      });
    },
    connectorEndpoint,
    embedOrigin: EMBED_ORIGIN,
    signProof: (partner, shop) => buildPartnerProof(partner, shop),
    // Register delegated writes only once this host can verify Busymate AI's actor
    // tokens (BMAI_SUPPORT_ACTOR_MASTER present) — mirrors /api/bmai/status.
    delegationReady: masterSecretUsable(process.env.BMAI_SUPPORT_ACTOR_MASTER),
  };
}

/**
 * Install / re-auth convergence. Idempotent: safe to re-run on every afterAuth.
 * Delegates to the injectable orchestrator (app/lib/provision.ts) so the sequence
 * is unit-tested with mocks; here we bind the real MCP client + Prisma tenant-store.
 */
export async function onAppInstalled(session: Session): Promise<void> {
  // email is best-effort: present only on an ONLINE session (associated user);
  // an offline install has none, so add_tenant_admin is skipped until app.settings.
  const email = session.onlineAccessInfo?.associated_user?.email ?? undefined;
  await runProvisionLifecycle(
    { shop: session.shop, email, accessToken: session.accessToken },
    liveProvisionDeps(),
  );
}

/**
 * set_tenant_branding via MCP — the proof-signed `branding:{…}` + confirm shape
 * (identical to the provisioning lifecycle). Used by the settings save. A missing
 * tenant is a fail-closed error, never a silent no-op.
 */
export async function setTenantBranding(
  shop: string,
  tenantId: string | null | undefined,
  branding: Branding,
): Promise<McpResult> {
  if (!tenantId) return { ok: false, error: "no provisioned tenant for this shop yet" };
  return callMcpTool("set_tenant_branding", brandingArgs(shopProof(shop), tenantId, branding));
}

/**
 * publish_tenant_runtime via MCP — the proof-signed + confirm shape. Used by the KB
 * re-ingest path (passes the fresh kb_snapshot). Fail-closed on a missing tenant.
 */
export async function publishTenantRuntime(
  shop: string,
  tenantId: string | null | undefined,
  opts: PublishOptions,
): Promise<McpResult> {
  if (!tenantId) return { ok: false, error: "no provisioned tenant for this shop yet" };
  return callMcpTool("publish_tenant_runtime", publishArgs(shopProof(shop), tenantId, opts));
}

/** app/uninstalled → suspend/teardown the tenant (never hard-delete on uninstall). */
export async function onAppUninstalled(shop: string): Promise<void> {
  const row = await prisma.shopTenant.findUnique({ where: { shop } });
  if (row?.bmaiTenantId) {
    await callMcpTool("suspend_tenant", { ...proofArgs(shopProof(shop)), confirm: true });
  }
  await prisma.shopTenant.updateMany({
    where: { shop },
    data: { provisionState: "suspended" },
  });
  await prisma.session.deleteMany({ where: { shop } });
}

/** shop/redact (GDPR, 48h after uninstall) → full tenant teardown + data purge. */
export async function onShopRedact(shop: string): Promise<void> {
  const row = await prisma.shopTenant.findUnique({ where: { shop } });
  if (row?.bmaiTenantId) {
    await callMcpTool("delete_tenant", { ...proofArgs(shopProof(shop)), confirm: true });
  }
  await prisma.billingState.deleteMany({ where: { shop } });
  await prisma.shopTenant.deleteMany({ where: { shop } });
  await prisma.session.deleteMany({ where: { shop } });
}

/**
 * customers/data_request (GDPR) → export the identified customer's held data
 * from the tenant (conversations/actions) via MCP, for the merchant to deliver.
 * Returns ok:false (never silently green) when there is no provisioned tenant.
 */
export async function exportTenantCustomerData(
  shop: string,
  customerId: string,
): Promise<{ ok: boolean; error?: string }> {
  const row = await prisma.shopTenant.findUnique({ where: { shop } });
  if (!row?.bmaiTenantId) return { ok: false, error: "no tenant for shop" };
  const res = await callMcpTool("export_tenant_customer_data", {
    ...proofArgs(shopProof(shop)),
    external_customer_id: customerId,
  });
  return { ok: res.ok, error: res.error };
}

/**
 * customers/redact (GDPR) → erase that customer's transcripts/PII from the tenant
 * KB via MCP. Idempotent: a redact for an unknown/already-erased customer is ok.
 */
export async function redactTenantCustomer(
  shop: string,
  customerId: string,
): Promise<{ ok: boolean; error?: string }> {
  const row = await prisma.shopTenant.findUnique({ where: { shop } });
  if (!row?.bmaiTenantId) return { ok: true }; // nothing to erase — idempotent
  const res = await callMcpTool("redact_tenant_customer", {
    ...proofArgs(shopProof(shop)),
    external_customer_id: customerId,
    confirm: true,
  });
  return { ok: res.ok, error: res.error };
}
