import prisma from "../db.server";
import { scheduleReingest } from "./ingest";

/**
 * Re-train hook for the "Store connection" page + the Home checklist.
 *
 * CONTRACT with the knowledge-base lane (which owns app/lib/ingest.ts +
 * prisma/**): the ingest implementation fills the optional ShopTenant training
 * fields read here — `kbTrainedAt` (DateTime?), `kbError` (String?),
 * `kbProducts` / `kbPages` / `kbPolicies` (Int?). Until those columns exist this
 * module reads them defensively (undefined ⇒ "not trained yet") and `runRetrain`
 * reports the ingest call's outcome — never a fabricated "trained" state.
 */
export interface TrainingState {
  trainedAt: string | null;
  error: string | null;
  counts: { products: number | null; pages: number | null; policies: number | null };
}

type MaybeTrained = {
  kbTrainedAt?: Date | string | null;
  kbError?: string | null;
  kbProducts?: number | null;
  kbPages?: number | null;
  kbPolicies?: number | null;
};

/** Read the optional training fields off a ShopTenant row (defensive). */
export function readTrainingState(tenant: unknown): TrainingState {
  const t = (tenant ?? {}) as MaybeTrained;
  const at = t.kbTrainedAt instanceof Date ? t.kbTrainedAt.toISOString() : typeof t.kbTrainedAt === "string" ? t.kbTrainedAt : null;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return {
    trainedAt: at,
    error: typeof t.kbError === "string" && t.kbError ? t.kbError : null,
    counts: { products: num(t.kbProducts), pages: num(t.kbPages), policies: num(t.kbPolicies) },
  };
}

export interface RetrainResult {
  ok: boolean;
  error?: string;
  state: TrainingState;
}

/**
 * Re-run the store's knowledge-base ingest + runtime publish, then report the
 * resulting training state. A thrown ingest error is returned, not swallowed.
 */
export async function runRetrain(shop: string): Promise<RetrainResult> {
  const before = await prisma.shopTenant.findUnique({ where: { shop } });
  if (!before?.bmaiTenantId) {
    return { ok: false, error: "no provisioned tenant for this shop yet", state: readTrainingState(before) };
  }
  try {
    await scheduleReingest(shop, "products");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message, state: readTrainingState(before) };
  }
  const after = await prisma.shopTenant.findUnique({ where: { shop } });
  const state = readTrainingState(after);
  return { ok: !state.error, error: state.error ?? undefined, state };
}
