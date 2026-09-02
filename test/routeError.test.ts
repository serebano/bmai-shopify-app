import { describe, expect, it } from "vitest";
import { describeRouteError } from "../app/lib/routeError";

/**
 * Branded error page (#2110): unknown routes and thrown errors used to render
 * React Router's default boundary — "Unhandled Thrown Response! 404 Not Found …
 * 💿 Hey developer 👋" with a stack — on the public host. The mapping from a
 * route error to what we SHOW is pure and must never leak internals.
 */
function routeErrorResponse(status: number, statusText: string, data: unknown = null) {
  // Shape react-router's isRouteErrorResponse() recognises.
  return { status, statusText, internal: false, data };
}

describe("describeRouteError", () => {
  it("maps a 404 route response to a branded not-found page", () => {
    const d = describeRouteError(routeErrorResponse(404, "Not Found", "Error: No route matches URL \"/x\""));
    expect(d.status).toBe(404);
    expect(d.title).toBe("Page not found");
    expect(d.message).not.toMatch(/No route matches/);
  });

  it("maps other route responses to their status with generic copy", () => {
    const d = describeRouteError(routeErrorResponse(410, "Gone"));
    expect(d.status).toBe(410);
    expect(d.title).toBe("Something went wrong");
  });

  it("maps a thrown Error to a 500 without exposing its message or stack", () => {
    const err = new Error("DATABASE_URL is not set");
    const d = describeRouteError(err);
    expect(d.status).toBe(500);
    expect(d.title).toBe("Something went wrong");
    expect(JSON.stringify(d)).not.toMatch(/DATABASE_URL|at |stack/);
  });

  it("maps an unknown thrown value to a 500", () => {
    expect(describeRouteError("nope").status).toBe(500);
    expect(describeRouteError(undefined).status).toBe(500);
  });

  it("never contains React Router's developer hints", () => {
    for (const e of [routeErrorResponse(404, "Not Found"), new Error("x"), null]) {
      const text = JSON.stringify(describeRouteError(e));
      expect(text).not.toMatch(/Hey developer|Unhandled Thrown Response|reactrouter\.com/);
    }
  });
});
