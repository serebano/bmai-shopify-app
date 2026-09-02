import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Static assets (#2110): /favicon.ico and /robots.txt were the two most
 * frequent "No route matches" errors in the host journal (135 + 84 per week)
 * and rendered the framework's dev-style error page. Serve real files.
 */
const pub = join(__dirname, "..", "public");

describe("public/favicon.ico", () => {
  it("is a real ICO (reserved 0, type 1, ≥1 image)", () => {
    const b = readFileSync(join(pub, "favicon.ico"));
    expect(b.readUInt16LE(0)).toBe(0);
    expect(b.readUInt16LE(2)).toBe(1);
    expect(b.readUInt16LE(4)).toBeGreaterThanOrEqual(1);
    expect(b.length).toBeGreaterThan(200);
  });
});

describe("public/robots.txt", () => {
  const txt = readFileSync(join(pub, "robots.txt"), "utf8");

  it("keeps crawlers out of the app, auth, webhook, connector and identity surfaces", () => {
    for (const p of ["/app", "/auth", "/webhooks", "/mcp", "/identity", "/api"]) {
      expect(txt).toMatch(new RegExp(`^Disallow: ${p.replace("/", "\\/")}`, "m"));
    }
  });

  it("applies to all agents and allows the public root", () => {
    expect(txt).toMatch(/^User-agent: \*/m);
    expect(txt).toMatch(/^Allow: \/\$?$/m);
  });
});
