export interface EmbeddedNavigation { shop: string; host: string }

/** Call only with the shop from authenticate.admin, never a query parameter. */
export function embeddedNavigationForShop(shop: string): EmbeddedNavigation {
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) throw new Error("Invalid authenticated shop");
  return { shop, host: btoa(`${shop}/admin`) };
}

/** Preserve routing context, never stale credentials, across internal app links. */
export function embeddedAppUrl(destination: string, context: EmbeddedNavigation | null): string {
  if (!context || !/^\/app(?:[/?#]|$)/.test(destination)) return destination;
  const url = new URL(destination, "https://embedded.invalid");
  for (const key of ["id_token", "hmac", "signature", "session", "shopify-reload"]) url.searchParams.delete(key);
  url.searchParams.set("shop", context.shop);
  url.searchParams.set("host", context.host);
  url.searchParams.set("embedded", "1");
  return `${url.pathname}${url.search}${url.hash}`;
}
