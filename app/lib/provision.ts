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
import { brandingArgs, publishArgs } from "./mgmtArgs";
import type { KnowledgeBuild, KnowledgeCounts } from "./kbSnapshot";
import { isKnowledgeRejection, publishOptionsFor, trainingPatch, type TrainingPatch } from "./kbTrain";

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
  connectorId?: string | null;
  provisionState?: string | null;
}

export type TenantPatch = {
  slug?: string;
  bmaiTenantId?: string | null;
  connectorId?: string | null;
  provisionState?: "provisioning" | "published" | "suspended" | "error";
  provisionError?: string | null;
  publishedAt?: Date | null;
} & Partial<TrainingPatch>;

/** The runtime origins every publish carries (install AND re-train use the same). */
export function runtimeOrigins(shop: string, slug: string, customDomain?: string | null): { launchOrigins: string[]; embedOrigins: string[] } {
  return {
    launchOrigins: [servingHost(slug)],
    embedOrigins: [`https://${shop}`, ...(customDomain ? [`https://${customDomain}`] : [])],
  };
}

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
  /**
   * Is this host READY to verify Busymate AI's signed actor tokens? True iff
   * `BMAI_SUPPORT_ACTOR_MASTER` is a usable ≥32-byte secret (== what
   * `/api/bmai/status` reports as `actorVerifier`). When true the connector
   * registers with `delegation_mode:'signed_actor_token'` + the DELEGATED write
   * tools; when false it stays READ-ONLY (`none`) — the bmai control plane refuses
   * `signed_actor_token` until the app can honestly verify the HMAC, so flipping it
   * before the master is provisioned would be green-while-dead.
   */
  delegationReady: boolean;
  /**
   * Build the store's knowledge (products/policies/pages → `knowledge_sources`,
   * app/lib/kbFetch.ts) so the tenant is TRAINED in the same publish that takes
   * it live. Optional: the ops verify script has no shop session. A throw is a
   * soft failure — recorded as kbError + warned, the tenant still goes live.
   */
  buildKnowledge?: (shop: string) => Promise<KnowledgeBuild>;
}

export interface TrainingSummary {
  ok: boolean;
  error?: string;
  counts: KnowledgeCounts;
  truncated: boolean;
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
  /** provision_partner_tenant brought an ARCHIVED (uninstalled) tenant back (reinstall). */
  reactivated: boolean;
  /** What the tenant was trained on in this run (null when no buildKnowledge dep). */
  training: TrainingSummary | null;
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
 *   provision_partner_tenant (proof; reactivates an archived tenant on reinstall)
 *   → set_tenant_branding → add_tenant_embed_origin (proof) → upsert connector
 *   → buildKnowledge (products/policies/pages → knowledge_sources)
 *   → publish_tenant_runtime (origins + knowledge — ONE publish)
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
  const provisioned = await call<{ tenant_id: string; created?: boolean; reactivated?: boolean }>("provision_partner_tenant", {
    partner,
    shop,
    slug,
    ...proofArgs(proof),
  });
  if (!provisioned.ok) {
    await deps.saveTenant(shop, { provisionState: "error", provisionError: provisioned.error });
    return { ok: false, tenantId: null, connectorId: null, error: provisioned.error, calls, warnings, reactivated: false, training: null };
  }
  const tenantId = provisioned.data?.tenant_id ?? existing?.bmaiTenantId ?? null;
  // REINSTALL: app/uninstalled archived the tenant (suspend_tenant); under a valid
  // proof provision_partner_tenant reactivates it (status active + runtime
  // re-projection) and says so. The publish below re-takes it live either way.
  const reactivated = provisioned.data?.reactivated === true;

  // Storefront parent origins allowed to iframe-embed the assistant.
  const origins = runtimeOrigins(shop, slug, existing?.customDomain);
  const storefrontOrigins = origins.embedOrigins;

  // 2) Branding (proof-of-shop path — re-resolves tenant from the proven shop, so the
  //    provisioner needs NO platform-operator role; #1982 security follow-up #5).
  //    ONLY for a NEW tenant: a reinstall / Connector re-run / re-auth of an existing
  //    tenant must NEVER overwrite the merchant's saved names with the defaults
  //    (#2132 C — the review store's rename was wiped by the reinstall). The publish
  //    below re-reads the tenant row, so an existing tenant keeps its branding.
  const isNewTenant = provisioned.data?.created === true || (!existing?.bmaiTenantId && provisioned.data?.reactivated !== true);
  if (isNewTenant) {
    await soft("set_tenant_branding", brandingArgs(proof, tenantId, { productName: shop, assistantName: "bro" }));
  }

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
  // Unauthenticated server access (`auth_mode:'none'`); the per-user delegation mode
  // is gated on the app's actor-token verifier being READY (deps.delegationReady ==
  // /api/bmai/status actorVerifier). READY → `signed_actor_token` + the DELEGATED
  // write tools (refunds/returns/cancel/address/discount/draft), each still
  // confirm-gated + actor-scoped. NOT READY → READ-ONLY (`none`, public+identified
  // only): the bmai control plane refuses `signed_actor_token` until the host can
  // honestly verify the HMAC, so we never make a claim we can't back (no
  // green-while-dead). The step is idempotent — provisioning the master and
  // re-running Connector → Re-provision flips it live.
  const delegationMode = deps.delegationReady ? "signed_actor_token" : "none";
  const connector = await soft<{ id?: string; connector?: { id?: string } }>("upsert_tenant_support_connector", {
    ...proofArgs(proof),
    tenant_id: tenantId,
    endpoint: deps.connectorEndpoint(),
    namespace: "shopify-admin",
    title: "Shopify Admin",
    auth_mode: "none",
    delegation_mode: delegationMode,
    tool_access: connectorToolAccess(deps.delegationReady),
    confirm: true,
  });
  // The tool returns { ok, id, connector: { id } } — capture the connector's id.
  // PRESERVE a previously-captured id: the connector step is BEST-EFFORT and an
  // idempotent re-upsert (every re-auth) may return ok without re-echoing the id,
  // so falling back to `null` would NULL a good connectorId and regress the app's
  // "connector registered" state on every re-auth. Fall back to the existing id.
  const connectorId =
    connector.data?.id ?? connector.data?.connector?.id ?? existing?.connectorId ?? null;

  // 6) Train — build the store knowledge (products / policies / pages) so the
  //    publish below carries `knowledge_sources`. SOFT: a failure is persisted as
  //    kbError + surfaced on Home/Store connection, and the tenant still goes live
  //    (an un-trained assistant that says so beats no assistant at all).
  let knowledge: KnowledgeBuild | null = null;
  let training: TrainingPatch | null = null;
  let trainingSummary: TrainingSummary | null = null;
  if (deps.buildKnowledge) {
    try {
      knowledge = await deps.buildKnowledge(shop);
      training = trainingPatch(knowledge, new Date());
      trainingSummary = { ok: true, counts: knowledge.counts, truncated: knowledge.truncated };
    } catch (err) {
      const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
      warnings.push(`knowledge: ${message}`);
      training = { kbError: message };
      trainingSummary = { ok: false, error: message, counts: { products: 0, policies: 0, pages: 0 }, truncated: false };
    }
  }

  // 7) Publish the runtime — LOAD-BEARING (the step that makes the widget resolve).
  //    ONE publish carrying origins + knowledge. If the edge refuses the KNOWLEDGE
  //    payload specifically, re-publish without it so the tenant is still live and
  //    the rejection is surfaced as the training error.
  let published = await call<{ revision?: number }>("publish_tenant_runtime", publishArgs(proof, tenantId, publishOptionsFor(knowledge, origins)));
  if (!published.ok && knowledge && knowledge.sources.length && isKnowledgeRejection(published.error)) {
    const message = `publish_tenant_runtime: ${published.error ?? "failed"}`.slice(0, 500);
    warnings.push(`knowledge: ${message}`);
    training = { kbError: message };
    trainingSummary = { ok: false, error: message, counts: knowledge.counts, truncated: knowledge.truncated };
    published = await call("publish_tenant_runtime", publishArgs(proof, tenantId, publishOptionsFor(null, origins)));
  }
  if (!published.ok) {
    await deps.saveTenant(shop, {
      bmaiTenantId: tenantId,
      connectorId,
      provisionState: "error",
      provisionError: `publish_tenant_runtime: ${published.error ?? "failed"}`,
      ...(training ?? {}),
    });
    return { ok: false, tenantId, connectorId, error: published.error, calls, warnings, reactivated, training: trainingSummary };
  }

  await deps.saveTenant(shop, {
    bmaiTenantId: tenantId,
    connectorId,
    provisionState: "published",
    provisionError: null,
    publishedAt: new Date(),
    ...(training ?? {}),
  });

  return { ok: true, tenantId, connectorId, calls, warnings, reactivated, training: trainingSummary };
}

/**
 * INSTALL-TIME GUARD — the ONLY entry point afterAuth may call.
 *
 * `runProvisionLifecycle` records `error` state for a failed MCP step but still
 * THROWS at its dependency boundary (a Prisma `getTenant`/`saveTenant` write — e.g.
 * a `P2002` unique-constraint race when Shopify's App-Bridge double-bounce fires
 * two concurrent installs for the same new shop). afterAuth MUST NOT throw: the
 * Shopify token-exchange strategy converts ANY afterAuth throw into a bare
 * `500 Internal Server Error` on the embedded app's FIRST load — which is exactly
 * the App Store review failure (Req 2.1.1 "no critical errors" / 2.1.3 "an
 * interactive UI, not a web 500"). This guard GUARANTEES it never throws: a
 * provisioning failure is recorded as an operational error state that the app UI
 * surfaces (Req 2.1.3 explicitly permits operational errors) and every re-auth /
 * the Connector "Retry" re-runs the idempotent lifecycle.
 */
export async function provisionOnInstall(
  session: ProvisionSession,
  deps: ProvisionDeps,
): Promise<ProvisionOutcome> {
  try {
    return await runProvisionLifecycle(session, deps);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      // A concurrent install can WIN the race and publish this tenant while our
      // attempt throws a unique-constraint error at the write boundary — don't
      // stomp a good `published` state with a bogus `error`.
      const existing = await deps.getTenant(session.shop);
      if (existing?.bmaiTenantId) {
        return {
          ok: true,
          tenantId: existing.bmaiTenantId,
          connectorId: null,
          calls: [],
          warnings: [`provisionOnInstall raced; tenant already provisioned: ${message}`],
          reactivated: false,
          training: null,
        };
      }
      await deps.saveTenant(session.shop, {
        slug: shopToSlug(session.shop),
        provisionState: "error",
        provisionError: message.slice(0, 500),
      });
    } catch {
      // Best-effort: even recording the error must not throw out of afterAuth.
    }
    return {
      ok: false,
      tenantId: null,
      connectorId: null,
      error: message,
      calls: [],
      warnings: [`provisionOnInstall threw: ${message}`],
      reactivated: false,
      training: null,
    };
  }
}

/**
 * Per-tool access classification for upsert_tenant_support_connector. The READ
 * tiers (public + identified) always register. The DELEGATED write tier registers
 * only when `includeDelegated` (the actor-token verifier is ready) — the bmai
 * control plane refuses a delegated tool_access entry unless the host can verify
 * the signed actor token, so this is gated in lockstep with `delegation_mode`.
 */
export function connectorToolAccess(
  includeDelegated = false,
): Record<string, "public" | "identified" | "delegated"> {
  const out: Record<string, "public" | "identified" | "delegated"> = {};
  for (const t of CONNECTOR_POLICIES.public_tools) out[t] = "public";
  for (const t of CONNECTOR_POLICIES.identified_tools) out[t] = "identified";
  if (includeDelegated) for (const t of CONNECTOR_POLICIES.delegated_tools) out[t] = "delegated";
  return out;
}
