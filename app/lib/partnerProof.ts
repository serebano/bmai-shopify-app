/**
 * PROOF-OF-SHOP — the app's half of the bmdev partner-tenant authorization.
 *
 * The bmdev backend (mcp.busymate.dev) authorizes `provision_partner_tenant`, the
 * GDPR seams, and the teardown/embed-origin tools by a PROOF-OF-SHOP: an HMAC over
 * the shop, computed here with a shared secret the app holds AND bmdev holds in its
 * Vault (`SHOPIFY_PARTNER_HMAC`). This module computes the EXACT signature bmdev's
 * `supabase/functions/_shared/mcp/partnerProof.ts` verifies at the edge.
 *
 * THE CANONICAL MESSAGE (must match bmdev byte-for-byte):
 *
 *     partner-shop-v1\n<partner>\n<shop>\n<ts>
 *
 *   * partner : lowercased (allowlist {shopify})
 *   * shop    : lowercased shop domain (<store>.myshopify.com)
 *   * ts      : unix epoch MILLISECONDS (±5 min of now at the edge — anti-replay)
 *   * proof   : lowercase hex of HMAC-SHA256(secret, message)
 *
 * The shared secret is read from the env var `BMAI_PARTNER_PROOF_SECRET` and is
 * VALUE-BLIND: it is only ever fed to the HMAC and NEVER logged/returned. When the
 * secret is absent, `buildPartnerProof` returns null (fail-closed — the caller omits
 * the proof and the RPC falls to its platform-operator arm; never a fake proof).
 *
 */
import { createHmac } from "node:crypto";

/** The canonical proof version prefix — MUST equal bmdev PROOF_VERSION. */
export const PROOF_VERSION = "partner-shop-v1";
/** The env var holding the shared HMAC secret (== bmdev Vault `SHOPIFY_PARTNER_HMAC`). */
export const PROOF_SECRET_ENV = "BMAI_PARTNER_PROOF_SECRET";

/** The proof fields an MCP partner-tool call carries. */
export interface PartnerProof {
  partner: string;
  shop: string;
  /** lowercase-hex HMAC-SHA256(secret, message). */
  proof: string;
  /** unix epoch MILLISECONDS the proof was signed. */
  ts: number;
}

/** Read the shared secret from env (trimmed), or "" when unset. Value-blind. */
export function partnerProofSecret(env: NodeJS.ProcessEnv = process.env): string {
  return (env[PROOF_SECRET_ENV] ?? "").trim();
}

/** The exact canonical message bmdev signs/verifies. */
export function proofMessage(partner: string, shop: string, ts: number): string {
  return `${PROOF_VERSION}\n${partner}\n${shop}\n${ts}`;
}

/**
 * Compute a proof-of-shop for (partner, shop) at `ts` (epoch ms) with `secret`.
 * Lowercase-hex HMAC-SHA256 — matches bmdev `verifyPartnerProof`. Never logs secret.
 */
export function computePartnerProof(
  partner: string,
  shop: string,
  secret: string,
  ts: number = Date.now(),
): PartnerProof {
  const p = partner.trim().toLowerCase();
  const s = shop.trim().toLowerCase();
  const proof = createHmac("sha256", secret).update(proofMessage(p, s, ts), "utf8").digest("hex");
  return { partner: p, shop: s, proof, ts };
}

/**
 * Build proof fields for an MCP call, or null when no secret is configured
 * (fail-closed). `ts` defaults to now so the ±5-min edge window is honored.
 */
export function buildPartnerProof(
  partner: string,
  shop: string,
  env: NodeJS.ProcessEnv = process.env,
): PartnerProof | null {
  const secret = partnerProofSecret(env);
  if (!secret) return null;
  return computePartnerProof(partner, shop, secret);
}

/**
 * Spread the proof fields onto an MCP argument object, or an empty object when
 * no proof is available. Keeps call sites terse: `{ ...proofArgs(proof), ... }`.
 */
export function proofArgs(proof: PartnerProof | null): Record<string, unknown> {
  if (!proof) return {};
  return { partner: proof.partner, shop: proof.shop, proof: proof.proof, ts: proof.ts };
}
