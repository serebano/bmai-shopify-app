import { proofArgs, type PartnerProof } from "./partnerProof";
import type { KnowledgeSource } from "./kbSnapshot";

/**
 * Shared argument builders for the bmai tenant-MANAGEMENT tools
 * (`set_tenant_branding`, `publish_tenant_runtime`). Provisioning
 * (`app/lib/provision.ts`), the settings save (`app/routes/app.settings.tsx`) and
 * KB re-ingest (`app/lib/ingest.ts`) ALL build their calls here, so every caller
 * carries the SAME proof-of-shop + `confirm:true` shape the bmai edge verifies
 * (mismatched/proofless args are silently refused — the B13 bug this closes).
 */

export interface Branding {
  productName: string;
  assistantName: string;
  logoUrl?: string;
  themeColor?: string;
}

/** `set_tenant_branding` — proof-of-shop + `branding:{…}` + confirm. */
export function brandingArgs(
  proof: PartnerProof | null,
  tenantId: string | null | undefined,
  branding: Branding,
): Record<string, unknown> {
  return { ...proofArgs(proof), tenant_id: tenantId, branding, confirm: true };
}

export interface PublishOptions {
  launchOrigins?: string[];
  embedOrigins?: string[];
  /**
   * The store's compressed knowledge (app/lib/kbSnapshot.ts) — the platform's ONE
   * tenant-knowledge write path (`knowledge_sources`: replace-by-key, ≤40 sources,
   * ≤20,000 chars each, ≤40,000 total). An empty list is OMITTED (the edge rejects
   * an empty array; an empty store simply publishes without knowledge).
   * NOTE: the former `kb_snapshot` arg was not in the edge's input schema and was
   * silently ignored — never emit it.
   */
  knowledgeSources?: KnowledgeSource[];
}

/** `publish_tenant_runtime` — proof-of-shop + confirm, with optional origins/knowledge. */
export function publishArgs(
  proof: PartnerProof | null,
  tenantId: string | null | undefined,
  opts: PublishOptions = {},
): Record<string, unknown> {
  return {
    ...proofArgs(proof),
    tenant_id: tenantId,
    ...(opts.launchOrigins ? { launch_origins: opts.launchOrigins } : {}),
    ...(opts.embedOrigins ? { embed_origins: opts.embedOrigins } : {}),
    ...(opts.knowledgeSources && opts.knowledgeSources.length ? { knowledge_sources: opts.knowledgeSources } : {}),
    confirm: true,
  };
}
