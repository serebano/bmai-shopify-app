import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * /auth/login must NEVER be a web 500 (App Store Req 2.1.1 / 2.1.3). Any
 * unauthenticated or non-embedded request to /app* is bounced here by the
 * library, so this route decides between: a valid ?shop= → Shopify's managed
 * install (the library's `login()` throws that redirect), or no/invalid shop →
 * the branded root (which links to the App Store listing; no manual
 * myshopify.com entry form, Req 2.3.1).
 */
vi.mock("../app/shopify.server", () => ({ login: vi.fn() }));

import { login } from "../app/shopify.server";
import { action, loader } from "../app/routes/auth.login";

const loginMock = login as unknown as ReturnType<typeof vi.fn>;

/** Run a route function and hand back whatever Response it returned OR threw. */
async function settle(fn: () => Promise<unknown>): Promise<Response> {
  try {
    const r = await fn();
    if (r instanceof Response) return r;
    throw new Error(`expected a Response, got ${typeof r}`);
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}

const args = (url: string, method = "GET") =>
  ({ request: new Request(url, { method }), params: {}, context: {} }) as never;

describe("GET /auth/login", () => {
  beforeEach(() => {
    loginMock.mockReset(); // block body: a returned stub would be run as a cleanup hook
  });

  it("with no shop redirects to the branded root, never a 500", async () => {
    loginMock.mockResolvedValue({});
    const res = await settle(() => loader(args("https://store.busymate.ai/auth/login")));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
  });

  it("with an invalid shop redirects to the branded root", async () => {
    loginMock.mockResolvedValue({ shop: "INVALID_SHOP" });
    const res = await settle(() =>
      loader(args("https://store.busymate.ai/auth/login?shop=not-a-shop")),
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
  });

  it("with a valid shop propagates the library's managed-install redirect", async () => {
    const install = new Response(null, {
      status: 302,
      headers: { location: "https://admin.shopify.com/store/acme/oauth/install?client_id=abc" },
    });
    loginMock.mockRejectedValue(install);
    const res = await settle(() =>
      loader(args("https://store.busymate.ai/auth/login?shop=acme.myshopify.com")),
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("/oauth/install?client_id=abc");
  });

  it("an unexpected library error still resolves to a redirect, not a 500", async () => {
    loginMock.mockRejectedValue(new Error("boom"));
    const res = await settle(() => loader(args("https://store.busymate.ai/auth/login")));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
  });
});

describe("POST /auth/login", () => {
  beforeEach(() => {
    loginMock.mockReset(); // block body: a returned stub would be run as a cleanup hook
  });

  it("behaves like GET (redirect, never a 500)", async () => {
    loginMock.mockResolvedValue({ shop: "MISSING_SHOP" });
    const res = await settle(() => action(args("https://store.busymate.ai/auth/login", "POST")));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
  });
});
