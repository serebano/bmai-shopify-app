import "@shopify/shopify-app-react-router/adapters/node";
import { AppDistribution, shopifyApp } from "@shopify/shopify-app-react-router/server";
import { ApiVersion } from "@shopify/shopify-api";
import { expect, it } from "vitest";
import { embeddedAppUrl, embeddedNavigationForShop } from "../app/lib/embeddedNavigation";

it("keeps verified routing context and destination filters without propagating credentials", () => {
  const context = embeddedNavigationForShop("example.myshopify.com");
  const url = new URL(embeddedAppUrl("/app/connector?filter=open&id_token=expired&shop=other.myshopify.com#setup", context), "https://app.example");
  expect(url.pathname).toBe("/app/connector");
  expect(url.hash).toBe("#setup");
  expect(url.searchParams.get("filter")).toBe("open");
  expect(url.searchParams.get("shop")).toBe("example.myshopify.com");
  expect(atob(url.searchParams.get("host")!)).toBe("example.myshopify.com/admin");
  expect(url.searchParams.get("embedded")).toBe("1");
  expect(url.searchParams.has("id_token")).toBe(false);
  expect(embeddedAppUrl("https://elsewhere.example/app", context)).toBe("https://elsewhere.example/app");
  expect(() => embeddedNavigationForShop("evil.example")).toThrow();
});

it("the installed Shopify SDK sends a context-preserving reload through session-token recovery", async () => {
  const app = shopifyApp({
    apiKey: "fixture-key", apiSecretKey: "fixture-secret", appUrl: "https://app.example",
    apiVersion: ApiVersion.July26, distribution: AppDistribution.AppStore,
    sessionStorage: {
      storeSession: async () => true, loadSession: async () => undefined,
      deleteSession: async () => true, deleteSessions: async () => true, findSessionsByShop: async () => [],
    },
  });
  const route = embeddedAppUrl("/app/connector", embeddedNavigationForShop("example.myshopify.com"));
  let response: unknown;
  try {
    await app.authenticate.admin(new Request(`https://app.example${route}`, { headers: {
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    } }));
  } catch (error) { response = error; }
  expect(response).toBeInstanceOf(Response);
  expect((response as Response).status).toBe(302);
  const redirect = new URL((response as Response).headers.get("location")!, "https://app.example");
  expect(redirect.pathname).toBe("/auth/session-token");
  expect(redirect.searchParams.get("shopify-reload")).toBe(`https://app.example${route}`);
  expect(redirect.searchParams.has("id_token")).toBe(false);
});
