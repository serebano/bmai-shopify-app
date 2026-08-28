import { describe, expect, it } from "vitest";
import { brandingArgs, publishArgs } from "../app/lib/mgmtArgs";
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

  it("publishArgs threads proof-of-shop + confirm and carries a kb_snapshot", () => {
    const snapshot = { products: [], generatedAt: "now" };
    const args = publishArgs(PROOF, "t_1", { kbSnapshot: snapshot });
    expect(args).toMatchObject({
      partner: "shopify",
      shop: "acme.myshopify.com",
      proof: "deadbeef",
      tenant_id: "t_1",
      kb_snapshot: snapshot,
      confirm: true,
    });
  });

  it("publishArgs carries launch/embed origins when provided", () => {
    const args = publishArgs(PROOF, "t_1", {
      launchOrigins: ["https://shop-acme.busymate.ai"],
      embedOrigins: ["https://acme.myshopify.com"],
    });
    expect(args.launch_origins).toEqual(["https://shop-acme.busymate.ai"]);
    expect(args.embed_origins).toEqual(["https://acme.myshopify.com"]);
    expect(args).not.toHaveProperty("kb_snapshot"); // omitted when not passed
  });

  it("omits proof fields (fail-closed) when no proof is available, but keeps confirm", () => {
    const args = brandingArgs(null, "t_1", { productName: "Acme", assistantName: "bro" });
    expect(args).not.toHaveProperty("proof");
    expect(args).not.toHaveProperty("partner");
    expect(args).toMatchObject({ tenant_id: "t_1", confirm: true });
  });
});
