/**
 * A missing/failed measurement is not a zero-resolution billing cycle — but a
 * genuinely OBSERVED zero (a store the assistant simply hasn't resolved
 * anything for yet, or a Free-plan store, or a fresh cycle) IS a real, known
 * fact and must render "0 resolutions this cycle", never "unavailable"
 * (#19/#2835 review-store bug: a zero-usage store showed "currently
 * unavailable" forever, because `meterShop`'s zero-resolution and Free-plan
 * paths never populate `cycleKey` — this function used to require a truthy
 * `cycleKey` as a proxy for "a real measurement happened," which a valid,
 * fully-validated `v:1` payload with a safe-integer `cycleResolutions` already
 * proves on its own; `cycleKey` is meterShop's OWN cycle-reset bookkeeping,
 * never a signal about whether the count is trustworthy for display).
 */
export function measuredCycleResolutions(raw: string | null | undefined, error?: string | null): number | null {
  if (error || !raw) return null;
  try {
    const value = JSON.parse(raw) as { v?: unknown; cycleResolutions?: unknown };
    if (!value || typeof value !== "object" || value.v !== 1 || !Number.isSafeInteger(value.cycleResolutions) || (value.cycleResolutions as number) < 0) {
      return null;
    }
    return value.cycleResolutions as number;
  } catch {
    return null;
  }
}
