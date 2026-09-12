import "@shopify/shopify-app-react-router/adapters/node";
import { shopifyApp, AppDistribution } from "@shopify/shopify-app-react-router/server";
import { ApiVersion, type Session } from "@shopify/shopify-api";
import { abstractFetch, setAbstractFetchFunc } from "@shopify/shopify-api/runtime";
import { SignJWT } from "jose";
import { expect, it, vi } from "vitest";
import { observeAdminAuthentication, routeDiagnostic } from "../app/lib/routeDiagnostics";

it("the installed SDK can retry a failed offline-token exchange without diagnostics altering recovery", async () => {
  const secret = "synthetic-sdk-secret";
  let stored: Session | undefined;
  let failing = true;
  const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
    expect(String(url)).toContain("fixture.myshopify.com/admin/oauth/access_token");
    return failing ? new Response(JSON.stringify({ error: "synthetic failure" }), { status: 503 }) : new Response(JSON.stringify({ access_token: "synthetic-offline", scope: "read_products", expires_in: 3600, refresh_token: "synthetic-refresh", refresh_token_expires_in: 7200 }), { status: 200 });
  });
  const originalFetch = abstractFetch;
  setAbstractFetchFunc(fetchMock);
  try {
    const sdk = shopifyApp({ apiKey: "fixture-key", apiSecretKey: secret, appUrl: "https://app.example", apiVersion: ApiVersion.July26, distribution: AppDistribution.AppStore, future: { expiringOfflineAccessTokens: true }, sessionStorage: {
      storeSession: async session => { stored = session; return true; }, loadSession: async () => stored,
      deleteSession: async () => true, deleteSessions: async () => true, findSessionsByShop: async () => [],
    } });
    const token = await new SignJWT({ iss: "https://fixture.myshopify.com/admin", dest: "https://fixture.myshopify.com", sub: "123", sid: "synthetic-session" }).setProtectedHeader({ alg: "HS256" }).setAudience("fixture-key").setIssuedAt().setExpirationTime("5m").sign(new TextEncoder().encode(secret));
    const request = () => new Request("https://app.example/app?shop=fixture.myshopify.com&embedded=1", { headers: { Authorization: `Bearer ${token}` } });
    const diagnostics: unknown[] = [];
    const authenticate = observeAdminAuthentication(sdk.authenticate.admin, (event, req, error) => diagnostics.push(routeDiagnostic(event, req, error)));
    await expect(authenticate(request())).rejects.toMatchObject({ status: 500 });
    expect(diagnostics).toEqual([{ event: "admin_auth_failed", method: "GET", path: "/app", status: 500, errorClass: "Response", aborted: false }]);
    failing = false;
    expect((await authenticate(request())).session.shop).toBe("fixture.myshopify.com");
    expect(stored?.accessToken).toBe("synthetic-offline");
    expect(diagnostics).toHaveLength(1);
    expect(JSON.stringify(diagnostics)).not.toContain(token);
  } finally { setAbstractFetchFunc(originalFetch); }
}, 15000);
