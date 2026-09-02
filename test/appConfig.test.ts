import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * shopify.app.toml contract (#2110): the storefront widget POSTs its identity
 * request to a Shopify App-Proxy path (`/apps/<subpath>/identity`), which only
 * resolves when the toml declares a matching [app_proxy]. Without it the fetch
 * 404s on every store and the identified-customer tier (order-aware answers)
 * is unreachable — the listing's headline claim. Pin the three sides together:
 * toml proxy path == the extension's IDENTITY_URL == the app's /identity route.
 */
const root = join(__dirname, "..");
const toml = readFileSync(join(root, "shopify.app.toml"), "utf8");
const assistantJs = readFileSync(
  join(root, "extensions/storefront-assistant/assets/assistant.js"),
  "utf8",
);

function tomlSection(name: string): string {
  const m = toml.match(new RegExp(`^\\[${name}\\]\\n([\\s\\S]*?)(?=^\\[|\\Z)`, "m"));
  if (!m) throw new Error(`[${name}] missing from shopify.app.toml`);
  return m[1];
}
function tomlValue(section: string, key: string): string {
  const m = section.match(new RegExp(`^${key}\\s*=\\s*"([^"]+)"`, "m"));
  if (!m) throw new Error(`${key} missing`);
  return m[1];
}

describe("shopify.app.toml [app_proxy]", () => {
  it("is declared and points at this app", () => {
    const proxy = tomlSection("app_proxy");
    const appUrl = toml.match(/^application_url\s*=\s*"([^"]+)"/m)![1];
    expect(tomlValue(proxy, "url")).toBe(appUrl);
    expect(tomlValue(proxy, "prefix")).toBe("apps");
    expect(tomlValue(proxy, "subpath")).toBe("busymate-ai");
  });

  it("proxy path equals the theme extension's IDENTITY_URL", () => {
    const proxy = tomlSection("app_proxy");
    const proxied = `/${tomlValue(proxy, "prefix")}/${tomlValue(proxy, "subpath")}/identity`;
    const identityUrl = assistantJs.match(/IDENTITY_URL\s*=\s*"([^"]+)"/)![1];
    expect(identityUrl).toBe(proxied);
  });

  it("Shopify forwards the remainder (/identity) to an existing app route", () => {
    // /apps/busymate-ai/identity → <url>/identity → app/routes/identity.tsx
    expect(existsSync(join(root, "app/routes/identity.tsx"))).toBe(true);
  });
});
