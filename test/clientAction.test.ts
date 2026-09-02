import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { describeTransportError, failClosedClientAction, isTransportFailure } from "../app/lib/clientAction";

/**
 * The embedded-action CLIENT contract (#retrain-500, part 2; busymate-devtools#2110).
 *
 * Traced live 2026-09-02: the fetcher POST for "Re-train on my store" died in
 * transit (net::ERR_NETWORK_CHANGED → App Bridge's fetch rejected with
 * "TypeError: Failed to fetch"). React Router turns a rejected action fetch into
 * a ROUTE ERROR, so the root ErrorBoundary painted "500 Something went wrong"
 * inside the admin iframe — while the server had completed the re-train.
 * `failClosedClientAction` wraps `serverAction()` so a transport failure becomes
 * a rendered `{ ok:false, error, transport:true }` (an error toast), never a 500.
 */
const routesDir = join(__dirname, "..", "app", "routes");
const args = (intent: string, serverAction: () => Promise<unknown>) => ({
  request: new Request("https://store.busymate.ai/app/connector", { method: "POST", body: (() => { const f = new FormData(); f.set("intent", intent); return f; })() }),
  params: {},
  context: {},
  serverAction: serverAction as <T>() => Promise<T>,
});

describe("failClosedClientAction", () => {
  it("passes a resolved server result through untouched", async () => {
    const data = { intent: "retrain", ok: true, state: "trained", summary: "15 of 17 products" };
    await expect(failClosedClientAction(args("retrain", async () => data))).resolves.toBe(data);
  });

  // The core RED→GREEN: the rejection that painted the 500 becomes a rendered result.
  it("resolves a network rejection to a fail-closed result with the submitted intent", async () => {
    const res = await failClosedClientAction(args("retrain", async () => { throw new TypeError("Failed to fetch"); }));
    expect(res).toMatchObject({ intent: "retrain", ok: false, state: "failed", transport: true });
    expect((res as { error: string }).error).toMatch(/Network error/);
    expect(isTransportFailure(res)).toBe(true);
  });

  it("resolves a decode failure (the app restarting behind nginx) to a fail-closed result", async () => {
    const res = await failClosedClientAction(args("reprovision", async () => { throw new Error("Unable to decode turbo-stream response"); }));
    expect(res).toMatchObject({ intent: "reprovision", ok: false, transport: true });
    expect((res as { error: string }).error).toMatch(/valid response/);
  });

  it("re-throws a thrown Response (redirects / Shopify's session-token bounce are control flow)", async () => {
    const bounce = new Response("", { status: 302, headers: { Location: "/auth/session-token" } });
    await expect(failClosedClientAction(args("retrain", async () => { throw bounce; }))).rejects.toBe(bounce);
  });

  it("re-throws a React Router error response (a 404/4xx keeps its boundary handling)", async () => {
    const errorResponse = { status: 404, statusText: "Not Found", data: "x", internal: false };
    const fn = vi.fn(async () => { throw errorResponse; });
    await expect(failClosedClientAction(args("retrain", fn))).rejects.toBe(errorResponse);
  });

  it("never rejects for a plain error, even when the form cannot be read", async () => {
    const res = await failClosedClientAction({ ...args("x", async () => { throw new Error("boom"); }), request: new Request("https://store.busymate.ai/app", { method: "POST", body: "not-a-form", headers: { "content-type": "text/plain" } }) });
    expect(res).toMatchObject({ intent: "", ok: false, error: "boom", transport: true });
  });
});

describe("describeTransportError (merchant-facing, never a stack)", () => {
  it("maps browser network failures", () => {
    expect(describeTransportError(new TypeError("Failed to fetch"))).toMatch(/^Network error/);
    expect(describeTransportError(new TypeError("NetworkError when attempting to fetch resource."))).toMatch(/^Network error/);
    expect(describeTransportError(new TypeError("Load failed"))).toMatch(/^Network error/);
  });
  it("maps a non-data response (502 HTML while the app restarts)", () => {
    expect(describeTransportError(new Error("Unable to decode turbo-stream response"))).toMatch(/valid response/);
  });
  it("falls back to the message, and to a generic line for unknown values", () => {
    expect(describeTransportError(new Error("ingest crashed"))).toBe("ingest crashed");
    expect(describeTransportError(undefined)).toMatch(/Something went wrong/);
    expect(describeTransportError(null)).toMatch(/Something went wrong/);
  });
});

/**
 * Wiring, derived from the LIVE route files (not a hand-kept list): every child
 * route of /app with a server `action` must fail closed on the client, and every
 * child route must recover in-frame instead of bubbling to the root 500 page.
 */
describe("app/routes/app.*.tsx wiring", () => {
  const childRoutes = readdirSync(routesDir).filter((f) => /^app\..+\.tsx$/.test(f));
  it("finds the child routes", () => {
    expect(childRoutes.length).toBeGreaterThanOrEqual(5);
  });
  for (const file of childRoutes) {
    const src = readFileSync(join(routesDir, file), "utf8");
    const hasAction = /export (const|async function) action\b/.test(src);
    it(`${file} exports ErrorBoundary = AppRouteBoundary (in-frame recovery)`, () => {
      expect(src).toMatch(/import \{ AppRouteBoundary \} from "\.\.\/components\/AppRouteError"/);
      expect(src).toMatch(/export const ErrorBoundary = AppRouteBoundary;/);
    });
    if (hasAction) {
      it(`${file} exports clientAction = failClosedClientAction (a rejected action fetch renders, never 500s)`, () => {
        expect(src).toMatch(/import \{[^}]*failClosedClientAction[^}]*\} from "\.\.\/lib\/clientAction"/);
        expect(src).toMatch(/export const clientAction = failClosedClientAction;/);
      });
    }
  }
});
