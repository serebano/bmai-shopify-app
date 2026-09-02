import { describe, expect, it, vi } from "vitest";
import { runConnectorAction, type ConnectorActionDeps } from "../app/lib/connectorAction.server";

/**
 * The Connector action contract (#retrain-500): it must ALWAYS resolve to a JSON
 * result the embedded fetcher renders in-frame, and NEVER throw. A thrown value
 * in a React Router action bubbles to the ErrorBoundary, which renders the branded
 * "Something went wrong" (500) page inside the admin iframe — a Shopify review
 * failure. Before this fix the route awaited runRetrain / onAppInstalled inline
 * with no catch, so a failing ingest or DB error became a 500. runConnectorAction
 * fails closed to `{ ok:false, error }` instead.
 */
const okRetrain = {
  ok: true as const,
  state: "trained",
  error: null,
  trainedAt: "2026-09-02T23:30:00Z",
  counts: { products: 15, pages: 2, policies: 1 },
  summary: "15 of 17 products, 1 policies, 2 pages",
};
const okReprovision = { ok: true as const, state: "published", error: null };

function deps(over: Partial<ConnectorActionDeps> = {}): ConnectorActionDeps {
  return {
    retrain: vi.fn(async () => okRetrain),
    reprovision: vi.fn(async () => okReprovision),
    ...over,
  };
}

describe("runConnectorAction", () => {
  it("passes a successful re-train through with intent + real state", async () => {
    const res = await runConnectorAction("retrain", deps());
    expect(res).toMatchObject({ intent: "retrain", ok: true, state: "trained", summary: okRetrain.summary });
  });

  it("passes a successful re-provision through", async () => {
    const res = await runConnectorAction("reprovision", deps());
    expect(res).toMatchObject({ intent: "reprovision", ok: true, state: "published" });
  });

  it("reports an unknown intent instead of throwing", async () => {
    const res = await runConnectorAction("wat", deps());
    expect(res).toEqual({ intent: "wat", ok: false, state: "unknown", error: "unknown action" });
  });

  // The core RED→GREEN: a dependency that THROWS must become a rendered error
  // state, never a thrown 500.
  it("fails closed when re-train throws — resolves, does not reject", async () => {
    const res = await runConnectorAction("retrain", deps({ retrain: vi.fn(async () => { throw new Error("ingest crashed"); }) }));
    expect(res).toEqual({ intent: "retrain", ok: false, state: "failed", error: "ingest crashed" });
  });

  it("fails closed when re-provision throws", async () => {
    const res = await runConnectorAction("reprovision", deps({ reprovision: vi.fn(async () => { throw new Error("mcp down"); }) }));
    expect(res).toMatchObject({ intent: "reprovision", ok: false, state: "failed", error: "mcp down" });
  });

  it("never rejects — every intent resolves to a JSON result", async () => {
    for (const intent of ["retrain", "reprovision", "wat"]) {
      await expect(
        runConnectorAction(intent, deps({
          retrain: vi.fn(async () => { throw new Error("boom"); }),
          reprovision: vi.fn(async () => { throw new Error("boom"); }),
        })),
      ).resolves.toHaveProperty("ok");
    }
  });
});
