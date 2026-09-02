import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { login } from "../shopify.server";

/**
 * /auth/login — the library's login path (authPathPrefix "/auth"). Any request to
 * /app* without an admin session (a direct non-embedded hit, a bookmark, a stale
 * tab, an App Bridge bounce edge case) lands here. Previously the auth splat
 * called authenticate.admin on it, which the library rejects with a bare 500 —
 * an App Store "web error" (Req 2.1.1 / 2.1.3).
 *
 *   ?shop=<valid myshopify domain> → login() throws Shopify's managed-install
 *                                    redirect (admin.shopify.com …/oauth/install)
 *   no shop / invalid shop          → the branded root, which links to the App
 *                                    Store listing. No myshopify.com entry form:
 *                                    installs start on a Shopify surface (2.3.1).
 *
 * Whatever happens, the answer is a redirect — never a 500.
 */
async function handle(request: Request): Promise<Response> {
  try {
    // Resolves to a LoginError object when it cannot redirect (missing/invalid shop).
    await login(request);
  } catch (thrown) {
    if (thrown instanceof Response) return thrown; // the managed-install redirect
    console.error("[auth] login failed:", thrown instanceof Error ? thrown.message : thrown);
  }
  return redirect("/");
}

export const loader = ({ request }: LoaderFunctionArgs) => handle(request);
export const action = ({ request }: ActionFunctionArgs) => handle(request);
