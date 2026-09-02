import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LocalTime } from "../app/components/LocalTime";
import { formatServerTime } from "../app/lib/formatTime";

/**
 * The SSR contract of <LocalTime> (#retrain-500): the server-rendered markup —
 * which is also the client's FIRST render, before any effect runs — must be the
 * deterministic `formatServerTime` string. That is what makes hydration clean; if
 * the component ever rendered the ambient-local time during SSR, the server and
 * client first paints would diverge and the ErrorBoundary 500 returns.
 */
describe("LocalTime SSR markup", () => {
  it("server-renders the deterministic UTC string, wrapped in a span", () => {
    const iso = "2026-09-02T23:30:00Z";
    const html = renderToStaticMarkup(createElement(LocalTime, { iso }));
    expect(html).toBe(`<span>${formatServerTime(iso)}</span>`);
    // Guard against a viewer-local hour leaking into SSR.
    expect(html).toContain("23:30");
  });

  it("renders the fallback for a missing value", () => {
    const html = renderToStaticMarkup(createElement(LocalTime, { iso: null, fallback: "never" }));
    expect(html).toBe("<span>never</span>");
  });

  it("date-only omits the clock in SSR", () => {
    const html = renderToStaticMarkup(createElement(LocalTime, { iso: "2026-09-02T23:30:00Z", dateOnly: true }));
    expect(html).not.toContain("23:30");
    expect(html).not.toContain("UTC");
  });
});
