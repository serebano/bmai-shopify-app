import type { McpResult } from "../bmai.server";

export interface RuntimeReadiness {
  state: "ready" | "pending" | "error" | "unverified";
  detail: string;
}
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => v && typeof v === "object" && !Array.isArray(v) ? v as Obj : {};
const revision = (v: unknown): number | null => typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? v : null;

/** Official get_tenant_integration contract; publication is not projection proof. */
export function runtimeReadiness(tenantId: string, result: McpResult): RuntimeReadiness {
  const data = obj(result.data);
  if (!result.ok || data.ok !== true || obj(data.tenant).id !== tenantId) {
    return { state: "unverified", detail: "We couldn't verify whether your assistant is live. Refresh to check again." };
  }
  const publication = obj(obj(data.publication).revision);
  const runtime = obj(data.runtime);
  const published = revision(publication.revision);
  const unknown: RuntimeReadiness = { state: "unverified", detail: "We couldn't verify whether your assistant is live. Refresh to check again." };
  if (obj(data.tenant).status !== "active") return unknown;
  if (publication.status !== "published" || published === null || revision(runtime.desired_revision) === null) return unknown;
  if (!(runtime.applied_revision === null || runtime.applied_revision === 0 || revision(runtime.applied_revision) !== null)) return unknown;
  if (runtime.state === "error") return { state: "error", detail: "Your assistant was published, but activation failed. Retry setup or contact support." };
  if (publication.status === "published" && published !== null && runtime.state === "ready"
    && revision(runtime.desired_revision) === published && revision(runtime.applied_revision) === published) {
    return { state: "ready", detail: "Your published assistant is active." };
  }
  if ((runtime.state === "pending" || runtime.state === "applying") && runtime.desired_revision === published
    && (runtime.applied_revision === null || runtime.applied_revision === 0 || revision(runtime.applied_revision) !== null)) {
    return { state: "pending", detail: "Your assistant is waiting to become active. Refresh to check again." };
  }
  return unknown;
}

export async function readRuntimeReadiness(
  tenantId: string,
  call: <T = unknown>(name: string, args: Record<string, unknown>) => Promise<McpResult<T>>,
): Promise<RuntimeReadiness> {
  try {
    return runtimeReadiness(tenantId, await call("get_tenant_integration", { tenant_id: tenantId }));
  } catch {
    return runtimeReadiness(tenantId, { ok: false });
  }
}
