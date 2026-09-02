import { describe, expect, it } from "vitest";
import {
  STOREFRONT_ASSISTANT_BLOCK,
  STOREFRONT_ASSISTANT_EXTENSION_UUID,
  buildSetupChecklist,
  detectStorefrontEmbed,
  themeEditorActivateUrl,
  themeEditorAppEmbedsUrl,
} from "../app/lib/themeEmbed";

/**
 * Req 5.1.3 — onboarding for theme app extensions. The deep link must carry the
 * extension UUID SHOPIFY ASSIGNED (the `cdn.shopify.com/extensions/<uuid>/…` asset
 * path the storefront actually loads), NOT the toml `uid` — pinned here so a
 * refactor can't swap them and silently open a dead editor link.
 */
const TOML_UID = "b439d562-1c1e-0ef2-eb3c-6acfad1dfbfe5bdd5d7c";

describe("theme editor deep link", () => {
  it("pins the Shopify-assigned extension UUID (from the CDN asset path), not the toml uid", () => {
    expect(STOREFRONT_ASSISTANT_EXTENSION_UUID).toBe("01a04ae4-bf97-7e8d-b8a4-a9c4cd3b4854");
    expect(STOREFRONT_ASSISTANT_EXTENSION_UUID).not.toBe(TOML_UID);
    expect(STOREFRONT_ASSISTANT_BLOCK).toBe("assistant"); // blocks/assistant.liquid
  });

  it("builds the activateAppId deep link for the shop", () => {
    expect(themeEditorActivateUrl("acme.myshopify.com")).toBe(
      "https://acme.myshopify.com/admin/themes/current/editor?context=apps&activateAppId=01a04ae4-bf97-7e8d-b8a4-a9c4cd3b4854/assistant",
    );
    expect(themeEditorAppEmbedsUrl("acme.myshopify.com")).toBe(
      "https://acme.myshopify.com/admin/themes/current/editor?context=apps",
    );
  });

  it("an env override replaces the UUID (a re-created extension gets a new one)", () => {
    expect(themeEditorActivateUrl("acme.myshopify.com", { uuid: "ffffffff-0000-0000-0000-000000000000" })).toContain(
      "activateAppId=ffffffff-0000-0000-0000-000000000000/assistant",
    );
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
