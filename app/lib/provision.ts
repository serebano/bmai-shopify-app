/**
 * The tenant provisioning lifecycle — the install/re-auth convergence, expressed
 * as ONE injectable orchestrator so it is unit-testable WITHOUT a live Shopify
 * Partner app, a real shop, or the bmai control plane.
 *
 * ALL-OPS-VIA-MCP: every control-plane effect flows through `deps.call` (an MCP
 * `tools/call`). This module never touches Prisma or fetch directly — the caller
 * (bmai.server) injects the real MCP client + tenant-store; tests inject mocks.
 *
 * AUTHORIZATION = PROOF-OF-SHOP. The partner tools are authorized by an
 * HMAC proof-of-shop (partner+shop+proof+ts) the app signs (`partnerProof.ts`),
 * NOT a platform-operator credential. `provision_partner_tenant` homes the calling
 * OAuth identity as the tenant's ADMIN, so the tenant-admin config tools
 * (set_tenant_branding / upsert_tenant_support_connector / publish_tenant_runtime)
 * are then authorized by that same identity. The serving host is the derived slug
 * lane `<slug>.busymate.ai` (bmdev tenancy resolve.ts), so NO operator-only
 * `set_tenant_domain` is needed; the storefront origins are allowlisted for iframe
 * embedding via `add_tenant_embed_origin` (proof path).
 *
 * FAIL-CLOSED / NEVER-PARK: provision + publish are LOAD-BEARING — a failure in
 * either records an error state and STOPS (no fake success, no publish on a broken
 * tenant). The branding / embed-origin / connector / merchant-admin steps are
 * BEST-EFFORT: a soft failure is recorded but does not abort a tenant that was
 * created and taken live. Every step is idempotent, so a re-run (every re-auth) is
 * safe.
 *
 */
import { shopToSlug } from "./tenantSlug";
import { proofArgs, type PartnerProof } from "./partnerProof";

export interface McpResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

/** The minimal session shape the lifecycle needs (a subset of Shopify's Session). */
export interface ProvisionSession {
  shop: string;
  email?: string;
  accessToken?: string;
}

export interface TenantRecord {
  bmaiTenantId?: string | null;
  customDomain?: string | null;
}

export type TenantPatch = {
  slug?: string;
  bmaiTenantId?: string | null;
  connectorId?: string | null;
  provisionState?: "provisioning" | "published" | "suspended" | "error";
  provisionError?: string | null;
  publishedAt?: Date | null;
};

export interface ProvisionDeps {
  /** MCP `tools/call` — the ONLY control-plane effect channel. */
  call: <T = unknown>(name: string, args: Record<string, unknown>) => Promise<McpResult<T>>;
  /** Read the current tenant row for the shop (or null). */
  getTenant: (shop: string) => Promise<TenantRecord | null>;
  /** Persist a partial tenant-state update for the shop (idempotent upsert). */
  saveTenant: (shop: string, patch: TenantPatch) => Promise<void>;
  /** The connector endpoint (`<app>/mcp`) this store registers with bmai. */
  connectorEndpoint: () => string;
  /** The storefront embed origin allowlisted for the widget. */
  embedOrigin: string;
  /**
   * Sign a proof-of-shop for (partner, shop), or null when no shared secret is
   * configured (fail-closed). Live deps use `buildPartnerProof`; tests stub it.
   */
  signProof: (partner: string, shop: string) => PartnerProof | null;
}

export interface ProvisionOutcome {
  ok: boolean;
  tenantId: string | null;
  connectorId: string | null;
  error?: string;
  /** Ordered list of MCP tool names invoked — asserted by the seam test. */
  calls: string[];
  /** Non-fatal step failures (best-effort steps that did not abort). */
  warnings: string[];
}

/** The tenant's derived serving host (the bmdev slug lane). */
export function servingHost(slug: string): string {
  return `https://${slug}.busymate.ai`;
}

/**
 * The connector tool policy tiers. Every name MUST be a tool the app's own
 * `/mcp` connector endpoint (app/mcp/tools/*) actually serves — the bmai connector
 * upsert probes the endpoint and REJECTS a tool_access entry for an undiscovered
 * tool (e.g. `start_return`, which the app serves; NOT `create_return`).
 */
export const CONNECTOR_POLICIES = {
  public_tools: ["search_products", "get_product", "list_collections"],
  identified_tools: ["get_order_status", "track_fulfillment", "list_my_orders"],
  delegated_tools: ["create_refund", "start_return", "cancel_order", "update_shipping_address", "apply_discount", "create_draft_order"],
  confirm_tools: ["create_refund", "start_return", "cancel_order", "update_shipping_address", "apply_discount", "create_draft_order"],
} as const;

/**
 * Run the full lifecycle:
 *   provision_partner_tenant (proof) → set_tenant_branding → add_tenant_embed_origin
 *   (proof) → add_tenant_admin (best-effort, operator) → upsert connector
 *   → publish_tenant_runtime
 */
export async function runProvisionLifecycle(
  session: ProvisionSession,
  deps: ProvisionDeps,
): Promise<ProvisionOutcome> {
  const shop = session.shop;
  const slug = shopToSlug(shop);
  const calls: string[] = [];
  const warnings: string[] = [];
  const partner = "shopify";
  const proof = deps.signProof(partner, shop);

  const call = async <T = unknown>(name: string, args: Record<string, unknown>) => {
    calls.push(name);
    return deps.call<T>(name, args);
  };
  /** A best-effort step: record a warning on failure, never abort. */
  const soft = async <T = unknown>(name: string, args: Record<string, unknown>) => {
    const r = await call<T>(name, args);
    if (!r.ok) warnings.push(`${name}: ${r.error ?? "failed"}`);
    return r;
  };

  const existing = await deps.getTenant(shop);
  await deps.saveTenant(shop, { slug, provisionState: "provisioning", provisionError: null });

  // 1) Provision — LOAD-BEARING. Proof-of-shop OR operator; idempotent by shop.
  const provisioned = await call<{ tenant_id: string }>("provision_partner_tenant", {
    partner,
    shop,
    slug,
    ...proofArgs(proof),
  });
  if (!provisioned.ok) {
    await deps.saveTenant(shop, { provisionState: "error", provisionError: provisioned.error });
    return { ok: false, tenantId: null, connectorId: null, error: provisioned.error, calls, warnings };
  }
  const tenantId = provisioned.data?.tenant_id ?? existing?.bmaiTenantId ?? null;

  // Storefront parent origins allowed to iframe-embed the assistant.
  const storefrontOrigins = [
    `https://${shop}`,
    ...(existing?.customDomain ? [`https://${existing.customDomain}`] : []),
  ];

  // 2) Branding (proof-of-shop path — re-resolves tenant from the proven shop, so the
  //    provisioner needs NO platform-operator role; #1982 security follow-up #5).
  await soft("set_tenant_branding", { ...proofArgs(proof), tenant_id: tenantId, branding: { productName: shop, assistantName: "bro" }, confirm: true });

  // 3) Storefront embed-origin allowlist (proof path — re-resolves tenant from shop).
  await soft("add_tenant_embed_origin", { ...proofArgs(proof), origins: storefrontOrigins, confirm: true });

  // NOTE: the merchant is NOT homed via add_tenant_admin here — that tool needs the
  // merchant's bmai `user_id`, which a Shopify install does not provide (only an
  // email, and an offline install none). The mgmt steps below authorize by
  // PROOF-OF-SHOP (each re-resolves the tenant from the proven shop), so the
  // provisioner needs no platform-operator role (can_manage_tenant_support_for_user's
  // tenant-admin arm requires current_tenant == target, which a multi-tenant
  // provisioner never satisfies); the merchant is linked on first bmai sign-in.

  // 5) Register the per-store Shopify Admin connector (signed_actor_token + 4 tiers).
  // Unauthenticated server access; delegation_mode:'none' → the connector registers
  // with the READ tiers (public + identified) only. The DELEGATED write tools
  // (refunds/returns/…) require the app's signed_actor_token verifier — the bmai
  // control plane refuses signed_actor_token until the partner /api/bmai/status
  // endpoint reports actorVerifier:true, which is only honest once app/mcp/auth.ts
  // actually verifies the actor HMAC (a P2 TODO). Until then this stays
  // 'none' (no green-while-dead claim).
  const connector = await soft<{ id?: string; connector?: { id?: string } }>("upsert_tenant_support_connector", {
    ...proofArgs(proof),
    tenant_id: tenantId,
    endpoint: deps.connectorEndpoint(),
    namespace: "shopify-admin",
    title: "Shopify Admin",
    auth_mode: "none",
    delegation_mode: "none",
    tool_access: connectorToolAccess(),
    confirm: true,
  });
  // The tool returns { ok, id, connector: { id } } — capture the connector's id.
  const connectorId = connector.data?.id ?? connector.data?.connector?.id ?? null;

  // 6) Publish the runtime — LOAD-BEARING (the step that makes the widget resolve).
  const published = await call("publish_tenant_runtime", {
    ...proofArgs(proof),
    tenant_id: tenantId,
    launch_origins: [servingHost(slug)],
    embed_origins: storefrontOrigins,
    confirm: true,
  });
  if (!published.ok) {
    await deps.saveTenant(shop, {
      bmaiTenantId: tenantId,
      connectorId,
      provisionState: "error",
      provisionError: `publish_tenant_runtime: ${published.error ?? "failed"}`,
    });
    return { ok: false, tenantId, connectorId, error: published.error, calls, warnings };
  }

  await deps.saveTenant(shop, {
    bmaiTenantId: tenantId,
    connectorId,
    provisionState: "published",
    provisionError: null,
    publishedAt: new Date(),
  });

  return { ok: true, tenantId, connectorId, calls, warnings };
}

/**
 * Per-tool access classification for upsert_tenant_support_connector — the READ
 * tiers only (public + identified). The delegated WRITE tier is intentionally
 * omitted until the app's signed_actor_token verifier ships (see the connector
 * registration above); registering a delegated tool without it would be refused.
 */
export function connectorToolAccess(): Record<string, "public" | "identified" | "delegated"> {
  const out: Record<string, "public" | "identified" | "delegated"> = {};
  for (const t of CONNECTOR_POLICIES.public_tools) out[t] = "public";
  for (const t of CONNECTOR_POLICIES.identified_tools) out[t] = "identified";
  return out;
}
