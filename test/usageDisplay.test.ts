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
