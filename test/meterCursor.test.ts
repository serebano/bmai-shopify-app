import { describe, expect, it } from "vitest";
import { parseMeterCursor, serializeMeterCursor } from "../app/lib/meterCursor";

/**
 * The metering cursor persists three things in BillingState.lastMeteredCursor —
 * the upstream usage cursor, the billing-cycle key and the resolutions counted
 * so far in that cycle (to apply the plan's included allowance). It must round-trip
 * and accept the legacy bare-string cursor already stored on live rows.
 */
describe("meter cursor", () => {
  it("round-trips", () => {
    const raw = serializeMeterCursor({ cursor: "c9", cycleKey: "2026-09-01T00:00:00Z", cycleResolutions: 41 });
    expect(parseMeterCursor(raw)).toEqual({ cursor: "c9", cycleKey: "2026-09-01T00:00:00Z", cycleResolutions: 41 });
  });
  it("a legacy bare cursor string is read as the cursor with an empty cycle", () => {
    expect(parseMeterCursor("abc")).toEqual({ cursor: "abc", cycleKey: null, cycleResolutions: 0 });
  });
  it("null/empty/garbage ⇒ empty state (never throws)", () => {
    expect(parseMeterCursor(null)).toEqual({ cursor: null, cycleKey: null, cycleResolutions: 0 });
    expect(parseMeterCursor("")).toEqual({ cursor: null, cycleKey: null, cycleResolutions: 0 });
    expect(parseMeterCursor("{not json")).toEqual({ cursor: "{not json", cycleKey: null, cycleResolutions: 0 });
    expect(parseMeterCursor('{"v":1,"cycleResolutions":"x"}')).toEqual({ cursor: null, cycleKey: null, cycleResolutions: 0 });
  });
});
