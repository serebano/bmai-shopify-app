import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import { onAppInstalled, onAppUninstalled } from "./bmai.server";

// Managed installation + token exchange (unstable_newEmbeddedAuthStrategy is the
// template default). The offline access token persisted here backs the Shopify
// Admin GraphQL connector (app/mcp/shopifyAdmin.ts).
const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.January26 ?? ("2026-01" as ApiVersion),
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  future: {
    unstable_newEmbeddedAuthStrategy: true,
    removeRest: true,
  },
  hooks: {
    // afterAuth = the install/re-auth convergence point. Runs the bmai MCP
    // provision lifecycle (idempotent). See bmai.server.ts::onAppInstalled.
    afterAuth: async ({ session }) => {
      await shopify.registerWebhooks({ session });
      await onAppInstalled(session);
    },
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.January26 ?? "2026-01";
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;

// Re-export so webhook routes can reach the teardown seam without a cycle.
export { onAppUninstalled };
