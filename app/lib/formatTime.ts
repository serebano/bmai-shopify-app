/**
 * Deterministic time formatting for server-rendered UI (#retrain-500).
 *
 * WHY THIS EXISTS — the App Store "Something went wrong" 500 on the Connector
 * page was a React HYDRATION MISMATCH. The routes rendered timestamps with a
 * bare `new Date(iso).toLocaleString()`, which formats in the RUNNING PROCESS'S
 * time zone + locale. The SSR pass (Node on the London host, TZ=UTC) produced a
 * different string than the merchant's browser (the reviewer's own time zone),
 * so every embedded load threw React #418/#425/#423. Inside App Bridge's iframe
 * re-parenting, that hydration failure escalates to the root ErrorBoundary — the
 * branded "Something went wrong" page — and the in-flight fetcher POST is aborted
 * (nginx 499) as the frame swaps to it, even though the action itself succeeded.
 *
 * THE RULE: anything rendered during SSR must be time-zone/locale DETERMINISTIC,
 * so the server string and the first client render are byte-identical and
 * hydration is clean. `formatServerTime` fixes the zone to UTC and the locale to
 * en-GB. The merchant's LOCAL time is layered on AFTER hydration, client-only, by
 * `app/components/LocalTime.tsx`.
 */

/** Formatting parts shared by the date-time and date-only renders. Fixed zone + locale = deterministic. */
const TIME_PARTS: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
};

const DATE_PARTS: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
};

/**
 * A stable UTC/en-GB rendering of an ISO instant, safe to emit during SSR.
 * Returns `fallback` for null/empty/invalid input. `dateOnly` drops the clock.
 * The " UTC" suffix is only added to the date-time form (the date-only form has
 * no clock to qualify).
 */
export function formatServerTime(iso: string | null | undefined, fallback = "—", opts: { dateOnly?: boolean } = {}): string {
  if (!iso) return fallback;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return fallback;
  if (opts.dateOnly) return new Intl.DateTimeFormat("en-GB", DATE_PARTS).format(d);
  return `${new Intl.DateTimeFormat("en-GB", TIME_PARTS).format(d)} UTC`;
}

/**
 * The merchant's LOCAL rendering — used ONLY after the component has mounted on
 * the client, never during SSR. Falls back to the deterministic server string if
 * anything is off, so a bad value can never throw in render.
 */
export function formatLocalTime(iso: string | null | undefined, fallback = "—", opts: { dateOnly?: boolean } = {}): string {
  if (!iso) return fallback;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return fallback;
  try {
    return opts.dateOnly ? d.toLocaleDateString() : d.toLocaleString();
  } catch {
    return formatServerTime(iso, fallback, opts);
  }
}
