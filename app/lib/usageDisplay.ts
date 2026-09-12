import { parseMeterCursor } from "./meterCursor";

/** A missing/failed measurement is not a zero-resolution billing cycle. */
export function measuredCycleResolutions(raw: string | null | undefined, error?: string | null): number | null {
  if (error || !raw) return null;
  try {
    const value = JSON.parse(raw);
    if (!value || value.v !== 1 || !Number.isSafeInteger(value.cycleResolutions) || value.cycleResolutions < 0) return null;
  } catch { return null; }
  const cursor = parseMeterCursor(raw);
  return cursor.cycleKey ? cursor.cycleResolutions : null;
}
