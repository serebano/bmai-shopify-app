/**
 * Live end-to-end verification of the tenant-provisioning path against the REAL
 * bmdev edge (mcp.busymate.dev). Reuses the app's OWN modules — callMcpTool (durable
 * token provider + JSON-RPC), runProvisionLifecycle, buildPartnerProof — so it
 * exercises the exact proof + credential + lifecycle code the install callback runs.
 * The tenant STORE is in-memory (no ShopTenant row) so the app's tables stay clean.
 *
 * Env (sourced from /etc/bmai-shopify-app/env on the host): BMAI_MCP_URL,
 * BMAI_PARTNER_PROOF_SECRET, BMAI_PROVISION_CLIENT_ID/REFRESH_TOKEN, DATABASE_URL.
 * Prints only non-secret status. Usage:
 *   TEST_SHOP=<shop> node /tmp/verify.mjs          # provision
 *   TEST_SHOP=<shop> ACTION=delete node /tmp/verify.mjs  # teardown
 */
import { callMcpTool } from "../app/bmai.server";
import { runProvisionLifecycle, type ProvisionDeps } from "../app/lib/provision";
import { buildPartnerProof, proofArgs } from "../app/lib/partnerProof";

const shop = process.env.TEST_SHOP || `bmai-verify-${Date.now().toString(36)}.myshopify.com`;
const action = process.env.ACTION || "provision";

async function provision() {
  const deps: ProvisionDeps = {
    call: callMcpTool,
    getTenant: async () => null,
    saveTenant: async () => {},
    connectorEndpoint: () => `${process.env.SHOPIFY_APP_URL || "https://shopify.busymate.ai"}/mcp`,
    embedOrigin: process.env.BMAI_EMBED_ORIGIN || "https://busymate.ai",
    signProof: (partner, s) => buildPartnerProof(partner, s),
  };
  const out = await runProvisionLifecycle({ shop, email: "verify@bmai.test" }, deps);
  console.log(JSON.stringify({ step: "provision", shop, ...out }, null, 2));
}

async function del() {
  const r = await callMcpTool("delete_tenant", { ...proofArgs(buildPartnerProof("shopify", shop)), confirm: true });
  console.log(JSON.stringify({ step: "delete_tenant", shop, ...r }, null, 2));
}

(action === "delete" ? del() : provision()).catch((e) => {
  console.error("VERIFY_ERROR:", e?.message || String(e));
  process.exit(1);
});
