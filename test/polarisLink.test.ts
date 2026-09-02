import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { PolarisLink, type PolarisLinkProps } from "../app/components/PolarisLink";

/**
 * Embedded-app navigation (#2110, found live after the busymate-ai-5 release):
 * Polaris `<Link url>` / `<Button url>` render through the Polaris AppProvider's
 * `linkComponent`. Without one they are plain anchors, and a click navigates the
 * admin iframe to a BARE app URL (no host/shop/embedded/id_token) — which cannot
 * be authenticated as an embedded document request and lands on the error page
 * ("Something went wrong"). The library's 2.x AppProvider no longer provides
 * Polaris React context, so the nested Polaris AppProvider MUST carry a
 * router-aware link component: internal paths go through React Router (client
 * navigation keeps the embedded session), everything else stays a real anchor.
 */
function render(props: PolarisLinkProps, basename = "/base") {
  // The router only renders when the location sits under its basename.
  return renderToStaticMarkup(
    createElement(StaticRouter, { location: `${basename}/app`, basename }, createElement(PolarisLink, props, "go")),
  );
}

describe("PolarisLink (Polaris linkComponent)", () => {
  it("renders an internal app path through React Router (client-side navigation)", () => {
    const html = render({ url: "/app/connector" });
    // A React Router <Link> resolves against the router basename; a raw anchor would not.
    expect(html).toContain('href="/base/app/connector"');
    expect(html).not.toContain("target=");
  });
  it("keeps an absolute URL a real anchor and opens it in a new tab with rel protection", () => {
    const html = render({ url: "https://busymate.ai/console/inbox" });
    expect(html).toContain('href="https://busymate.ai/console/inbox"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
  it("honours an explicit target (the admin theme-editor deep link navigates the TOP window)", () => {
    const html = render({ url: "https://x.myshopify.com/admin/themes/current/editor?context=apps", target: "_top" });
    expect(html).toContain('target="_top"');
    expect(html).not.toContain("/base/");
  });
  it("treats `external` as a real anchor even for a relative path", () => {
    const html = render({ url: "/legal/terms", external: true });
    expect(html).toContain('href="/legal/terms"');
    expect(html).toContain('target="_blank"');
  });
  it("forwards accessibility/attribute props to the rendered element", () => {
    const html = render({ url: "/app/billing", "aria-label": "Manage plan", className: "x" });
    expect(html).toContain('aria-label="Manage plan"');
    expect(html).toContain('class="x"');
  });
});

describe("app/routes/app.tsx wires the link component", () => {
  const src = readFileSync(join(__dirname, "..", "app", "routes", "app.tsx"), "utf8");
  it("passes PolarisLink as the Polaris AppProvider linkComponent", () => {
    expect(src).toMatch(/import \{ PolarisLink \} from "\.\.\/components\/PolarisLink"/);
    expect(src).toMatch(/<PolarisAppProvider[^>]*linkComponent=\{PolarisLink\}/);
  });
});
