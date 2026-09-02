import { describe, expect, it } from "vitest";
import { brandingArgs, identityProviderArgs, publishArgs } from "../app/lib/mgmtArgs";
import type { PartnerProof } from "../app/lib/partnerProof";

/**
 * B13 — the settings-save + re-ingest calls must carry the SAME proof-signed shape
 * the provisioning lifecycle uses, or the bmai edge silently refuses them. These
 * builders are the single source of that shape; provision.ts, app.settings.tsx and
 * ingest.ts all go through them.
 */
const PROOF: PartnerProof = { partner: "shopify", shop: "acme.myshopify.com", proof: "deadbeef", ts: 1_800_000_000_000 };

describe("mgmt call-arg shape (proof-signed + confirm)", () => {
  it("brandingArgs threads proof-of-shop + branding{} + confirm", () => {
    const args = brandingArgs(PROOF, "t_1", { productName: "Acme", assistantName: "bro" });
    expect(args).toMatchObject({
      partner: "shopify",
      shop: "acme.myshopify.com",
      proof: "deadbeef",
      ts: PROOF.ts,
      tenant_id: "t_1",
      branding: { productName: "Acme", assistantName: "bro" },
      confirm: true,
    });
    // The pre-fix bug: a flat display_name/assistant_name with no proof.
    expect(args).not.toHaveProperty("display_name");
    expect(args).not.toHaveProperty("assistant_name");
  });

  it("publishArgs threads proof-of-shop + confirm and carries knowledge_sources (the platform's ONE knowledge write path)", () => {
    const sources = [{ key: "shopify:products", label: "Product catalog", kind: "fact" as const, content: "Board — 99.00 USD" }];
    const args = publishArgs(PROOF, "t_1", { knowledgeSources: sources });
    expect(args).toMatchObject({
      partner: "shopify",
      shop: "acme.myshopify.com",
      proof: "deadbeef",
      tenant_id: "t_1",
      knowledge_sources: sources,
      confirm: true,
    });
    // The pre-fix bug: `kb_snapshot` is not in the edge's input schema and was
    // silently IGNORED — "auto-train" never landed. It must never be emitted again.
    expect(args).not.toHaveProperty("kb_snapshot");
  });

  it("publishArgs omits knowledge_sources when the list is empty (an empty store publishes without knowledge)", () => {
    const args = publishArgs(PROOF, "t_1", { knowledgeSources: [] });
    expect(args).not.toHaveProperty("knowledge_sources");
    expect(args).not.toHaveProperty("kb_snapshot");
  });

  it("publishArgs carries launch/embed origins when provided", () => {
    const args = publishArgs(PROOF, "t_1", {
      launchOrigins: ["https://shop-acme.busymate.ai"],
      embedOrigins: ["https://acme.myshopify.com"],
    });
    expect(args.launch_origins).toEqual(["https://shop-acme.busymate.ai"]);
    expect(args.embed_origins).toEqual(["https://acme.myshopify.com"]);
    expect(args).not.toHaveProperty("knowledge_sources"); // omitted when not passed
    expect(args).not.toHaveProperty("kb_snapshot");
  });

  it("omits proof fields (fail-closed) when no proof is available, but keeps confirm", () => {
    const args = brandingArgs(null, "t_1", { productName: "Acme", assistantName: "bro" });
    expect(args).not.toHaveProperty("proof");
    expect(args).not.toHaveProperty("partner");
    expect(args).toMatchObject({ tenant_id: "t_1", confirm: true });
  });
});

describe("identityProviderArgs (#2132 — the launch-JWT provider registration)", () => {
  const REG = {
    issuer: "https://store.busymate.ai",
    jwksUri: "https://store.busymate.ai/.well-known/jwks.json",
    identityEndpointUrl: "https://store.busymate.ai/identity",
    audience: "bmai-support-launch",
    tenantClaim: "shop",
    maxTokenAgeSeconds: 120,
  };
  it("threads proof-of-shop + confirm, binds the provider to the shop via the `shop` claim, ES256 only, tenant-owned login/account URLs", () => {
    const args = identityProviderArgs(PROOF, "t_1", "acme.myshopify.com", REG, { delegatedAccess: true });
    expect(args).toMatchObject({
      partner: "shopify", shop: "acme.myshopify.com", proof: "deadbeef", ts: PROOF.ts, tenant_id: "t_1",
      label: "Shopify customer accounts", issuer: REG.issuer, jwks_uri: REG.jwksUri, audiences: ["bmai-support-launch"],
      tenant_claim: "shop", tenant_claim_value: "acme.myshopify.com", subject_claim: "sub", allowed_algs: ["ES256"],
      max_token_age_seconds: 120, identity_endpoint_url: REG.identityEndpointUrl,
      login_url: "https://acme.myshopify.com/account/login", account_url: "https://acme.myshopify.com/account",
      delegated_access: true, enabled: true, confirm: true,
    });
    expect(args).not.toHaveProperty("provider_id");
  });
  it("re-targets an existing provider by provider_id", () => {
    const args = identityProviderArgs(PROOF, "t_1", "acme.myshopify.com", REG, { providerId: "p_1", delegatedAccess: false });
    expect(args.provider_id).toBe("p_1");
    expect(args.delegated_access).toBe(false);
  });
});
