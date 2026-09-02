import { useEffect, useState } from "react";
import { formatLocalTime, formatServerTime } from "../lib/formatTime";

export interface LocalTimeProps {
  /** ISO instant to render; null/invalid renders `fallback`. */
  iso: string | null | undefined;
  /** Text for a missing value (e.g. "never", "—"). */
  fallback?: string;
  /** Drop the clock, render the date only. */
  dateOnly?: boolean;
}

/**
 * Renders a timestamp WITHOUT tripping React hydration (#retrain-500).
 *
 * The first render — on the server AND on the client's first paint — is the
 * DETERMINISTIC `formatServerTime` (fixed UTC/en-GB), so the two are byte-equal
 * and hydration is clean. Only AFTER mount does an effect swap in the merchant's
 * LOCAL time. `suppressHydrationWarning` is belt-and-suspenders on the span in
 * case the effect and hydration ever interleave.
 *
 * This is the ONE approved way to show a local timestamp in this app's embedded
 * (SSR + App Bridge iframe) UI. Do not render `toLocaleString()` inline.
 */
export function LocalTime({ iso, fallback = "—", dateOnly }: LocalTimeProps) {
  const server = formatServerTime(iso, fallback, { dateOnly });
  const [text, setText] = useState(server);
  useEffect(() => {
    setText(formatLocalTime(iso, fallback, { dateOnly }));
  }, [iso, fallback, dateOnly]);
  return (
    <span suppressHydrationWarning>{text}</span>
  );
}
