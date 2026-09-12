import { describe, expect, it } from "vitest";
import { validatePreparedBatch, type PreparedMeterBatch } from "../app/lib/meterOutbox";
const batch: PreparedMeterBatch = { shop: "fixture.myshopify.com", tenantId: "tenant-1", shopId: "gid://shopify/Shop/1", plan: "growth", subscriptionId: "subscription-1", beforeCursor: null, afterCursor: "c1", units: 1, occurredFrom: "2026-09-10T00:00:00Z", occurredThrough: "2026-09-11T00:00:00Z", timestamp: "2026-09-11T00:00:00Z", cycleStart: "2026-09-01T00:00:00Z", cycleEnd: "2026-10-01T00:00:00Z", evidenceRef: "ledger-proof-1" };
describe("prepared metering batch", () => {
  it("accepts a bounded occurrence range within one supplied cycle", () => expect(() => validatePreparedBatch(batch)).not.toThrow());
  it.each([0, -1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1])("rejects units %s", units => expect(() => validatePreparedBatch({ ...batch, units })).toThrow());
  it.each([
    { plan: "free" }, { plan: "unknown" }, { evidenceRef: "" }, { subscriptionId: "" }, { tenantId: "" }, { afterCursor: "" },
    { beforeCursor: "c1" }, { occurredFrom: "2026-08-31T00:00:00Z" },
    { occurredThrough: "2026-10-01T00:00:00Z" }, { occurredThrough: "invalid" },
    { timestamp: "2026-10-01T00:00:00Z" }, { cycleEnd: "2026-09-01T00:00:00Z" },
  ])("refuses incomplete or cross-cycle evidence %j", change => expect(() => validatePreparedBatch({ ...batch, ...change })).toThrow());
});
