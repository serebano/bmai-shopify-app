import { expect, it } from "vitest";
import { measuredCycleResolutions } from "../app/lib/usageDisplay";
import { serializeMeterCursor } from "../app/lib/meterCursor";

it("distinguishes an observed zero from missing or failed usage", () => {
  const zero = serializeMeterCursor({ cursor: "c", cycleKey: "cycle", cycleResolutions: 0 });
  expect(measuredCycleResolutions(zero)).toBe(0);
  expect(measuredCycleResolutions(zero, "unreadable")).toBeNull();
  expect(measuredCycleResolutions(null)).toBeNull();
  expect(measuredCycleResolutions("legacy")).toBeNull();
  expect(measuredCycleResolutions('{"v":1,"cycleKey":"cycle"}')).toBeNull();
  expect(measuredCycleResolutions(serializeMeterCursor({ cursor: "c", cycleKey: "cycle", cycleResolutions: 17 }))).toBe(17);
});

it("a ZERO-USAGE store (never resolved anything, or Free-plan, or a fresh cycle) renders 0, never 'unavailable' (#19/#2835)", () => {
  // This is the EXACT shape meterShop actually persists for a zero-resolution
  // batch: `cycleKey` stays null (only the Free-plan and paid-cycle-fetch
  // branches ever populate it, and neither runs when `resolutions === 0`).
  const noCycleKeyZero = serializeMeterCursor({ cursor: "c1", cycleKey: null, cycleResolutions: 0 });
  expect(measuredCycleResolutions(noCycleKeyZero)).toBe(0);
  // Same shape but a real nonzero count (a Free-plan store that has resolved
  // something, but never went through a paid-cycle fetch) must also render.
  const noCycleKeyNonzero = serializeMeterCursor({ cursor: "c1", cycleKey: null, cycleResolutions: 3 });
  expect(measuredCycleResolutions(noCycleKeyNonzero)).toBe(3);
});
