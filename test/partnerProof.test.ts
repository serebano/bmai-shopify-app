import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  PROOF_VERSION,
  buildPartnerProof,
  computePartnerProof,
  partnerProofSecret,
  proofArgs,
  proofMessage,
} from "../app/lib/partnerProof";

// Proof-of-shop must match bmdev `_shared/mcp/partnerProof.ts` byte-for-byte:
//   message = "partner-shop-v1\n<partner>\n<shop>\n<ts>", proof = hex HMAC-SHA256.
// This suite RE-DERIVES the signature the way the EDGE verifies it (an independent
// HMAC over the canonical message) and asserts equality — the contract, not the impl.

const SECRET = "test-shared-secret-0123456789";
const SHOP = "acme.myshopify.com";
const TS = 1787900000000;

describe("partner proof-of-shop", () => {
  it("canonical message is exactly the bmdev contract string", () => {
    expect(proofMessage("shopify", SHOP, TS)).toBe(`${PROOF_VERSION}\nshopify\n${SHOP}\n${TS}`);
    expect(PROOF_VERSION).toBe("partner-shop-v1");
  });

  it("computes the SAME hex HMAC the edge verifies (independent re-derivation)", () => {
    const { proof, partner, shop, ts } = computePartnerProof("shopify", SHOP, SECRET, TS);
    const expected = createHmac("sha256", SECRET)
      .update(`partner-shop-v1\nshopify\n${SHOP}\n${TS}`, "utf8")
      .digest("hex");
    expect(proof).toBe(expected);
    expect(proof).toMatch(/^[0-9a-f]{64}$/); // sha256 hex
    expect(partner).toBe("shopify");
    expect(shop).toBe(SHOP);
    expect(ts).toBe(TS);
  });

  it("lowercases partner + shop before signing (matches edge normalization)", () => {
    const a = computePartnerProof("SHOPIFY", "ACME.MyShopify.com", SECRET, TS);
    const b = computePartnerProof("shopify", "acme.myshopify.com", SECRET, TS);
    expect(a.proof).toBe(b.proof);
    expect(a.partner).toBe("shopify");
    expect(a.shop).toBe("acme.myshopify.com");
  });

  it("a DIFFERENT ts / shop / secret yields a different signature (no static proof)", () => {
    const base = computePartnerProof("shopify", SHOP, SECRET, TS).proof;
    expect(computePartnerProof("shopify", SHOP, SECRET, TS + 1).proof).not.toBe(base);
    expect(computePartnerProof("shopify", "other.myshopify.com", SECRET, TS).proof).not.toBe(base);
    expect(computePartnerProof("shopify", SHOP, "other-secret", TS).proof).not.toBe(base);
  });

  it("buildPartnerProof reads the env secret and stamps a fresh ms ts", () => {
    const before = Date.now();
    const p = buildPartnerProof("shopify", SHOP, { [ "BMAI_PARTNER_PROOF_SECRET" ]: SECRET } as NodeJS.ProcessEnv);
    expect(p).not.toBeNull();
    expect(p!.ts).toBeGreaterThanOrEqual(before);
    expect(p!.ts).toBeLessThanOrEqual(Date.now());
    // and it equals the manual computation at that ts
    expect(p!.proof).toBe(computePartnerProof("shopify", SHOP, SECRET, p!.ts).proof);
  });

  it("FAIL-CLOSED: no secret ⇒ null proof (never a fake proof)", () => {
    expect(buildPartnerProof("shopify", SHOP, {} as NodeJS.ProcessEnv)).toBeNull();
    expect(partnerProofSecret({} as NodeJS.ProcessEnv)).toBe("");
    expect(proofArgs(null)).toEqual({});
  });

  it("proofArgs spreads exactly the 4 wire fields", () => {
    const p = computePartnerProof("shopify", SHOP, SECRET, TS);
    expect(proofArgs(p)).toEqual({ partner: "shopify", shop: SHOP, proof: p.proof, ts: TS });
  });
});
