import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import { onAppInstalled, onAppUninstalled } from "./bmai.server";
import { encryptedSessionStorage } from "./lib/encryptedSessionStorage";

// The pinned Admin API version. `@shopify/shopify-api` (pinned) only enumerates up
// to April26, so 2026-07 is expressed as its literal string (a valid, released
// stable version the runtime uses verbatim in the request URL).
const API_VERSION = (process.env.SHOPIFY_API_VERSION || "2026-07") as ApiVersion;

// Managed installation + token exchange (unstable_newEmbeddedAuthStrategy is the
// template default). The offline access token persisted here backs the Shopify
// Admin GraphQL connector (app/mcp/shopifyAdmin.ts).
const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: API_VERSION,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  // Session storage wrapped with app-level field encryption at rest (accessToken +
  // staff email). See app/lib/encryptedSessionStorage.ts + app/lib/fieldCipher.ts.
  sessionStorage: encryptedSessionStorage(new PrismaSessionStorage(prisma)),
  distribution: AppDistribution.AppStore,
  future: {
    unstable_newEmbeddedAuthStrategy: true,
    removeRest: true,
  },
  hooks: {
    // afterAuth = the install/re-auth convergence point. Runs the bmai MCP
    // provision lifecycle (idempotent). See bmai.server.ts::onAppInstalled.
    //
    // afterAuth MUST NOT throw: it runs AFTER the session is persisted, inside the
    // Shopify token-exchange strategy, which converts ANY afterAuth throw into a
    // bare `500 Internal Server Error` on the embedded app's first load — the App
    // Store review failure (Req 2.1.1 "no critical errors" / 2.1.3 "an interactive
    // UI, not a web 500"). Both steps are idempotent and re-run on every re-auth,
    // so a transient failure here is best-effort: webhook registration is logged
    // and swallowed; provisioning errors are recorded + surfaced in the app UI
    // (onAppInstalled never throws).
    afterAuth: async ({ session }) => {
      try {
        await shopify.registerWebhooks({ session });
      } catch (err) {
        console.error(
          `[shopify] registerWebhooks failed for ${session.shop}:`,
          err instanceof Error ? err.message : err,
        );
      }
      await onAppInstalled(session);
    },
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = API_VERSION;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;

// Re-export so webhook routes can reach the teardown seam without a cycle.
export { onAppUninstalled };
