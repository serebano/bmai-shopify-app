import { describe, expect, it, vi } from "vitest";
import { runtimeReadiness, readRuntimeReadiness } from "../app/lib/runtimeReadiness";

const ready = () => ({ ok: true, data: {
  ok: true, tenant: { id: "tenant", status: "active" }, publication: { revision: { revision: 3, status: "published" } },
  runtime: { desired_revision: 3, applied_revision: 3, state: "ready" },
} });

describe("published runtime evidence", () => {
  it("requires matching positive publication and projection evidence", () => {
    expect(runtimeReadiness("tenant", ready()).state).toBe("ready");
  });
  it.each(["pending", "error"])("does not treat %s as live", state => {
    const result = ready(); result.data.runtime.state = state;
    expect(runtimeReadiness("tenant", result).state).toBe(state);
  });
  it.each(["applied_revision", "desired_revision"] as const)("rejects stale %s", field => {
    const result = ready(); result.data.runtime[field] = 2;
    expect(runtimeReadiness("tenant", result).state).toBe("unverified");
  });
  it("rejects another tenant and denied or empty observations", () => {
    expect(runtimeReadiness("other", ready()).state).toBe("unverified");
    expect(runtimeReadiness("tenant", { ok: false, error: "denied" }).state).toBe("unverified");
    expect(runtimeReadiness("tenant", { ok: true }).state).toBe("unverified");
  });
  it("cannot call a zero revision live", () => {
    const result = ready(); result.data.publication.revision.revision = 0;
    result.data.runtime.applied_revision = 0; result.data.runtime.desired_revision = 0;
    expect(runtimeReadiness("tenant", result).state).toBe("unverified");
  });
  it("rejects archived tenants even before projection catches up", () => {
    const result = ready(); result.data.tenant.status = "archived";
    expect(runtimeReadiness("tenant", result).state).toBe("unverified");
  });
  it("distinguishes missing runtime evidence from real pending work", () => {
    const result = ready();
    expect(runtimeReadiness("tenant", { ...result, data: { ...result.data, runtime: null } }).state).toBe("unverified");
    result.data.runtime.state = "pending";
    expect(runtimeReadiness("tenant", result).state).toBe("pending");
    result.data.runtime.state = "applying";
    expect(runtimeReadiness("tenant", result).state).toBe("pending");
  });
  it("refreshes through the tenant-scoped official read and recovers", async () => {
    const call = vi.fn().mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce(ready());
    expect((await readRuntimeReadiness("tenant", call)).state).toBe("unverified");
    expect((await readRuntimeReadiness("tenant", call)).state).toBe("ready");
    expect(call).toHaveBeenCalledWith("get_tenant_integration", { tenant_id: "tenant" });
  });
  it("surfaces transport failure without throwing an admin error", async () => {
    expect((await readRuntimeReadiness("tenant", async () => { throw new Error("network"); })).state).toBe("unverified");
  });
});
