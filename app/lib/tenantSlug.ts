/**
 * shop.myshopify.com → a deterministic, stable bmai tenant slug.
 * The slug drives the serving host <slug>.busymate.ai and must satisfy the
 * whitelabel-sdk ASSISTANT_RE: ^[a-z0-9][a-z0-9-]{1,62}$.
 */
export function shopToSlug(shop: string): string {
  const base = shop.replace(/\.myshopify\.com$/i, "").toLowerCase();
  const cleaned = base
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  const slug = `shop-${cleaned}`.slice(0, 63);
  return slug.replace(/-+$/g, "");
}
