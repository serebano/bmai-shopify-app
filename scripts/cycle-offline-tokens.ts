/**
 * One-off: cycle every stored NON-expiring offline access token into an EXPIRING
 * one (+ refresh token) via Shopify's token-exchange migration grant
 * (`api.auth.migrateToExpiringToken`). Sessions are read AND written through the
 * app's own `sessionStorage` (the encrypting decorator over Prisma), so the
 * at-rest envelope and the session id convention are never duplicated here.
 * Core logic + tests: app/lib/cycleOfflineTokens.ts / test/cycleOfflineTokens.test.ts.
 *
 * Env (sourced from the host env file, value-blind): SHOPIFY_API_KEY,
 * SHOPIFY_API_SECRET, SHOPIFY_APP_URL, DATABASE_URL, APP_ENCRYPTION_KEY
 * (+ optional SHOPIFY_API_VERSION, SCOPES). Prints only shop domains + expiry
 * timestamps — never a token.
 *
 *   npm run tokens:cycle                          # cycle every permanent session
 *   npm run tokens:cycle -- --dry-run             # list candidates, exchange nothing
 *   npm run tokens:cycle -- --shop x.myshopify.com
 *
 * Exit 0 = every candidate cycled (or nothing to do); exit 1 = at least one failure
 * (that shop keeps its old row; re-run, or the merchant re-opens the app).
 */
import "@shopify/shopify-api/adapters/node";
import { shopifyApi, type Session } from "@shopify/shopify-api";
import prisma from "../app/db.server";
import { apiVersion, sessionStorage } from "../app/shopify.server";
import { cycleOfflineTokens } from "../app/lib/cycleOfflineTokens";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const shopIdx = args.indexOf("--shop");
const shop = shopIdx >= 0 ? args[shopIdx + 1] : undefined;

for (const name of ["SHOPIFY_API_KEY", "SHOPIFY_API_SECRET", "SHOPIFY_APP_URL", "DATABASE_URL"]) {
  if (!process.env[name]) {
    console.error(`[cycle] missing env ${name}`);
    process.exit(2);
  }
}

// The same credentials/version the app runs with. The migration grant only needs
// apiKey + apiSecretKey + hostName; it always requests an expiring token, and
// createSession keeps the refresh token + expiries from the exchange response.
const api = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY!,
  apiSecretKey: process.env.SHOPIFY_API_SECRET!,
  hostName: new URL(process.env.SHOPIFY_APP_URL!).host,
  isEmbeddedApp: true,
  apiVersion,
  scopes: process.env.SCOPES?.split(","),
});

const report = await cycleOfflineTokens(
  {
    listOfflineSessions: async () => {
      const rows = await prisma.session.findMany({ where: { isOnline: false }, select: { id: true } });
      // Load through the app's session storage so credentials are DECRYPTED exactly
      // the way the runtime reads them.
      const loaded = await Promise.all(rows.map((r) => sessionStorage.loadSession(r.id)));
      return loaded.filter((s): s is Session => Boolean(s));
    },
    migrate: async (shopDomain, nonExpiringOfflineAccessToken) => {
      const { session } = await api.auth.migrateToExpiringToken({
        shop: shopDomain,
        nonExpiringOfflineAccessToken,
      });
      return session;
    },
    // Same id (offline_<shop>) → the row is replaced in place, encrypted at rest.
    store: (session) => sessionStorage.storeSession(session as Session),
    log: (line) => console.log(line),
  },
  { dryRun, shop },
);

console.log(JSON.stringify(report, null, 2));
await prisma.$disconnect();
process.exit(report.failed.length ? 1 : 0);
