import { describe, expect, it, vi } from "vitest";
import { observeAdminAuthentication, routeDiagnostic } from "../app/lib/routeDiagnostics";

describe("safe route diagnostics", () => {
  it("omits query, credentials, body, message, arbitrary class/code and path segments", () => {
    const secret = "sensitive-fixture";
    const request = new Request(`https://app.example/app/${secret}?token=${secret}`, { method: "POST", headers: { Authorization: secret, Cookie: secret }, body: secret });
    const result = routeDiagnostic("route_failed", request, { name: secret, code: secret, message: secret, stack: secret, status: 503 });
    expect(result).toEqual({ event: "route_failed", method: "POST", path: "/[other]", status: 503, errorClass: "UnknownError", aborted: false });
    expect(JSON.stringify(result)).not.toContain(secret);
  });
  it("retains only allowlisted diagnostic fields and records abort state", () => {
    const controller = new AbortController(); const request = new Request("https://app.example/app.data?shop=private", { signal: controller.signal }); controller.abort();
    expect(routeDiagnostic("route_failed", request, Object.assign(new TypeError("private message"), { code: "ECONNRESET" }))).toEqual({ event: "route_failed", method: "GET", path: "/app.data", status: 500, errorClass: "TypeError", errorCode: "ECONNRESET", aborted: true });
  });
  it.each([200, 302, 401, 500, 503])("preserves the exact SDK response for status %s", async status => {
    const response = new Response("private body", { status, headers: { "X-Shopify-Retry-Invalid-Session-Request": "1", "Location": "/auth/session-token?private=1" } });
    const report = vi.fn(); const auth = observeAdminAuthentication(async () => { throw response; }, report);
    await expect(auth(new Request("https://app.example/app"))).rejects.toBe(response);
    expect(response.headers.get("X-Shopify-Retry-Invalid-Session-Request")).toBe("1");
    expect(report).toHaveBeenCalledTimes(status >= 500 ? 1 : 0);
  });
  it("a diagnostic failure cannot replace the original auth failure", async () => {
    const original = new Response(null, { status: 500 });
    const auth = observeAdminAuthentication(async () => { throw original; }, () => { throw new Error("logger failed"); });
    await expect(auth(new Request("https://app.example/app"))).rejects.toBe(original);
  });
});
