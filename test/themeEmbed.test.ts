import { describe, expect, it, vi, afterEach } from "vitest";
import {
  STOREFRONT_ASSISTANT_BLOCK,
  STOREFRONT_ASSISTANT_EXTENSION_UUID,
  buildSetupChecklist,
  detectStorefrontEmbed,
  themeEditorActivateUrl,
  themeEditorAppEmbedsUrl,
} from "../app/lib/themeEmbed";

/** Activation identity and CDN asset identity are separate Shopify contracts. */
describe("theme editor deep link", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("activates the block using the deployed app client ID, never the CDN UUID", () => {
    vi.stubEnv("SHOPIFY_API_KEY", "test-app-client-id");
    vi.stubEnv("STOREFRONT_ASSISTANT_EXTENSION_UUID", "different-cdn-id");
    const url = new URL(themeEditorActivateUrl("acme.myshopify.com"));
    expect(url.origin).toBe("https://acme.myshopify.com");
    expect(url.pathname).toBe("/admin/themes/current/editor");
    expect(url.searchParams.get("context")).toBe("apps");
    expect(url.searchParams.get("activateAppId")).toBe("test-app-client-id/assistant");
    expect(url.href).not.toContain(STOREFRONT_ASSISTANT_EXTENSION_UUID);
    expect(STOREFRONT_ASSISTANT_BLOCK).toBe("assistant");
  });

  it("uses explicit app identity and safely encodes the block handle", () => {
    const url = new URL(themeEditorActivateUrl("acme.myshopify.com", { apiKey: "another-client", block: "assistant&other" }));
    expect(url.searchParams.get("activateAppId")).toBe("another-client/assistant&other");
    expect(url.searchParams.has("other")).toBe(false);
  });

  it("falls back to manual app embeds when app identity is unavailable", () => {
    vi.stubEnv("SHOPIFY_API_KEY", "  ");
    expect(themeEditorActivateUrl("acme.myshopify.com")).toBe(themeEditorAppEmbedsUrl("acme.myshopify.com"));
    expect(themeEditorAppEmbedsUrl("acme.myshopify.com")).toBe("https://acme.myshopify.com/admin/themes/current/editor?context=apps");
  });
});

describe("detectStorefrontEmbed (no read_themes scope — reads the public storefront HTML)", () => {
  const html = (body: string, status = 200) =>
    async () => new Response(body, { status, headers: { "content-type": "text/html" } });

  it("reports 'on' when the storefront loads the extension asset", async () => {
    const page = `<html><script src="https://cdn.shopify.com/extensions/${STOREFRONT_ASSISTANT_EXTENSION_UUID}/busymate-ai-4/assets/assistant.js"></script></html>`;
    expect(await detectStorefrontEmbed("acme.myshopify.com", html(page))).toBe("on");
  });
  it("reports 'off' on a public storefront that does not load it", async () => {
    expect(await detectStorefrontEmbed("acme.myshopify.com", html("<html><body>shop</body></html>"))).toBe("off");
  });
  it("reports 'unknown' (never a false 'off') behind a password page or a non-200", async () => {
    expect(await detectStorefrontEmbed("acme.myshopify.com", html('<form action="/password"></form>'))).toBe("unknown");
    expect(await detectStorefrontEmbed("acme.myshopify.com", html("", 503))).toBe("unknown");
    expect(await detectStorefrontEmbed("acme.myshopify.com", async () => { throw new Error("net"); })).toBe("unknown");
  });
});

describe("buildSetupChecklist (Home)", () => {
  it("orders the four steps and marks them from the tenant state", () => {
    const steps = buildSetupChecklist({
      provisionState: "published",
      connectorReady: true,
      embed: "on",
      trainedAt: "2026-09-02T00:00:00Z",
      trainError: null,
      planId: "growth",
      hasSubscription: true,
    });
    expect(steps.map((s) => s.id)).toEqual(["provisioned", "embed", "trained", "plan"]);
    expect(steps.every((s) => s.done)).toBe(true);
  });
  it("a fresh install has only 'plan' resolved (Free) and the embed step pending", () => {
    const steps = buildSetupChecklist({
      provisionState: "published",
      connectorReady: false,
      embed: "unknown",
      trainedAt: null,
      trainError: null,
      planId: null,
      hasSubscription: false,
    });
    const byId = Object.fromEntries(steps.map((s) => [s.id, s]));
    expect(byId.provisioned.done).toBe(true);
    expect(byId.embed.done).toBe(false);
    expect(byId.trained.done).toBe(false);
    expect(byId.plan.done).toBe(true); // Free plan — nothing the merchant must do
    expect(byId.plan.detail).toMatch(/Free plan/);
  });
  it("a provisioning error is surfaced as the first, failed step", () => {
    const steps = buildSetupChecklist({
      provisionState: "error",
      connectorReady: false,
      embed: "unknown",
      trainedAt: null,
      trainError: null,
      planId: null,
      hasSubscription: false,
    });
    expect(steps[0]).toMatchObject({ id: "provisioned", done: false, failed: true });
  });
  it("the trained step reads 'Trained on N products, M policies, K pages' with the counts + the re-train hint", () => {
    const steps = buildSetupChecklist({
      provisionState: "published",
      connectorReady: true,
      embed: "on",
      trainedAt: "2026-09-02T10:00:00.000Z",
      trainError: null,
      counts: { products: 62, policies: 3, pages: 4 },
      truncated: true,
      fetched: { products: 250, policies: 3, pages: 4 },
      planId: null,
      hasSubscription: false,
    });
    const trained = steps.find((s) => s.id === "trained")!;
    expect(trained.done).toBe(true);
    expect(trained.detail).toMatch(/Trained on 62 of 250 products, 3 policies, 4 pages/);
    expect(trained.detail).toMatch(/[Rr]e-train/);
  });
  it("a training error is a failed step whose detail carries the error and the re-train hint", () => {
    const steps = buildSetupChecklist({
      provisionState: "published",
      connectorReady: true,
      embed: "on",
      trainedAt: null,
      trainError: "Shopify Admin 403",
      counts: { products: null, policies: null, pages: null },
      planId: null,
      hasSubscription: false,
    });
    const trained = steps.find((s) => s.id === "trained")!;
    expect(trained).toMatchObject({ done: false, failed: true });
    expect(trained.detail).toMatch(/Shopify Admin 403/);
    expect(trained.detail).toMatch(/[Rr]e-train/);
  });
});
