import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppProvider } from "@shopify/polaris";
import en from "@shopify/polaris/locales/en.json";
import { describe, expect, it } from "vitest";
import { AppRouteErrorView } from "../app/components/AppRouteError";

/**
 * The in-frame recovery view (#retrain-500, part 2): a child-route error must
 * render INSIDE the app shell as a merchant-facing banner with a retry — not the
 * root "500 Something went wrong" document that strands the merchant.
 */
const render = (message: string, withRetry = true) =>
  renderToStaticMarkup(
    createElement(AppProvider, { i18n: en }, createElement(AppRouteErrorView, { message, onRetry: withRetry ? () => {} : undefined })),
  );

describe("AppRouteErrorView", () => {
  it("renders a critical banner with the merchant-facing message and a Try again action", () => {
    const html = render("Network error — the connection dropped.");
    expect(html).toContain("Something went wrong");
    expect(html).toContain("Network error — the connection dropped.");
    expect(html).toContain("Try again");
    expect(html).not.toMatch(/\b500\b/);
    // Never a developer hint: no error class names or stack frames in the markup.
    expect(html).not.toMatch(/TypeError:|Error:|\bat \w+ \(|node_modules/);
  });
  it("omits the retry action when no handler is given", () => {
    expect(render("x", false)).not.toContain("Try again");
  });
});
