import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { formatServerTime } from "../app/lib/formatTime";

/**
 * Root-cause guard for the Connector "Something went wrong" 500 (#retrain-500).
 *
 * The 500 was a React HYDRATION MISMATCH: the routes rendered `toLocaleString()`
 * during SSR, so the Node host (TZ=UTC) and the reviewer's browser (their own TZ)
 * produced different text, React threw #418/#425/#423 on every embedded load, and
 * inside the App Bridge iframe that escalated to the branded error page — while
 * the in-flight fetcher POST was aborted (nginx 499). `formatServerTime` is the
 * fix: it pins the zone to UTC so the server string and the client's first render
 * are byte-identical. These tests fail the moment SSR time rendering becomes
 * time-zone dependent again.
 */
describe("formatServerTime", () => {
  const iso = "2026-09-02T23:30:00Z";

  it("renders the UTC wall clock, not the ambient time zone", () => {
    // 23:30Z is 16:30 in Los Angeles and 05:00 next-day in Kolkata; only a
    // UTC-pinned render says "2 Sep 2026, 23:30".
    expect(formatServerTime(iso)).toMatch(/^2 Sept? 2026, 23:30 UTC$/);
  });

  it("is pure — same input, same output", () => {
    expect(formatServerTime(iso)).toBe(formatServerTime(iso));
  });

  it("date-only drops the clock and the UTC suffix", () => {
    expect(formatServerTime(iso, "—", { dateOnly: true })).toMatch(/^2 Sept? 2026$/);
  });

  it("returns the fallback for null / undefined / invalid input", () => {
    expect(formatServerTime(null, "never")).toBe("never");
    expect(formatServerTime(undefined, "—")).toBe("—");
    expect(formatServerTime("not-a-date", "—")).toBe("—");
  });

  // The hydration invariant, proved hermetically: the SAME instant formatted in
  // three contrasting time zones must yield BYTE-IDENTICAL output. A bare
  // toLocaleString() (the bug) fails this; the UTC-pinned formatter passes.
  it("produces identical output under UTC, America/Los_Angeles and Asia/Kolkata", () => {
    const fixture = fileURLToPath(new URL("./fixtures/print-server-time.ts", import.meta.url));
    const render = (tz: string) =>
      execFileSync(process.execPath, ["--import", "tsx", fixture, iso], {
        env: { ...process.env, TZ: tz },
        encoding: "utf8",
      });
    const utc = render("UTC");
    expect(utc).toBe("2 Sept 2026, 23:30 UTC");
    expect(render("America/Los_Angeles")).toBe(utc);
    expect(render("Asia/Kolkata")).toBe(utc);
  });
});
